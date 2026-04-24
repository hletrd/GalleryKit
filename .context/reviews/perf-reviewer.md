# Performance Review — PROMPT 1 Cycle 4/100

## Scope and method

Reviewed the tracked GalleryKit repo for performance, concurrency, CPU/memory/UI responsiveness, DB query efficiency, caching/ISR behavior, image-processing cost, upload/backup memory hazards, bundle/client hydration, and perceived performance. I excluded dependency/build/binary artifacts (`node_modules`, `.git`, screenshots, fixtures, `test-results`) and inspected the active source/config/deploy flows listed below.

## Performance-relevant inventory

### Runtime, build, deploy, and request routing
- `apps/web/package.json` — framework/dependency surface: Next 16, React 19, Sharp, mysql2, p-queue, Radix, framer-motion, react-dropzone.
- `apps/web/next.config.ts` — standalone output, Sharp externalization, server action body limits, CSP, Next image config.
- `apps/web/nginx/default.conf` — upload/restore body caps, direct static image serving, keepalive, gzip, reverse proxy limits.
- `apps/web/src/proxy.ts` — locale/admin middleware path matching.
- `apps/web/src/instrumentation.ts` — startup queue bootstrap and shutdown drain.
- `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `README.md`, `CLAUDE.md` — production topology and single-writer/process-local queue assumptions.

### DB schema, data access, rate limits, cache/ISR
- `apps/web/src/db/index.ts`, `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql` — pool sizing, indexes, table relations, migration-defined indexes.
- `apps/web/src/lib/data.ts` — public/admin listing queries, search, shared groups, sitemap query, view-count buffer, React `cache()` wrappers.
- `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts` — per-request config reads and image-size/quality settings.
- `apps/web/src/lib/revalidation.ts` plus mutation actions under `apps/web/src/app/actions/*.ts` and `apps/web/src/app/[locale]/admin/db-actions.ts` — ISR/path invalidation behavior.
- `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/auth-rate-limit.ts`, `apps/web/src/lib/audit.ts`, `apps/web/src/lib/restore-maintenance.ts` — process-local/DB-backed throttles, cleanup, maintenance flags.

### Public pages, metadata, sitemap, uploaded-image serving
- `apps/web/src/app/[locale]/(public)/page.tsx`, `[topic]/page.tsx`, `p/[id]/page.tsx`, `s/[key]/page.tsx`, `g/[key]/page.tsx`, public layout — SSR/ISR data flow and hydration boundaries.
- `apps/web/src/app/sitemap.ts`, `robots.ts`, `api/og/route.tsx`, `icon.tsx`, `apple-icon.tsx` — bot-facing dynamic generation and OG image rendering.
- `apps/web/src/app/uploads/[...path]/route.ts`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`, `apps/web/src/lib/serve-upload.ts` — Node fallback for uploaded assets when nginx/static serving is not used.
- `apps/web/src/lib/image-url.ts`, `apps/web/src/lib/locale-path.ts`, `apps/web/src/lib/safe-json-ld.ts` — URL construction and SSR payload helpers.

### Upload, image processing, backup/restore, storage
- `apps/web/src/app/actions/images.ts`, `apps/web/src/components/upload-dropzone.tsx`, `apps/web/src/lib/upload-limits.ts`, `upload-tracker*.ts`, `upload-paths.ts` — upload quotas, client queueing, server action upload handling.
- `apps/web/src/lib/process-image.ts`, `process-topic-image.ts`, `image-queue.ts`, `queue-shutdown.ts` — Sharp concurrency, derivative generation, queue claims/retries/bootstrap.
- `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/lib/db-restore.ts`, `sql-restore-scan.ts`, `mysql-cli-ssl.ts` — backup/export/restore memory and streaming paths.
- `apps/web/src/lib/storage/index.ts`, `storage/local.ts`, `storage/types.ts` — local storage abstraction and direct filesystem behavior.

### Client bundle/hydration and UI responsiveness
- Public UI: `components/home-client.tsx`, `load-more.tsx`, `search.tsx`, `nav*.tsx`, `photo-viewer.tsx`, `lightbox.tsx`, `image-zoom.tsx`, `optimistic-image.tsx`, `histogram.tsx`, `info-bottom-sheet.tsx`, `lazy-focus-trap.tsx`, `theme-provider.tsx`, `i18n-provider.tsx`.
- Admin UI: `components/image-manager.tsx`, `upload-dropzone.tsx`, `tag-input.tsx`, `admin-user-manager.tsx`, protected admin client pages for dashboard/db/settings/seo/tags/categories/password.
- UI primitives: Radix wrappers under `components/ui/*`, especially dialogs/dropdowns/select/scroll areas used in large admin tables.

## Findings summary

| ID | Severity | Confidence | Status | Summary |
|---|---|---|---|---|
| PERF-C4-01 | HIGH | High | Likely | Default image-processing fan-out can oversubscribe CPU/memory and stall the app process. |
| PERF-C4-02 | MEDIUM | High | Confirmed | Public gallery pages compute `COUNT(*) OVER()` for the full matching image set before returning the first page. |
| PERF-C4-03 | MEDIUM | High | Confirmed | Public search uses leading-wildcard `LIKE` scans across several text/join paths with no full-text index. |
| PERF-C4-04 | MEDIUM | High | Confirmed | `/sitemap.xml` is force-dynamic and can query/build ~48k entries on every bot request. |
| PERF-C4-05 | MEDIUM | High | Confirmed | Upload selection renders full object-URL previews for every queued file and has no client-side count/size cap. |
| PERF-C4-06 | MEDIUM | Medium-High | Confirmed | CSV export materializes DB rows, CSV lines, one giant server-action string, and a client Blob. |
| PERF-C4-07 | LOW-MEDIUM | High | Confirmed | Admin dashboard mounts dozens of `TagInput`s, each scanning all tags and registering document listeners. |
| PERF-C4-08 | LOW | High | Confirmed | Several mutations call layout-level and path-level revalidation together, causing redundant ISR invalidation work. |

## Detailed findings

### PERF-C4-01 — Image-processing queue can oversubscribe CPU/memory under defaults

- **Status:** Likely
- **Severity:** HIGH
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/lib/process-image.ts:16-23` sets Sharp/libvips concurrency to `cpuCount - 1` by default.
  - `apps/web/src/lib/image-queue.ts:117-120` defaults queue concurrency to `Number(process.env.QUEUE_CONCURRENCY) || 2`.
  - `apps/web/src/lib/process-image.ts:381-444` generates WebP, AVIF, and JPEG derivatives in `Promise.all`, with each format looping over configured sizes.
- **Concrete failure scenario:** On an 8-core host with defaults, two queued images process concurrently, each image fans out three Sharp pipelines, and each Sharp pipeline may use up to the global libvips worker setting. A batch upload of large camera files can saturate CPU with AVIF/JPEG/WebP encoding and increase native memory pressure in the same Node process that serves SSR/admin actions. Public requests, login, admin UI refreshes, and health checks become slow or time out while the queue drains.
- **Why this matters:** The code correctly moves heavy conversion to a background queue, but the queue still runs inside the web process. Multiplying queue concurrency by per-image format fan-out by libvips concurrency can exceed the CPU budget needed to keep the UI responsive.
- **Suggested fix:** Make processing budget explicit. Safer options: default `QUEUE_CONCURRENCY=1` unless a worker-only deployment is used; cap Sharp concurrency to a small value such as `min(cpuCount / 2, 4)`; process formats sequentially inside one job or use a small per-job format limiter; expose an “estimated processing slots” formula in docs/settings; ideally move image processing to a separate worker process/container so web SSR has reserved CPU/memory.

### PERF-C4-02 — First-page gallery queries count every matching row

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/lib/data.ts:371-385` selects the first `pageSize + 1` rows but also adds `total_count: COUNT(*) OVER()`.
  - `apps/web/src/app/[locale]/(public)/page.tsx:127-130` calls `getImagesLitePage(...)` for the homepage.
  - `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:128-130` calls the same function for topic pages.
- **Concrete failure scenario:** A gallery grows to tens or hundreds of thousands of processed images. A cold ISR render of `/en` or `/en/travel` needs only 30 thumbnails, but MySQL must still compute the window count for every matching row before returning the limited page. Tag-filtered pages compound this with the tag subquery. The first visitor after revalidation sees high TTFB, and uploads/tag edits that invalidate pages trigger expensive regeneration.
- **Why this matters:** The UI only displays a count and a `hasMore` flag. `hasMore` is already derivable from `LIMIT pageSize + 1`; exact total count is the expensive part.
- **Suggested fix:** Remove `COUNT(*) OVER()` from the hot listing query. Use `limit + 1` for `hasMore` and either omit exact totals, fetch `COUNT(*)` in a separately cached query, maintain denormalized topic/tag counts, or only load exact counts lazily after initial render. If exact counts remain, benchmark a separate count query against real data and indexes instead of coupling it to the ordered thumbnail query.

### PERF-C4-03 — Search is DB-scan-heavy despite rate limiting

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/lib/data.ts:725-831` builds `%term%` searches over image fields, tags, and topic aliases.
  - `apps/web/src/lib/data.ts:731-757` runs the main `LIKE` query with leading wildcard predicates.
  - `apps/web/src/lib/data.ts:775-820` then runs tag and alias join searches when the main query has remaining slots.
  - `apps/web/src/db/schema.ts:16-66`, `68-80`, `87-104` define useful relational indexes but no full-text/search-specific index.
  - `apps/web/src/app/actions/public.ts:43-102` rate-limits search but still permits up to 30 searches/minute/IP by default.
- **Concrete failure scenario:** A public user types a two-character query that is not selective. Each debounced search can scan large portions of `images`, then `image_tags/tags`, then `topic_aliases`. Several users or one abusive IP within the allowed budget can create repeated full-table work and degrade public SSR/API latency.
- **Why this matters:** Rate limiting controls volume, not per-query cost. Leading-wildcard `LIKE` prevents normal b-tree indexes from helping on title/description/camera/tag names.
- **Suggested fix:** Introduce a search strategy with bounded cost: MySQL FULLTEXT indexes on title/description/camera/tag/alias fields, a dedicated search table maintained on mutations, or a separate search backend. Raise the minimum query length for expensive fields, short-circuit more aggressively for very common terms, and add metrics/logging for search duration/rows examined.

### PERF-C4-04 — Dynamic sitemap rebuilds a large result on every request

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/app/sitemap.ts:4-8` exports `dynamic = 'force-dynamic'` with no `revalidate` or response caching layer.
  - `apps/web/src/app/sitemap.ts:20-24` queries image IDs and topics for each request.
  - `apps/web/src/app/sitemap.ts:40-54` expands up to 24,000 images across locales into ~48,000 URL objects in memory.
  - `apps/web/src/lib/data.ts:834-844` caps but still fetches up to 24,000 image rows per sitemap request.
- **Concrete failure scenario:** Search crawlers or uptime checks request `/sitemap.xml` repeatedly. Every request hits MySQL, allocates thousands of JS objects, serializes a large XML response, and competes with normal page traffic. At the cap, the route also omits images beyond 24,000, so scaling pressure and completeness degrade together.
- **Why this matters:** Sitemaps are bot-facing, cacheable, and rarely need per-request freshness. The current route behaves like an uncached dynamic endpoint.
- **Suggested fix:** Cache the sitemap for a long interval (`revalidate`/route-handler cache headers or `unstable_cache` around `getImageIdsForSitemap`), split into sitemap index + paged sitemap files via `generateSitemaps()` or explicit route handlers, and invalidate only on image/topic mutations. Keep each sitemap below the 50k URL limit without rebuilding the whole set per request.

### PERF-C4-05 — Upload preview can exhaust browser memory before server limits help

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/lib/upload-limits.ts:1-2` defaults to 2 GiB total and 100 files per window.
  - `apps/web/src/components/upload-dropzone.tsx:117-122` configures `react-dropzone` without `maxFiles` or `maxSize`.
  - `apps/web/src/components/upload-dropzone.tsx:53-81` creates object URLs for every selected file.
  - `apps/web/src/components/upload-dropzone.tsx:305-386` renders every queued file preview as an `<img>`.
  - `apps/web/src/components/upload-dropzone.tsx:131-189` uploads three files concurrently after selection.
- **Concrete failure scenario:** An admin drags 100 large phone/camera images into the dashboard. Before upload begins, the browser creates 100 object URLs and attempts to render/decode all previews. Even though object URLs avoid copying file bytes into JS strings, the image decoder can allocate huge decoded bitmaps and thumbnails, freezing the tab or crashing mobile/low-memory browsers. If the user starts upload, three large server-action uploads also run concurrently.
- **Why this matters:** Server-side streaming and quotas do not protect client UI responsiveness during selection/preview. The admin dashboard can become unusable before any server validation runs.
- **Suggested fix:** Mirror server limits in `useDropzone` (`maxFiles`, `maxSize`) and reject early. Virtualize or paginate the preview grid, generate small thumbnails off-main-thread or only for visible files, skip previews for very large/RAW formats, and consider lowering upload concurrency dynamically for large files or slow devices.

### PERF-C4-06 — CSV export materializes multiple large copies across server and client

- **Status:** Confirmed
- **Severity:** MEDIUM
- **Confidence:** Medium-High
- **Files/regions:**
  - `apps/web/src/app/[locale]/admin/db-actions.ts:51-66` fetches up to 50,000 grouped rows into memory.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:70-99` builds `csvLines[]`, then joins to one `csvContent` string returned by a server action.
  - `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-114` receives the whole string and creates a client-side `Blob`/object URL.
- **Concrete failure scenario:** A 50k-row gallery export with long filenames/titles/tag strings allocates the DB result array, the CSV line array, the joined string, the server-action response payload, then a browser Blob. Admin export can spike Node heap and browser memory, and the server action transport cannot stream progress/backpressure.
- **Why this matters:** The current cap prevents unbounded OOM, but the route still has poor memory shape at the documented maximum.
- **Suggested fix:** Move CSV export to an authenticated route handler that streams rows to the response with cursor/keyset pagination or `mysql2` query streaming, writes headers directly, and avoids returning the CSV via server-action JSON/RSC payload. On the client, navigate to/download the route instead of constructing a Blob from an in-memory string.

### PERF-C4-07 — Admin dashboard tag controls scale poorly with tag count and page size

- **Status:** Confirmed
- **Severity:** LOW-MEDIUM
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:7-20` renders 50 images and fetches all tags for the dashboard.
  - `apps/web/src/components/image-manager.tsx:359-430` renders a `TagInput` for each image row.
  - `apps/web/src/components/tag-input.tsx:52-57` filters all available tags for each input render.
  - `apps/web/src/components/tag-input.tsx:60-62` performs another full scan for exact match.
  - `apps/web/src/components/tag-input.tsx:129-137` registers one document `mousedown` listener per `TagInput` instance.
- **Concrete failure scenario:** A mature gallery has 2,000 tags and the admin dashboard page shows 50 images. Initial render and many state updates cause dozens of `TagInput` instances to scan the same tag array, and the page registers dozens of outside-click listeners. Typing in one row or changing selection can cause visible input lag on slower laptops.
- **Why this matters:** This is admin-only, but tag editing is a core management workflow. The cost grows with `pageSize × tagCount`, not just the active row.
- **Suggested fix:** Render tag editing lazily (e.g., an “Edit tags” dialog/popover per row) instead of mounting 50 full comboboxes. Precompute normalized tag data once, only compute suggestions when an input is focused/open, cap/virtualize suggestions, and replace per-instance document listeners with a shared listener or Radix popover/dialog behavior.

### PERF-C4-08 — Redundant path + layout revalidation creates avoidable ISR churn

- **Status:** Confirmed
- **Severity:** LOW
- **Confidence:** High
- **Files/regions:**
  - `apps/web/src/lib/revalidation.ts:55-57` implements `revalidateAllAppData()` as `revalidatePath('/', 'layout')`.
  - `apps/web/src/app/actions/tags.ts:91-92`, `130-131`, `193-194`, `250-251`, `322-323`, `434-435` call targeted `revalidateLocalizedPaths(...)` and then `revalidateAllAppData()`.
  - `apps/web/src/app/actions/topics.ts:128-129`, `272-273`, `343-344`, `404-405`, `472-473` do the same.
  - `apps/web/src/app/actions/seo.ts:126-130` intentionally uses layout-level invalidation, then also revalidates admin paths.
- **Concrete failure scenario:** Admin bulk tag/topic operations perform multiple targeted invalidations and then invalidate the root layout anyway. On a busy admin session, this broadens cache churn and can cause extra regeneration work for public pages that would already be covered by the layout invalidation.
- **Why this matters:** The code has already optimized some image-delete paths to avoid redundant invalidation; the remaining tag/topic/SEO paths still mix strategies.
- **Suggested fix:** Pick one invalidation strategy per mutation. If layout-level invalidation is required, skip path-level public invalidations and only refresh truly dynamic/admin client state if needed. If targeted invalidation is enough, avoid `revalidateAllAppData()`. Add a small route-dependency matrix so future mutations do not default to both.

## Positive notes / already-mitigated areas

- Upload originals and restore files are streamed to disk (`process-image.ts:242-248`, `db-actions.ts:328-333`) instead of using `arrayBuffer()` in the reviewed server code.
- Public uploaded assets have immutable cache headers in the Node fallback (`serve-upload.ts:95-101`) and nginx bypasses Node entirely for `/uploads/{jpeg,webp,avif}` in the documented deployment (`nginx/default.conf:89-106`).
- Image queue bootstrap is batched (`image-queue.ts:69`, `390-428`) and avoids loading all pending rows at once.
- Shared-group view counts are buffered and flushed in chunks (`data.ts:46-80`) instead of one DB write per view.
- Photo-page viewer is dynamically imported on canonical photo pages (`p/[id]/page.tsx:16-18`), reducing initial photo route server/client coupling.

## Final sweep

After drafting, I re-ran targeted searches for `revalidate*`, `COUNT(*) OVER`, `LIKE`, `sharp`, `Promise.all`, `FormData`, `createObjectURL`, `Blob`, `sitemap`, `cache`, `dynamic`, `force-dynamic`, `stream`, `arrayBuffer`, `readFile`, and upload/backup routes. No additional performance findings met the requested confidence/detail threshold.
