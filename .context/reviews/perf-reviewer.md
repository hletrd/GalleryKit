# Performance / Concurrency / Resource Review — perf-reviewer

Repo: `/Users/hletrd/flash-shared/gallery`  
Date: 2026-04-28  
Mode: fan-out subagent B, review-only; no fixes implemented.

## Inventory and coverage

Inventory was built before reviewing via `git ls-files` plus `git status --short`, excluding `node_modules`, `.next`/build output, generated tsbuildinfo, public uploaded image outputs, and binary artifacts unless directly relevant to runtime behavior.

- Reviewed tracked text/config/test surface: 930 text-ish tracked files (`.ts` 166, `.tsx` 80, `.json` 18, `.sql` 4, `.js/.mjs` 7, `.yml` 3, `.sh` 3, `.md` 635, plus small config/asset files).
- Runtime source reviewed: `apps/web/src/app/**`, `components/**`, `lib/**`, `db/**`, API/upload routes, server actions, instrumentation, migrations/schema.
- Deployment/config reviewed: root/app package files, Next/Vitest/Playwright configs, Dockerfile, compose, nginx, CI workflow, entrypoint/deploy scripts, README deployment contracts.
- Test architecture reviewed where it affects performance gates and regressions: 70 unit/integration test files and 6 Playwright specs were inventoried; skips were checked and the CI env was cross-checked.

Uncommitted files present at review start and included where relevant:

```text
 M .context/reviews/_aggregate.md
 M .context/reviews/architect.md
 M .context/reviews/code-reviewer.md
 M .context/reviews/critic.md
 M .context/reviews/designer.md
 M .context/reviews/perf-reviewer.md
M  .context/reviews/security-reviewer.md
 M .context/reviews/test-engineer.md
 M .context/reviews/tracer.md
 M .context/reviews/verifier.md
 M .gitignore
 M apps/web/playwright.config.ts
 M apps/web/src/__tests__/touch-target-audit.test.ts
 M apps/web/src/components/lightbox.tsx
 M apps/web/vitest.config.ts
```

This report intentionally replaces only `.context/reviews/perf-reviewer.md`.

## Findings

### P1 — Client upload concurrency fights a server-wide upload/config lock

- **Classification:** Confirmed issue
- **Severity:** High
- **Confidence:** High
- **Location:** `apps/web/src/components/upload-dropzone.tsx:185-254`, `apps/web/src/app/actions/images.ts:171-244`, `apps/web/src/app/actions/images.ts:429-430`, `apps/web/src/lib/upload-processing-contract-lock.ts:10-31`
- **Problem:** The client uploads up to three files in parallel (`UPLOAD_CONCURRENCY = 3`), but every `uploadImages()` call attempts to acquire one global MySQL named lock with a 5-second timeout. The action holds that lock across config reads, upload quota mutation, disk-space checks, original-file streaming, metadata/blur extraction, DB writes, tag inserts, and queue enqueue, then releases it in `finally`.
- **Failure scenario:** An admin drops several large RAW/JPEG files. The first request holds `gallerykit:upload_processing_contract` long enough for the other two in-flight requests to time out and return `uploadSettingsLocked`, even though the UI advertised parallel progress. This creates unnecessary failed uploads, wasted multipart parsing, extra DB lock attempts, and confusing user-visible errors.
- **Suggested fix:** Align the client with the serialized server contract by sending one file at a time, or narrow the lock to the exact settings/contract mutation section and move long I/O outside it. If true parallel uploads are required, replace the single named lock with a per-settings-version snapshot plus DB-backed quota claims.

### P2 — Image conversion can oversubscribe CPU by multiplying queue, format, and libvips parallelism

- **Classification:** Confirmed issue
- **Severity:** High
- **Confidence:** High
- **Location:** `apps/web/src/lib/process-image.ts:17-26`, `apps/web/src/lib/image-queue.ts:121-129`, `apps/web/src/lib/image-queue.ts:271-279`, `apps/web/src/lib/process-image.ts:389-478`
- **Problem:** `sharp.concurrency()` defaults to `availableParallelism() - 1`; the process-local `PQueue` defaults to two concurrent jobs; and each job renders WebP, AVIF, and JPEG concurrently with `Promise.all`. These controls multiply rather than form a single CPU budget.
- **Failure scenario:** On an 8-core host, the default can schedule 2 image jobs × 3 formats × up to 7 libvips workers. AVIF encoding is CPU-heavy, so foreground admin actions, public page rendering, DB callbacks, and Node's threadpool work can become starved during queue spikes.
- **Suggested fix:** Introduce one holistic image-processing budget. Practical options: default `QUEUE_CONCURRENCY=1`, cap `SHARP_CONCURRENCY` lower in production, render AVIF/WebP/JPEG sequentially per image or through a secondary format queue, and document sizing as `queue_concurrency * format_parallelism * sharp_concurrency <= host CPU budget`.

### P3 — Batch deletion can trigger hundreds of full derivative-directory scans concurrently

- **Classification:** Confirmed issue
- **Severity:** High
- **Confidence:** High
- **Location:** `apps/web/src/app/actions/images.ts:612-632`, `apps/web/src/lib/process-image.ts:173-214`
- **Problem:** `deleteImages()` runs cleanup for every selected image inside one `Promise.all`. For each image it calls `deleteImageVariants(..., [])` for WebP, AVIF, and JPEG. Passing an empty sizes array deliberately scans the entire derivative directory to find historical size variants.
- **Failure scenario:** Deleting 100 images from a gallery with thousands of files can launch 300 directory scans at once, plus unlink operations. On network or spinning disks this can saturate I/O, delay the server action, and cause admin timeouts or public image-serving latency.
- **Suggested fix:** Bound cleanup concurrency and amortize scans: group images by derivative directory, scan each directory once per batch to build a filename set, then unlink known matches. Keep the full-scan behavior for stale-size cleanup, but make it per directory per batch rather than per image per format.

### P4 — First public page loads perform exact grouped counts on every uncached request

- **Classification:** Likely issue at scale
- **Severity:** Medium
- **Confidence:** High
- **Location:** `apps/web/src/lib/data.ts:435-464`, `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/page.tsx:123-140`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:156-166`
- **Problem:** `getImagesLitePage()` selects image rows, left-joins tags, groups by image id, orders the page, and adds `COUNT(*) OVER()` for an exact total. The public home/topic pages have `revalidate = 0`, so this work happens for each request rather than through ISR.
- **Failure scenario:** A crawler or a burst of visitors hitting home/topic/filter pages forces MySQL to repeatedly evaluate grouped joins and exact counts over the matching image set, even when the UI only needs the first 30 images and `hasMore`.
- **Suggested fix:** Avoid exact totals on hot public pages. Use `limit + 1` for `hasMore`, cache/denormalize total counts, move counts behind a separate low-priority endpoint, or keep exact totals only for admin/reporting views.

### P5 — Uploaded images fall back to a Node route with per-request filesystem checks when nginx/CDN is not fronting them

- **Classification:** Likely issue in non-nginx or misconfigured deployments
- **Severity:** Medium
- **Confidence:** High
- **Location:** `apps/web/src/lib/image-url.ts:4-9`, `apps/web/src/lib/serve-upload.ts:32-102`, `apps/web/src/components/home-client.tsx:202-222`, `apps/web/nginx/default.conf:96-105`
- **Problem:** The application can stream `/uploads/...` through a Next route. That route validates segments, `realpath()`s the root, `lstat()`s the file, `realpath()`s the file, and creates a Node stream per image request. The nginx config has a faster static path, but it only helps if the documented reverse proxy is used correctly.
- **Failure scenario:** A deployment without nginx/CDN, or with nginx root/mount drift, sends every masonry thumbnail through Node. A single gallery view can generate dozens of filesystem syscalls and streams in the app process, competing with React rendering, server actions, and DB work.
- **Suggested fix:** Treat direct static serving as the required production path: verify nginx/CDN/X-Accel coverage in health checks/docs, or set `IMAGE_BASE_URL` to an asset origin. If the Node route remains a supported fallback, memoize the resolved upload root and consider ETag/Range support and explicit capacity limits.

### P6 — Public search uses leading-wildcard LIKE scans across images, tags, and aliases

- **Classification:** Likely issue at scale
- **Severity:** Medium
- **Confidence:** High
- **Location:** `apps/web/src/app/actions/public.ts:103-158`, `apps/web/src/lib/data.ts:810-916`
- **Problem:** Search accepts two-character queries and builds `%term%` LIKE predicates across image text fields, topic slug/label, tag name, and topic aliases. The tag and alias phases add joins and grouping. The action rate-limits search, but the SQL shape remains scan-heavy and cannot use ordinary B-tree indexes for leading wildcards.
- **Failure scenario:** Repeated common queries such as `a`, `an`, or camera model fragments can scan large parts of `images`, `tags`, and `topic_aliases`; with the default search budget, one client can still cause many expensive scans per minute.
- **Suggested fix:** Move to MySQL FULLTEXT/search index tables or a small denormalized search column indexed for full-text lookup. Raise the minimum query length for public search, cache popular results, and add query telemetry/slow-query alerts.

### P7 — Prev/next image lookups use OR-expanded keyset predicates without matching tie-breaker indexes

- **Classification:** Likely issue at scale
- **Severity:** Medium
- **Confidence:** Medium
- **Location:** `apps/web/src/lib/data.ts:547-619`, `apps/web/src/db/schema.ts:61-66`, `apps/web/drizzle/0001_sync_current_schema.sql:77-81`
- **Problem:** `getImage()` computes prev/next with multiple OR branches over `(capture_date, created_at, id)` and orders by the same tuple. The schema indexes include `(processed, capture_date, created_at)` and `(topic, processed, capture_date, created_at)`, but not the `id` tie-breaker. Optimizers often handle this OR shape poorly, especially with nullable `capture_date`.
- **Failure scenario:** Opening a photo on a large gallery triggers two extra queries that may scan/sort more rows than expected to find the adjacent image. This adds tail latency to the photo detail page and can amplify under crawlers or keyboard navigation.
- **Suggested fix:** Add a composite index that matches the complete order key, for example `(processed, capture_date, created_at, id)`, and consider rewriting prev/next as UNION-ed range queries or a persisted normalized sort key that handles `NULL` capture dates consistently.

### P8 — CSV export still materializes up to 50k rows and the full CSV in server memory

- **Classification:** Confirmed bounded issue
- **Severity:** Low
- **Confidence:** High
- **Location:** `apps/web/src/app/[locale]/admin/db-actions.ts:53-124`
- **Problem:** `exportImagesCsv()` caps rows at 50,000, but still materializes the DB result array, a `csvLines` array, and then the joined CSV string before returning it from a server action.
- **Failure scenario:** On a large gallery, one admin export can briefly consume tens of megabytes of heap and delay other requests in the same Node process. If multiple admins export concurrently, this can become visible memory pressure.
- **Suggested fix:** Convert CSV export to an authenticated streaming route or chunked file download. Keep the row cap, but avoid holding the whole result and output string simultaneously.

### P9 — Lightbox mouse movement recreates timers and sets state on every pointer movement

- **Classification:** Risk needing manual validation
- **Severity:** Low
- **Confidence:** Medium
- **Location:** `apps/web/src/components/lightbox.tsx:112-130`, `apps/web/src/components/lightbox.tsx:260-268`
- **Problem:** Every `mousemove` over the full-screen lightbox calls `showControls()`, clears/recreates a timeout, and calls `setControlsVisible(true)`. React may bail out when the value is unchanged, but the handler still performs frequent timer churn during normal pointer movement.
- **Failure scenario:** On low-end mobile/trackpad devices, moving the pointer while a high-resolution image is open can cause unnecessary main-thread work and timer allocation noise, competing with image decode and animations.
- **Suggested fix:** Throttle via `requestAnimationFrame`, only reset the timer when controls were hidden or when a coarse time threshold has elapsed, and avoid calling `setControlsVisible(true)` when already visible.

### P10 — Recent test timeout increases can hide performance regressions and hangs

- **Classification:** Risk needing validation
- **Severity:** Low
- **Confidence:** High
- **Location:** `apps/web/playwright.config.ts:32`, `apps/web/playwright.config.ts:61-68`, `apps/web/vitest.config.ts:10-12`
- **Problem:** The modified worktree raises the Playwright web-server timeout default to 1,800,000 ms and Vitest timeout to 120,000 ms. Long defaults reduce false negatives on slow machines, but they also make hung startup/tests slow to detect and can mask performance regressions in CI.
- **Failure scenario:** A DB connection hang, Next build deadlock, or accidentally long-running unit test can burn most of the CI job before failing, delaying feedback and making the performance signal less useful.
- **Suggested fix:** Keep short defaults and move slow-host accommodation behind explicit env overrides. Add targeted per-test timeouts only for known slow tests, and keep CI job timeouts aligned with expected runtime budgets.

### P11 — CI currently builds the Next app twice around E2E

- **Classification:** Confirmed inefficiency
- **Severity:** Low
- **Confidence:** High
- **Location:** `.github/workflows/quality.yml:75-79`, `apps/web/playwright.config.ts:61-68`
- **Problem:** The Playwright `webServer` command runs `npm run build && npm start`, then the workflow runs `npm run build` again immediately after E2E. This duplicates the most expensive frontend verification step.
- **Failure scenario:** CI minutes and developer wait time grow unnecessarily, and build-time resource spikes repeat back-to-back on the same runner. On a near-timeout job, the duplicate build can be the difference between passing and failing.
- **Suggested fix:** Build once and reuse the artifact for E2E plus the build gate, or move the explicit build before E2E and change Playwright's server command to `npm start` against that artifact. If the post-E2E build is intentional as a clean rebuild check, document that tradeoff and measure the added runtime.

### P12 — Startup permission repair can become O(file-count) on large upload trees

- **Classification:** Deployment performance risk
- **Severity:** Low
- **Confidence:** Medium
- **Location:** `apps/web/scripts/entrypoint.sh:4-10`, `apps/web/scripts/entrypoint.sh:12-22`, `apps/web/docker-compose.yml:22-25`
- **Problem:** On startup, the entrypoint may recursively `chown -R` `/app/data`, `/app/apps/web/public/uploads`, and always `chown -R` the `.next` directory when present. The upload directories are bind-mounted and can grow with gallery size.
- **Failure scenario:** After a host ownership change or migration, restarting a large gallery can spend a long time walking the upload tree before the app starts, extending downtime and possibly exceeding orchestrator health-check windows.
- **Suggested fix:** Prefer build-time `COPY --chown` for immutable `.next` files, create only needed writable subdirectories with correct ownership, and replace recursive upload-tree ownership repair with explicit deployment instructions or a one-time migration/init step.

## Positive performance controls observed

- Public masonry images use `<picture>` with AVIF/WebP sources and only eager/high-priority loading for above-fold images (`apps/web/src/components/home-client.tsx:190-222`).
- Upload originals are streamed to disk rather than buffered as a whole file (`apps/web/src/lib/process-image.ts:233-381`, reviewed in full during the sweep).
- Public load-more and search actions have server-side rate limiting and stale-response guards, limiting some abuse paths (`apps/web/src/app/actions/public.ts:1-101`, `apps/web/src/components/load-more.tsx`, reviewed).
- OG image generation has explicit rate limiting, ETag handling, and cache headers (`apps/web/src/app/api/og/route.tsx:39-87`).
- Sitemap generation uses a lean id-only query and a one-hour route revalidation (`apps/web/src/app/sitemap.ts`, reviewed).

## Final sweep and skipped files

Final sweep rechecked upload/queue/sharp code, public pages, DB queries/indexes, public image serving, search, admin export/delete actions, browser-heavy components, test gate configs, Docker/nginx/entrypoint/CI, and uncommitted source/config changes. Generated build output, uploaded image directories, screenshots/fixtures, and historical review/plan markdown were excluded from detailed perf analysis unless they affected active tooling or provenance. No fixes were implemented.

## Count

- Total findings: 12
- High: 3
- Medium: 4
- Low: 5
