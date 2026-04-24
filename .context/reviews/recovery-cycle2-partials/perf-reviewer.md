# Performance Review — perf-reviewer compatibility lane

Date: 2026-04-24  
Workspace: `/Users/hletrd/flash-shared/gallery`  
Role source: `/Users/hletrd/.claude/agents/perf-reviewer.md` was available and applied.  
Mode: deep static code review; no code changes other than this report; no commit per prompt.

## Scope and inventory

I inventoried review-relevant tracked files before reviewing implementation details, then examined every file in that inventory using direct reads plus repo-wide sweeps for performance-sensitive patterns (`Promise.all`, queue/concurrency settings, Sharp usage, SQL `COUNT`/`LIKE`/`OFFSET`, Next.js `dynamic`/`revalidate`, image object URLs, scroll/touch handlers, cache invalidation, upload/body limits, and cleanup scans). I did not sample within the inventory.

- Review-relevant tracked files: **266**.
- Excluded only generated/runtime/historical artifacts: `node_modules/`, `.next/`, `test-results/`, `playwright-report/`, `coverage/`, `.context/reviews/`, `.context/plans/`, `.omc/`, `.omx/`, and `plan/`.
- Historical reports were used only as leads; findings below were revalidated against current file/line evidence.

## Executive summary

| ID | Severity | Status | Confidence | Area |
| --- | --- | --- | --- | --- |
| PERF-P1-01 | High | Confirmed | High | Image processing CPU/RSS concurrency |
| PERF-P1-02 | High | Confirmed | High | Upload transport/body limits |
| PERF-P1-03 | High | Confirmed | High | Public photo page cacheability |
| PERF-P2-01 | Medium | Confirmed | High | Sitemap generation/cache |
| PERF-P2-02 | Medium | Confirmed | High | Gallery total counts |
| PERF-P2-03 | Medium | Confirmed | High | Derivative deletion I/O fan-out |
| PERF-P2-04 | Medium | Confirmed | High | CSV export memory |
| PERF-P2-05 | Medium | Likely | Medium-High | Public search scans |
| PERF-P2-06 | Medium | Likely | Medium-High | Rate-limit purge index |
| PERF-P2-07 | Medium | Likely | Medium | Upload preview browser memory |
| PERF-P2-08 | Medium | Likely | Medium | Gallery DOM/image retention |
| PERF-P3-01 | Low | Likely | Medium | Photo viewer initial JS bundle |
| PERF-P3-02 | Low | Likely | Medium | Touch-move React state jank |
| PERF-P3-03 | Low | Risk | Medium | Broad cache invalidation |

No P0 data-loss or deadlock-class performance issue was confirmed. The main production risks are CPU/memory spikes during image ingestion and losing ISR/cache behavior on the public photo page.

---

## Findings

### PERF-P1-01 — [High] CPU/Memory — image processing multiplies concurrency across upload actions, queue jobs, formats, and Sharp threads

**Status:** Confirmed  
**Confidence:** High

**Evidence**
- `apps/web/src/components/upload-dropzone.tsx:129-187` runs up to three concurrent upload server actions from one browser.
- `apps/web/src/lib/image-queue.ts:115-118` creates the image processing queue with `QUEUE_CONCURRENCY` or default `2`, with no upper clamp or relation to Sharp worker threads.
- `apps/web/src/lib/process-image.ts:16-23` sets `sharp.concurrency()` to `os.cpus() - 1` by default.
- `apps/web/src/lib/process-image.ts:276-282` performs blur-placeholder Sharp work on the upload request path before the image is queued.
- `apps/web/src/lib/process-image.ts:390-412` renders every configured size per format, and `apps/web/src/lib/process-image.ts:439-444` renders WebP, AVIF, and JPEG in parallel for each queued job.
- `apps/web/src/lib/image-queue.ts:255-263` calls `processImageFormats()` per queued job, so the queue concurrency multiplies the per-job format concurrency.

**Failure scenario**
A single admin selects many large HEIC/RAW/TIFF images. The browser starts three upload actions, each upload does metadata plus blur work, then queued jobs begin. With the defaults on an 8-core host, two queue jobs can each start three format pipelines while libvips is allowed seven worker threads. AVIF is CPU-heavy, so the effective runnable work can exceed core count by an order of magnitude, increasing latency for SSR, server actions, health checks, and DB callbacks. RSS can also spike from multiple decoders/encoders holding image state simultaneously.

**Concrete fix**
- Define one explicit CPU budget, e.g. `queueConcurrency * formatConcurrency * sharpConcurrency <= max(1, cores - reserve)`.
- Default `QUEUE_CONCURRENCY=1` for full-size image jobs unless profiling proves otherwise; clamp env values to a small safe maximum.
- Replace `Promise.all([webp,avif,jpeg])` with a format limiter (a tiny local semaphore or sequential loop is enough) and make AVIF sequential by default.
- Move blur placeholder generation into the background job or make it a cheap optional path with a timeout.
- Emit queue depth, per-job duration, and RSS/load metrics before and after processing so this can be tuned safely.

---

### PERF-P1-02 — [High] Memory/Network — Next.js and nginx allow 2 GiB request bodies despite a 200 MB per-file image limit

**Status:** Confirmed  
**Confidence:** High

**Evidence**
- `apps/web/src/lib/upload-limits.ts:1-12` sets the default cumulative upload budget to 2 GiB and `UPLOAD_MAX_FILES_PER_WINDOW` to 100.
- `apps/web/src/lib/upload-limits.ts:24` derives `NEXT_UPLOAD_BODY_SIZE_LIMIT` directly from that cumulative budget.
- `apps/web/next.config.ts:100-105` applies that value to `experimental.serverActions.bodySizeLimit` and `proxyClientMaxBodySize`.
- `apps/web/nginx/default.conf:16` sets `client_max_body_size 2G` globally.
- `apps/web/src/lib/process-image.ts:43` rejects individual files above 200 MB, but that check runs after the framework/proxy accepts and parses the body.
- `apps/web/src/components/upload-dropzone.tsx:140-154` sends each file in its own `FormData` request; the 2 GiB body allowance is therefore not needed for the normal client path.

**Failure scenario**
An authenticated admin, compromised browser session, or accidental drag/drop sends a huge multipart body. nginx and Next are configured to accept up to 2 GiB before application code reaches the 200 MB `MAX_FILE_SIZE` check. Three concurrent client uploads (`upload-dropzone.tsx:129-187`) can multiply temporary storage, network, parser, and memory pressure.

**Concrete fix**
- Separate per-request transport limit from cumulative per-window quota. Set nginx and Next upload-action body limits to roughly the maximum valid file size plus multipart overhead, e.g. `220mb` or a configurable `UPLOAD_MAX_BODY_BYTES`.
- Keep `UPLOAD_MAX_TOTAL_BYTES` as a rate/quota value only; do not feed it into request parsing limits.
- Add `maxSize` and `maxFiles` to `useDropzone()` so the browser rejects oversized selections before transport.
- If true multi-file batch upload is reintroduced later, use a dedicated streaming route with explicit backpressure instead of a 2 GiB server-action parser limit.

---

### PERF-P1-03 — [High] Next.js rendering/cache — public photo page declares 1-week ISR but reads cookies, making it request-dynamic

**Status:** Confirmed  
**Confidence:** High

**Evidence**
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:21-22` declares `export const revalidate = 604800`.
- The same page calls `isAdmin()` inside its server render `Promise.all` at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:118-125`.
- `apps/web/src/app/actions/auth.ts:21-24` implements `getSession()` with `cookies()`.
- `apps/web/src/app/actions/auth.ts:52-54` implements `isAdmin()` through `getCurrentUser()`/`getSession()`.
- The admin result is then passed into the client viewer at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:220-231`.

**Failure scenario**
Every public photo request can be treated as personalized because the route reads cookies during server rendering. The declared week-long revalidation no longer protects the route under crawler/share traffic; each hit can run `getImageCached(imageId)`, SEO/config queries, locale/translation work, and adjacent-photo lookups. This also makes cache behavior harder to reason about because the source says ISR while the runtime path is dynamic.

**Concrete fix**
- Remove `isAdmin()` from the public photo RSC. Render the cacheable public photo page without admin state.
- Hydrate admin-only controls from a small client component that calls an auth-status route/server action after load, or create a separate `/admin/photos/[id]` page for admin controls.
- After splitting, verify the photo page is statically/ISR cacheable and document any intentional dynamic segments.

---

### PERF-P2-01 — [Medium] DB/Next.js cache — sitemap is force-dynamic and rebuilds up to ~48k URL entries per request

**Status:** Confirmed  
**Confidence:** High

**Evidence**
- `apps/web/src/app/sitemap.ts:7` sets `dynamic = 'force-dynamic'` with no `revalidate` export.
- `apps/web/src/app/sitemap.ts:20-24` queries image IDs and topics on every sitemap request.
- `apps/web/src/app/sitemap.ts:15-18` allows 24,000 image rows to keep the localized expansion under 50,000 URLs.
- `apps/web/src/app/sitemap.ts:41-54` `flatMap`s those image rows across locales and returns the full array.
- `apps/web/src/lib/data.ts:834-844` caps the DB image query but still orders the latest processed rows each request.

**Failure scenario**
Crawler traffic or monitor checks repeatedly request `/sitemap.xml`. Each request hits the database, builds tens of thousands of JS objects, allocates the localized URL array, and serializes a large response. This competes with public page DB queries and image processing under load.

**Concrete fix**
- Make sitemap generation cacheable with a `revalidate` period, or implement it as a route handler with explicit `Cache-Control` and a cached payload.
- Split into a sitemap index plus paged image sitemaps when the gallery grows, instead of generating one maximal array.
- Cache topic and image-id payloads separately; invalidate only when images/topics change.

---

### PERF-P2-02 — [Medium] DB/query — first public gallery page pays an exact `COUNT(*) OVER()` even though load-more only needs `hasMore`

**Status:** Confirmed  
**Confidence:** High

**Evidence**
- `apps/web/src/lib/data.ts:359-384` implements `getImagesLitePage()` with `COUNT(*) OVER()` plus `limit(normalizedPageSize + 1).offset(offset)`.
- The home page calls it for the first page at `apps/web/src/app/[locale]/(public)/page.tsx:127-129`.
- Topic pages call it at `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:132-134`.
- `apps/web/src/lib/data.ts:371-375` includes both the public select fields and `total_count: COUNT(*) OVER()`.
- The client load-more flow only needs the next page and `hasMore` (`apps/web/src/components/load-more.tsx:36-41`).

**Failure scenario**
For a large processed image table, `COUNT(*) OVER()` forces the database to evaluate the full filtered result set to compute an exact total before returning 30 visible rows. Tag/topic filters and offset pagination make this worse, and it happens on the most important public entry points.

**Concrete fix**
- Return `hasMore` by fetching `PAGE_SIZE + 1` rows without an exact count for initial public gallery pages.
- If the UI needs a total, maintain denormalized per-topic/tag counts or fetch a cached count asynchronously.
- Consider keyset pagination `(capture_date, created_at, id)` for later pages instead of growing offsets.

---

### PERF-P2-03 — [Medium] Disk I/O — deleting images scans derivative directories per image and per format

**Status:** Confirmed  
**Confidence:** High

**Evidence**
- `apps/web/src/lib/process-image.ts:170-205` deletes variants deterministically only when a sizes list is supplied; when `sizes` is empty it opens and scans the whole directory (`apps/web/src/lib/process-image.ts:183-195`).
- Single-image deletion deliberately passes empty sizes for WebP/AVIF/JPEG at `apps/web/src/app/actions/images.ts:410-418`.
- Bulk deletion allows up to 100 images at `apps/web/src/app/actions/images.ts:449-451`.
- Bulk cleanup maps all selected image records concurrently at `apps/web/src/app/actions/images.ts:516-534`, and each record performs three empty-size derivative scans.

**Failure scenario**
Deleting 100 images from a large gallery can trigger up to 300 directory scans over upload derivative directories, then a burst of unlink calls. On network storage or a directory with many variants, this can block the event loop with filesystem work, slow admin actions, and contend with image serving/processing.

**Concrete fix**
- Delete current configured deterministic filenames on the request path.
- For legacy variants, scan each format directory at most once per bulk operation, build a prefix map, then unlink matches with a bounded concurrency limiter.
- Consider moving legacy cleanup to a background maintenance job and keeping admin deletion latency predictable.

---

### PERF-P2-04 — [Medium] Memory — CSV export materializes rows, line array, final string, server-action payload, and browser Blob

**Status:** Confirmed  
**Confidence:** High

**Evidence**
- `apps/web/src/app/[locale]/admin/db-actions.ts:50-65` loads a grouped export result set with `limit(50000)`.
- `apps/web/src/app/[locale]/admin/db-actions.ts:67-84` builds a `csvLines` array for every row.
- `apps/web/src/app/[locale]/admin/db-actions.ts:86-98` drops the result reference but then joins all CSV lines into one string and returns it from the server action.
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-114` receives that string, creates a browser `Blob`, an object URL, and triggers the download.

**Failure scenario**
A 50k-row export with long titles/tags can allocate the DB results, many line strings, the joined string, the serialized server-action response, and the browser Blob. This can spike memory on both server and browser and risks server-action response limits/timeouts.

**Concrete fix**
- Replace the server action with a streaming route handler (`text/csv`) that writes rows incrementally from a cursor/paginated query.
- Avoid `GROUP_CONCAT` for very large exports or stream tags through a join sorted by image id.
- If streaming is too large a change, write the CSV to a temp file in chunks and return a short-lived download URL.

---

### PERF-P2-05 — [Medium] DB/query — public search uses leading-wildcard `LIKE` across text fields, tags, and aliases

**Status:** Likely  
**Confidence:** Medium-High

**Evidence**
- `apps/web/src/app/actions/public.ts:43-50` allows public searches with two-character queries.
- `apps/web/src/lib/data.ts:731-757` builds `%query%` and applies leading-wildcard `LIKE` to title, description, camera model, topic slug, and topic label.
- If the first query does not fill the limit, tag search runs another leading-wildcard query at `apps/web/src/lib/data.ts:771-794`.
- Alias search can run a third leading-wildcard query at `apps/web/src/lib/data.ts:797-820`.
- `apps/web/src/db/schema.ts:61-66` defines processed/topic/date/user-filename indexes but no full-text/search index for those text fields.

**Failure scenario**
A short popular query such as `an` or a common camera substring scans many processed rows and can trigger two more joins/groupings. The server has rate limiting, but legitimate public search traffic can still consume DB CPU and buffer pool during gallery browsing.

**Concrete fix**
- Raise the public search minimum to at least 3 characters unless using a search index.
- Add MySQL full-text/ngram indexes or a dedicated normalized search table; use prefix/exact matching for tags and aliases where possible.
- Add query timeouts and short-lived result caching for repeated public searches.

---

### PERF-P2-06 — [Medium] DB/query — rate-limit bucket purge filters by `bucket_start` without a matching leftmost index

**Status:** Likely  
**Confidence:** Medium-High

**Evidence**
- `apps/web/src/db/schema.ts:136-143` defines `rate_limit_buckets` with a primary key `(ip, bucket_type, bucket_start)` only.
- The baseline migration matches that primary key at `apps/web/drizzle/0001_sync_current_schema.sql:22-28` and does not add a `bucket_start` secondary index near the other indexes at `apps/web/drizzle/0001_sync_current_schema.sql:72-81`.
- `apps/web/src/lib/rate-limit.ts:272-274` purges old rows with `WHERE bucket_start < cutoff`.

**Failure scenario**
As the rate-limit table grows, the hourly purge cannot efficiently use the composite primary key because `bucket_start` is not the leftmost column. The purge can devolve into a table/index scan and contend with login/search/upload rate-limit updates.

**Concrete fix**
- Add a secondary index on `bucket_start`, or `(bucket_type, bucket_start)` if purges become type-specific.
- Chunk deletes by age/limit if table growth is high.
- Add an `EXPLAIN DELETE` check in migration validation to confirm index use.

---

### PERF-P2-07 — [Medium] Browser memory/UI — upload preview creates object URLs and renders every selected original without size/count guardrails

**Status:** Likely  
**Confidence:** Medium

**Evidence**
- `apps/web/src/components/upload-dropzone.tsx:52-80` creates object URLs for all selected files.
- `apps/web/src/components/upload-dropzone.tsx:116-120` configures `useDropzone()` with only `accept`; it does not set `maxFiles` or `maxSize`.
- `apps/web/src/components/upload-dropzone.tsx:304-327` maps every selected file and renders an `<img src={previewUrl}>` for each original object URL.

**Failure scenario**
An admin selects dozens or hundreds of large camera images. Even before upload starts, the browser may decode many large originals for previews, consuming memory and causing tab jank or crashes. Unsupported formats may still create object URLs and broken image decode attempts.

**Concrete fix**
- Set `maxFiles` and `maxSize` in `useDropzone()` to mirror server limits.
- Window/virtualize the preview grid and generate small preview thumbnails rather than binding every original file to an `<img>`.
- For RAW/HEIC/TIFF, show metadata/file cards unless a bounded thumbnail worker can decode them safely.

---

### PERF-P2-08 — [Medium] UI responsiveness — gallery load-more retains every loaded image and renders all cards in CSS columns

**Status:** Likely  
**Confidence:** Medium

**Evidence**
- `apps/web/src/components/home-client.tsx:84-88` stores all loaded images and appends every load-more page.
- `apps/web/src/components/home-client.tsx:108-110` renders directly from the full `allImages` array.
- `apps/web/src/components/home-client.tsx:148-149` maps every retained image into CSS columns.
- `apps/web/src/components/load-more.tsx:21-41` keeps increasing offset and invokes `onLoadMore()` for each page.
- `apps/web/src/components/load-more.tsx:72-82` auto-loads as the sentinel enters view.

**Failure scenario**
A visitor scrolls deeply through a large gallery. The client retains all card data, DOM nodes, image components, layout state, and decoded image memory. CSS columns also require broad layout recalculation as cards are appended, producing jank on mobile/older devices.

**Concrete fix**
- Add a retention/windowing strategy: keep a bounded number of pages in DOM, or switch to explicit pagination for large galleries.
- Use `content-visibility: auto`/containment on cards as an incremental mitigation.
- If masonry UX must remain, evaluate a virtualized masonry/list approach with scroll restoration.

---

### PERF-P3-01 — [Low] Bundle/runtime — photo viewer imports optional heavy UI paths in the initial client bundle

**Status:** Likely  
**Confidence:** Medium

**Evidence**
- The route dynamically imports the whole `PhotoViewer` at `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:16-18`.
- `apps/web/src/components/photo-viewer.tsx:8-20` statically imports `framer-motion`, `Lightbox`, `InfoBottomSheet`, `Histogram`, icons, and share action helpers.
- Histogram is only shown in the details sidebar (`apps/web/src/components/photo-viewer.tsx:524-530`).
- Lightbox is rendered only when opened (`apps/web/src/components/photo-viewer.tsx:566-575`).
- The bottom sheet is passed `isOpen` state at `apps/web/src/components/photo-viewer.tsx:577-583`.

**Failure scenario**
First photo view pays JS parse/download cost for optional interactions most visitors do not use, especially histogram/lightbox/bottom-sheet code. This can delay interactivity on mobile even though the main image is the critical path.

**Concrete fix**
- Lazy-load `Lightbox`, `Histogram`, and mobile bottom sheet when the user opens the corresponding UI.
- Run `next build` with bundle analyzer before/after to confirm meaningful chunk reduction.
- Keep the primary image/navigation path in the initial viewer chunk.

---

### PERF-P3-02 — [Low] UI responsiveness — high-frequency touch handlers update React state on every move

**Status:** Likely  
**Confidence:** Medium

**Evidence**
- `apps/web/src/components/photo-navigation.tsx:53-93` handles every `touchmove`, calls `preventDefault()`, calculates swipe state, and updates React state with `setSwipeOffset()`.
- `apps/web/src/components/photo-navigation.tsx:130-132` attaches window-level touch listeners, including a non-passive `touchmove` listener.
- `apps/web/src/components/info-bottom-sheet.tsx:60-65` calls `setLiveTranslateY()` on each touch move.
- `apps/web/src/components/info-bottom-sheet.tsx:154-164` applies the live value to transform style.

**Failure scenario**
On lower-end mobile devices, drag/swipe interactions can schedule many React renders per second. Because the photo navigation listener is window-level and non-passive, it can also interfere with scroll handling outside the intended gesture surface.

**Concrete fix**
- Store live gesture deltas in refs and apply transforms via `requestAnimationFrame`/imperative style updates; commit React state only at gesture end or snap points.
- Scope listeners to the image/sheet surface rather than `window` where possible.
- Use passive listeners until a horizontal gesture is positively identified; then call `preventDefault()` in the narrow active phase.

---

### PERF-P3-03 — [Low] Cache churn — many admin mutations combine narrow path revalidation with root-layout invalidation

**Status:** Risk  
**Confidence:** Medium

**Evidence**
- `apps/web/src/lib/revalidation.ts:30-40` revalidates localized path variants for explicit paths.
- `apps/web/src/lib/revalidation.ts:55-57` exposes `revalidateAllAppData()` as `revalidatePath('/', 'layout')`.
- Tag mutations call both narrow paths and full layout invalidation, e.g. `apps/web/src/app/actions/tags.ts:88-89`, `apps/web/src/app/actions/tags.ts:190-191`, `apps/web/src/app/actions/tags.ts:247-248`, `apps/web/src/app/actions/tags.ts:319-320`, and `apps/web/src/app/actions/tags.ts:431-432`.
- Topic mutations do the same at `apps/web/src/app/actions/topics.ts:128-130`, `apps/web/src/app/actions/topics.ts:269-270`, `apps/web/src/app/actions/topics.ts:340-341`, `apps/web/src/app/actions/topics.ts:401-402`, and `apps/web/src/app/actions/topics.ts:469-470`.
- SEO settings intentionally invalidate the layout at `apps/web/src/app/actions/seo.ts:126-130`.

**Failure scenario**
Bulk tag/topic edits can invalidate more cached public/admin data than necessary. Once the photo-page cookie issue is fixed, overly broad layout invalidation can still reduce cache hit rate and cause avoidable re-render/DB bursts after admin changes.

**Concrete fix**
- Define an invalidation policy: reserve layout invalidation for global SEO/config changes; use route/tag-scoped invalidation for image/topic/tag mutations.
- Deduplicate narrow and broad calls in each action so a mutation does not both target specific paths and flush the root layout.
- Consider `revalidateTag()` data-cache tags for `images`, `topics`, `tags`, and `seo` if the app leans further into cached data fetches.

---

## Positive observations / current non-findings

- Queue bootstrap is now bounded: `apps/web/src/lib/image-queue.ts:385-402` selects only needed columns and limits batches, and `apps/web/src/lib/image-queue.ts:414-423` schedules continuation instead of enqueuing the full backlog at once.
- Original upload saving streams the file to disk instead of materializing the full file on the JS heap: `apps/web/src/lib/process-image.ts:242-257`.
- Public load-more already avoids exact counts and fetches `limit + 1`: `apps/web/src/app/actions/public.ts:36-40`.
- Shared-group tag hydration is batched, avoiding a per-image tag query pattern: `apps/web/src/lib/data.ts:632-655`.
- nginx serves upload derivatives directly with immutable caching under `/uploads/`: `apps/web/nginx/default.conf:89-105`.
- Database dump/restore code generally streams through child processes/temp files rather than one giant string; the CSV export path is the remaining memory-heavy admin export path.

## Final sweep for skipped/missed issues

- Re-swept repo-wide for performance hot spots: queue concurrency, Sharp usage, unbounded `Promise.all`, `COUNT(*)`, leading-wildcard `LIKE`, offset pagination, `dynamic`/`revalidate`, `revalidateAllAppData`, `createObjectURL`, scroll/touch handlers, histogram/canvas workers, upload/body limits, and filesystem directory scans.
- Rechecked prior performance-review leads against current code. The old unbounded queue-bootstrap issue is no longer present; it is listed as a non-finding above.
- No review-relevant tracked files from the inventory were intentionally skipped. The only skipped paths were generated/runtime/historical artifacts listed in the scope section.
- No runtime profiling, load test, DB `EXPLAIN`, or bundle analyzer was executed; confidence is based on static code evidence and known framework/database behavior.

## Full reviewed inventory

### apps/web config/public/deploy (19)
- `apps/web/.env.local.example`
- `apps/web/Dockerfile`
- `apps/web/README.md`
- `apps/web/components.json`
- `apps/web/deploy.sh`
- `apps/web/docker-compose.yml`
- `apps/web/drizzle.config.ts`
- `apps/web/eslint.config.mjs`
- `apps/web/next.config.ts`
- `apps/web/nginx/default.conf`
- `apps/web/package.json`
- `apps/web/playwright.config.ts`
- `apps/web/postcss.config.mjs`
- `apps/web/public/histogram-worker.js`
- `apps/web/tailwind.config.ts`
- `apps/web/tsconfig.json`
- `apps/web/tsconfig.scripts.json`
- `apps/web/tsconfig.typecheck.json`
- `apps/web/vitest.config.ts`

### apps/web/drizzle migrations/meta (7)
- `apps/web/drizzle/0000_nappy_madelyne_pryor.sql`
- `apps/web/drizzle/0001_sync_current_schema.sql`
- `apps/web/drizzle/0002_fix_processed_default.sql`
- `apps/web/drizzle/0003_audit_created_at_index.sql`
- `apps/web/drizzle/meta/0000_snapshot.json`
- `apps/web/drizzle/meta/0001_snapshot.json`
- `apps/web/drizzle/meta/_journal.json`

### apps/web/e2e tests (6)
- `apps/web/e2e/admin.spec.ts`
- `apps/web/e2e/helpers.ts`
- `apps/web/e2e/nav-visual-check.spec.ts`
- `apps/web/e2e/origin-guard.spec.ts`
- `apps/web/e2e/public.spec.ts`
- `apps/web/e2e/test-fixes.spec.ts`

### apps/web/messages i18n data (2)
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

### apps/web/scripts tooling (14)
- `apps/web/scripts/check-action-origin.ts`
- `apps/web/scripts/check-api-auth.ts`
- `apps/web/scripts/ensure-site-config.mjs`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/scripts/init-db.ts`
- `apps/web/scripts/migrate-admin-auth.ts`
- `apps/web/scripts/migrate-aliases.ts`
- `apps/web/scripts/migrate-capture-date.js`
- `apps/web/scripts/migrate-titles.ts`
- `apps/web/scripts/migrate.js`
- `apps/web/scripts/migration-add-column.ts`
- `apps/web/scripts/mysql-connection-options.js`
- `apps/web/scripts/seed-admin.ts`
- `apps/web/scripts/seed-e2e.ts`

### apps/web/src application code (204)
- `apps/web/src/__tests__/action-guards.test.ts`
- `apps/web/src/__tests__/admin-user-create-ordering.test.ts`
- `apps/web/src/__tests__/admin-users.test.ts`
- `apps/web/src/__tests__/auth-rate-limit-ordering.test.ts`
- `apps/web/src/__tests__/auth-rate-limit.test.ts`
- `apps/web/src/__tests__/auth-rethrow.test.ts`
- `apps/web/src/__tests__/backup-download-route.test.ts`
- `apps/web/src/__tests__/backup-filename.test.ts`
- `apps/web/src/__tests__/base56.test.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/check-api-auth.test.ts`
- `apps/web/src/__tests__/clipboard.test.ts`
- `apps/web/src/__tests__/csv-escape.test.ts`
- `apps/web/src/__tests__/data-pagination.test.ts`
- `apps/web/src/__tests__/db-pool-connection-handler.test.ts`
- `apps/web/src/__tests__/db-restore.test.ts`
- `apps/web/src/__tests__/error-shell.test.ts`
- `apps/web/src/__tests__/exif-datetime.test.ts`
- `apps/web/src/__tests__/gallery-config-shared.test.ts`
- `apps/web/src/__tests__/health-route.test.ts`
- `apps/web/src/__tests__/histogram.test.ts`
- `apps/web/src/__tests__/image-queue-bootstrap.test.ts`
- `apps/web/src/__tests__/image-queue.test.ts`
- `apps/web/src/__tests__/image-url.test.ts`
- `apps/web/src/__tests__/images-actions.test.ts`
- `apps/web/src/__tests__/lightbox.test.ts`
- `apps/web/src/__tests__/live-route.test.ts`
- `apps/web/src/__tests__/locale-path.test.ts`
- `apps/web/src/__tests__/next-config.test.ts`
- `apps/web/src/__tests__/photo-title.test.ts`
- `apps/web/src/__tests__/privacy-fields.test.ts`
- `apps/web/src/__tests__/public-actions.test.ts`
- `apps/web/src/__tests__/queue-shutdown.test.ts`
- `apps/web/src/__tests__/rate-limit.test.ts`
- `apps/web/src/__tests__/request-origin.test.ts`
- `apps/web/src/__tests__/restore-maintenance.test.ts`
- `apps/web/src/__tests__/revalidation.test.ts`
- `apps/web/src/__tests__/safe-json-ld.test.ts`
- `apps/web/src/__tests__/sanitize.test.ts`
- `apps/web/src/__tests__/seo-actions.test.ts`
- `apps/web/src/__tests__/serve-upload.test.ts`
- `apps/web/src/__tests__/session.test.ts`
- `apps/web/src/__tests__/shared-page-title.test.ts`
- `apps/web/src/__tests__/sql-restore-scan.test.ts`
- `apps/web/src/__tests__/storage-local.test.ts`
- `apps/web/src/__tests__/tag-input.test.ts`
- `apps/web/src/__tests__/tag-records.test.ts`
- `apps/web/src/__tests__/tag-slugs.test.ts`
- `apps/web/src/__tests__/tags-actions.test.ts`
- `apps/web/src/__tests__/topics-actions.test.ts`
- `apps/web/src/__tests__/upload-dropzone.test.ts`
- `apps/web/src/__tests__/upload-limits.test.ts`
- `apps/web/src/__tests__/upload-tracker.test.ts`
- `apps/web/src/__tests__/validation.test.ts`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/layout.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/[locale]/admin/(protected)/categories/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/error.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/layout.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/loading.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/page.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/users/page.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/[locale]/admin/layout.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/[locale]/error.tsx`
- `apps/web/src/app/[locale]/globals.css`
- `apps/web/src/app/[locale]/layout.tsx`
- `apps/web/src/app/[locale]/loading.tsx`
- `apps/web/src/app/[locale]/not-found.tsx`
- `apps/web/src/app/actions.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/public.ts`
- `apps/web/src/app/actions/seo.ts`
- `apps/web/src/app/actions/settings.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/health/route.ts`
- `apps/web/src/app/api/live/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/apple-icon.tsx`
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/icon.tsx`
- `apps/web/src/app/manifest.ts`
- `apps/web/src/app/robots.ts`
- `apps/web/src/app/sitemap.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/i18n-provider.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/topic-empty-state.tsx`
- `apps/web/src/components/ui/alert-dialog.tsx`
- `apps/web/src/components/ui/alert.tsx`
- `apps/web/src/components/ui/aspect-ratio.tsx`
- `apps/web/src/components/ui/badge.tsx`
- `apps/web/src/components/ui/button.tsx`
- `apps/web/src/components/ui/card.tsx`
- `apps/web/src/components/ui/dialog.tsx`
- `apps/web/src/components/ui/dropdown-menu.tsx`
- `apps/web/src/components/ui/input.tsx`
- `apps/web/src/components/ui/label.tsx`
- `apps/web/src/components/ui/progress.tsx`
- `apps/web/src/components/ui/scroll-area.tsx`
- `apps/web/src/components/ui/select.tsx`
- `apps/web/src/components/ui/separator.tsx`
- `apps/web/src/components/ui/sheet.tsx`
- `apps/web/src/components/ui/skeleton.tsx`
- `apps/web/src/components/ui/sonner.tsx`
- `apps/web/src/components/ui/switch.tsx`
- `apps/web/src/components/ui/table.tsx`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/seed.ts`
- `apps/web/src/i18n/request.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/action-result.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/csv-escape.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/error-shell.ts`
- `apps/web/src/lib/exif-datetime.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/image-types.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/photo-title.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/restore-maintenance.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/seo-og-url.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/storage/index.ts`
- `apps/web/src/lib/storage/local.ts`
- `apps/web/src/lib/storage/types.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/lib/tag-slugs.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/upload-tracker.ts`
- `apps/web/src/lib/utils.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/proxy.ts`
- `apps/web/src/site-config.example.json`

### repo automation/editor config (7)
- `.github/assets/logo.svg`
- `.github/dependabot.yml`
- `.github/workflows/quality.yml`
- `.vscode/extensions.json`
- `.vscode/launch.json`
- `.vscode/settings.json`
- `.vscode/tasks.json`

### repo docs/config (7)
- `.env.deploy.example`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `package-lock.json`
- `package.json`
- `scripts/deploy-remote.sh`
