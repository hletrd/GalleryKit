# Performance / Dependency Review — Cycle 1 (PROMPT 1)

## Scope and inventory

No sampling was used. I reviewed the dependency/build manifests, runtime config, DB schema and access layer, image-processing pipeline, queueing, caching headers, client bundle entrypoints, and route-level hot paths under `apps/web/`.

### Dependency / build / runtime config reviewed
- `package.json`
- `apps/web/package.json`
- `apps/web/next.config.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/scripts/entrypoint.sh`
- `apps/web/scripts/ensure-site-config.mjs`
- `.nvmrc`

### DB / query / cache / runtime hot-path reviewed
- `apps/web/src/db/index.ts`
- `apps/web/src/db/schema.ts`
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/gallery-config.ts`
- `apps/web/src/lib/gallery-config-shared.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/request-origin.ts`
- `apps/web/src/lib/action-guards.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/tag-records.ts`
- `apps/web/src/lib/upload-paths.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/sanitize.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/backup-filename.ts`
- `apps/web/src/lib/db-restore.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/restore-maintenance.ts`

### Route / page entrypoints reviewed
- Public: `apps/web/src/app/[locale]/layout.tsx`, `apps/web/src/app/[locale]/(public)/layout.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- Admin: `apps/web/src/app/[locale]/admin/layout.tsx`, `apps/web/src/app/[locale]/admin/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, `apps/web/src/app/[locale]/admin/db-actions.ts`
- API / metadata: `apps/web/src/app/api/admin/db/download/route.ts`, `apps/web/src/app/api/og/route.tsx`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/robots.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/icon.tsx`, `apps/web/src/app/apple-icon.tsx`

### Client / bundle hot-path reviewed
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/photo-navigation.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/ui/sonner.tsx`

### Dependency / compatibility snapshot
- The stack is internally consistent at a glance: `next@16.2.3`, `react@19.2.5`, `react-dom@19.2.5`, `engines.node >=24`, and `.nvmrc` set to `24`.
- I did not confirm a blocking package mismatch or a specific CVE from the checked manifests during this pass.

## Findings

### 1) Gallery list queries do extra work per page and can scale poorly as the library grows
**Status:** Likely risk  
**Severity:** Medium  
**Confidence:** High

**Files / regions:**
- `apps/web/src/lib/data.ts:359-385` (`getImagesLitePage`)
- `apps/web/src/lib/data.ts:420-429` (`getAdminImagesLite`)
- `apps/web/src/app/[locale]/(public)/page.tsx:64-67`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:122-133`
- `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx` (admin list path)

**What I saw:**
`getImagesLitePage()` selects `tag_names` through a correlated `GROUP_CONCAT` subquery and also computes `COUNT(*) OVER()` for every row in the page. The same pattern is reused in `getAdminImagesLite()`. The homepage and topic pages call `getImagesLitePage()` directly, so the hot path pays for both the row payload and the total-count computation on every request.

**Failure scenario:**
Once the gallery grows into thousands of images, the homepage/topic page query can start scanning far more rows than are actually rendered, which increases latency and DB CPU even though the UI only needs 30 cards. The correlated tag aggregation also multiplies the work per row. If the table grows much more, this can turn the public landing pages and the admin dashboard into slow, expensive queries.

**Suggested fix:**
- Split the total-count query from the page query, and only run it when the UI actually needs the count.
- Replace the per-row tag aggregation subquery with a batched tag fetch keyed by returned image ids, or a joined pre-aggregation CTE.
- If total counts are only decorative, consider caching or approximating them for public pages.

---

### 2) Audit-log retention purge will likely table-scan because the purge predicate is not indexed
**Status:** Confirmed issue  
**Severity:** Medium  
**Confidence:** High

**Files / regions:**
- `apps/web/src/lib/audit.ts:46-57`
- `apps/web/src/db/schema.ts:113-125`

**What I saw:**
`purgeOldAuditLog()` deletes rows with `lt(auditLog.created_at, cutoff)`, but the schema only defines indexes on `(user_id, created_at)` and `(action, created_at)`. There is no standalone `created_at` index for the retention purge.

**Failure scenario:**
As `audit_log` grows, the scheduled cleanup can degrade into a full table scan and a large delete, which is exactly the kind of background task that causes write stalls or lock contention on busy databases. If the table becomes large enough, this can also lengthen startup because `bootstrapImageProcessingQueue()` calls the purge on boot and then again hourly.

**Suggested fix:**
- Add an index on `audit_log.created_at`.
- If retention volume is very high, consider periodic archival or table partitioning instead of a single bulk delete.

---

### 3) The global server-action body limit is set to the upload cap, which broadens the DoS surface
**Status:** Likely risk  
**Severity:** Medium  
**Confidence:** High

**Files / regions:**
- `apps/web/next.config.ts:100-106`
- `apps/web/src/lib/upload-limits.ts:1-22`
- `apps/web/src/app/actions/images.ts:83-168`

**What I saw:**
`next.config.ts` sets both `experimental.serverActions.bodySizeLimit` and `proxyClientMaxBodySize` to `NEXT_UPLOAD_BODY_SIZE_LIMIT`, and that constant defaults to `2 GiB`. The upload action does need a large body allowance, but the framework-wide limit applies to every server action, not just uploads.

**Failure scenario:**
Any server action, including small admin mutations, now accepts an extremely large request body before the framework rejects it. That increases the cost of parsing accidental or malicious oversized requests and makes the upload limit an app-wide attack surface instead of a dedicated upload-path limit.

**Suggested fix:**
- Lower the global server-action body limit to the largest non-upload payload the app actually needs.
- Move large file uploads to a dedicated upload endpoint or route with a separate, explicitly large limit.
- Keep upload-specific size checks in the action, but do not reuse them as the global framework cap.

---

### 4) Image-processing throughput can spike because startup enqueues everything and each job fans out to three Sharp pipelines
**Status:** Likely risk  
**Severity:** Medium  
**Confidence:** Medium

**Files / regions:**
- `apps/web/src/lib/image-queue.ts:111-117`
- `apps/web/src/lib/image-queue.ts:323-355`
- `apps/web/src/lib/image-queue.ts:236-244`
- `apps/web/src/lib/process-image.ts:381-444`
- `apps/web/scripts/entrypoint.sh:24-31`

**What I saw:**
The queue is created with `PQueue({ concurrency: Number(process.env.QUEUE_CONCURRENCY) || 2 })`, but each image job then calls `processImageFormats()`, which runs WebP/AVIF/JPEG generation in parallel via `Promise.all`. On startup, the queue also selects every unprocessed image and enqueues it immediately.

**Failure scenario:**
If the backlog is large or uploads arrive in bursts, the app can hold many pending jobs in memory while each running job fans out into three Sharp pipelines. That can saturate CPU, libvips threads, and memory, increasing response times for unrelated requests or causing the process to thrash under load.

**Suggested fix:**
- Drain pending jobs in batches instead of enqueueing the entire backlog at once.
- Consider serializing formats per image, or lowering queue concurrency when Sharp concurrency is already high.
- Add backpressure / batching around startup replay so the queue length stays bounded.

---

### 5) Public navigation ships search + theme wiring on every page, even when the search dialog is never opened
**Status:** Likely risk  
**Severity:** Medium  
**Confidence:** High

**Files / regions:**
- `apps/web/src/app/[locale]/layout.tsx:3-4, 93-104`
- `apps/web/src/app/[locale]/(public)/layout.tsx:1-18`
- `apps/web/src/components/nav.tsx:6-12`
- `apps/web/src/components/nav-client.tsx:1-16, 135-160`
- `apps/web/src/components/search.tsx:1-20`
- `apps/web/src/components/theme-provider.tsx:1-11`
- `apps/web/src/components/ui/sonner.tsx:10-40`

**What I saw:**
Every public page renders `Nav`, which mounts `NavClient`, and `NavClient` imports `Search`. The root locale layout also wraps all pages in `ThemeProvider` and `Toaster`.

**Failure scenario:**
Visitors who only want to read the gallery still pay for the search overlay machinery, theme provider, toast provider, and their dependent packages in the client bundle/hydration cost. That is a steady TTI hit on the highest-traffic pages, especially on mobile and slower devices.

**Suggested fix:**
- Lazy-load the search dialog and only hydrate it when the user clicks the button or presses the shortcut.
- Split the theme toggle and toaster into smaller islands if they do not need to be global.
- Re-check the public route bundle after each split to verify the initial payload shrinks.

---

### 6) Photo viewer pages pull in a heavy client stack that is visible on public photo/share routes
**Status:** Likely risk  
**Severity:** Medium  
**Confidence:** Medium

**Files / regions:**
- `apps/web/src/components/photo-viewer.tsx:1-20, 56-140`
- `apps/web/src/components/lightbox.tsx:1-47, 67-140`
- `apps/web/src/components/histogram.tsx` (worker/canvas-heavy viewer subcomponent)
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:16-18, 220-232`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:10, 118-143`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:8, 115-126`

**What I saw:**
`PhotoViewer` imports `framer-motion`, `sonner`, lightbox, histogram, navigation, image zoom, and clipboard/share helpers. The standard photo page uses a dynamic import for it, but the shared group and shared single-photo pages import it directly.

**Failure scenario:**
The photo/share experience becomes slower to hydrate than it needs to be, and the public shared pages pay for animation and viewer tooling even before the user opens the lightbox or interacts with the extra controls.

**Suggested fix:**
- Split lightbox, histogram, and info-sheet features into independently loaded subcomponents.
- Replace motion where possible with CSS transitions or a lighter animation layer.
- Keep the shared pages on the same split points as the primary photo page so route payloads stay consistent.

---

### 7) Retry query parameters on local images can fragment the optimizer cache
**Status:** Likely risk  
**Severity:** Low  
**Confidence:** Medium

**Files / regions:**
- `apps/web/src/components/optimistic-image.tsx:29-37`
- `apps/web/next.config.ts:107-116`

**What I saw:**
`OptimisticImage` retries failed images by appending `?retry=N` to the local upload URL. The Next image config explicitly allows local patterns with arbitrary query strings (`search: '?**'`).

**Failure scenario:**
Transient image-processing failures can create many distinct optimizer cache keys for the same underlying upload, which reduces cache hit rate and can grow `.next/cache/images` unnecessarily. If retries are common, the app ends up paying for duplicate optimization work.

**Suggested fix:**
- Avoid encoding retry state in the image URL for local uploads if a stable key can be used instead.
- If query-based retries are necessary, keep the retry budget low and validate the cache footprint after repeated failures.

## Missed-issues sweep

I did a final sweep across the remaining hot-path files and did not find additional actionable performance/dependency issues beyond the items above.

Areas explicitly re-checked in the sweep:
- `apps/web/src/lib/serve-upload.ts` and `apps/web/src/lib/upload-paths.ts` for caching / path handling
- `apps/web/src/lib/rate-limit.ts`, `apps/web/src/lib/session.ts`, and `apps/web/src/lib/request-origin.ts` for runtime contention / compatibility regressions
- `apps/web/src/lib/revalidation.ts` and `apps/web/src/app/actions/*` for redundant invalidation or expensive mutation paths
- `apps/web/src/app/api/*`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/robots.ts`, and `apps/web/src/app/sitemap.ts` for cache/header issues
- `apps/web/src/components/home-client.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/image-manager.tsx`, and `apps/web/src/components/upload-dropzone.tsx` for additional client-bundle or runtime hot-path regressions

## Conclusion

I found one confirmed issue and several high-confidence likely risks. The most important follow-ups are:
1. Add the missing audit-log index.
2. Reduce the framework-wide server-action body limit.
3. Rework the list-page query shape before the gallery grows further.
4. Revisit the public client bundle splits and the image-processing queue fan-out.
