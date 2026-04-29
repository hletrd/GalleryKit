# perf-reviewer Review — Cycle 2

## Inventory

- Read `.omx/context/cycle2-review-prompt.md` first, then inventoried the current worktree with `git status --short --branch`, `git diff --stat`, `git diff --name-only`, and `git ls-files --cached --others --exclude-standard`.
- Current uncommitted app/code changes reviewed included `apps/web/next.config.ts`, `apps/web/package.json`, `apps/web/playwright.config.ts`, `apps/web/scripts/{check-js-scripts.mjs,prepare-next-typegen.mjs,run-e2e-server.mjs}`, message JSON, admin DB restore actions, public load-more/search actions, home/load-more/upload/photo-viewer UI components, `apps/web/src/lib/{data,db-restore,sql-restore-scan,storage/local,upload-limits,validation}.ts`, and split TypeScript configs.
- Full source/config/test inventory read pass: 358 UTF-8 text files read/scanned, 3 binary media/font fixtures noted, 0 read errors. Buckets covered: App Router pages/actions/API routes, React client/server components, lib/db/storage/upload/image-processing modules, unit tests, Playwright e2e, scripts, Docker/nginx/deploy, Drizzle schema/migrations, package/config/docs, and current uncommitted review/plan artifacts.
- Performance-specific inspection focused on database query shape, pagination/cursor behavior, public search/load-more rate limits, upload request and preview paths, Sharp/PQueue processing, shared-link rendering, Next.js image/static serving, caching/revalidation, and client bundle/runtime overhead.

## Findings

- [PERF2-01] Severity: Medium Confidence: High Classification: confirmed Cross-agent hint: backend/test-engineer should add cursor validation and load-more regression coverage.
  - Location: `apps/web/src/app/actions/public.ts:66-86`, `apps/web/src/lib/data.ts:390-417`, `apps/web/src/lib/data.ts:450-461`
  - Problem: The new cursor path only checks that `capture_date` and `created_at` are strings (or Date for `created_at`), but it does not bound length or require a canonical datetime format before passing both values into the Drizzle/MySQL comparison. This replaces the old offset DoS cap with an object-shaped public input that can carry arbitrarily large or invalid date strings into the request parser and DB predicate.
  - Failure scenario: A malformed or abusive client calls `loadMoreImages()` with `{ id: 1, capture_date: "x".repeat(...), created_at: "x".repeat(...) }`. The in-memory rate limit allows many attempts per minute, and each accepted call can allocate/serialize large cursor values and ask MySQL to compare non-date strings against indexed datetime columns, wasting parser/optimizer work and potentially defeating the intended keyset-pagination efficiency.
  - Suggested fix: Parse and canonicalize cursors at the action boundary. Require bounded ISO/MySQL datetime strings (or structured numeric timestamps), convert to the exact DB comparison format, reject invalid/oversized strings with `{ status: 'invalid' }`, and share one cursor validator between `public.ts` and `data.ts`.

- [PERF2-02] Severity: Medium Confidence: High Classification: confirmed Cross-agent hint: planner should decide whether exact public counts are product-critical.
  - Location: `apps/web/src/lib/data.ts:486-515`, `apps/web/src/app/[locale]/(public)/page.tsx:14-16`, `apps/web/src/app/[locale]/(public)/page.tsx:78-81`, `apps/web/src/app/[locale]/(public)/page.tsx:138-140`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:164-166`
  - Problem: Public home/topic first-page rendering is explicitly uncached (`revalidate = 0`) and still uses `COUNT(*) OVER()` on the grouped tag-join listing query. The home metadata path can also run a separate `getImagesLite(..., 1)` grouped query to find an OG image before the page runs `getImagesLitePage()` for the same request.
  - Failure scenario: On a gallery with thousands of tagged processed images, crawler traffic or a homepage burst repeatedly forces MySQL to join/group/order the listing and compute an exact total count just to render 30 cards and a count label. If no custom OG image is configured, the home route pays an additional grouped listing query for metadata.
  - Suggested fix: Keep first-page hot paths on `LIMIT + 1` for `hasMore` and remove exact counts from public request-time rendering, or move exact counts to a short-lived cache/denormalized counter invalidated on upload/delete. For home OG fallback, reuse a cached latest-image helper that selects only the few columns needed for metadata.

- [PERF2-03] Severity: Medium Confidence: High Classification: confirmed Cross-agent hint: database/schema owner should evaluate FULLTEXT or a materialized search table.
  - Location: `apps/web/src/app/actions/public.ts:115-174`, `apps/web/src/lib/data.ts:861-967`, `apps/web/src/components/search.tsx:89-100`
  - Problem: Public search debounces at 300 ms and rate-limits, but each accepted query performs DB-backed rate-limit increment/check work and then runs leading-wildcard `LIKE '%term%'` predicates across images, topics, tags, and aliases. Leading wildcards prevent normal B-tree index use, and the tag/alias fallback queries add joins/grouping when the main query does not fill the limit.
  - Failure scenario: Several visitors search common two-letter or camera substrings. Even within rate limits, the app performs repeated non-sargable scans plus rate-limit DB writes/checks, increasing MySQL CPU and making search feel slow under concurrent public use.
  - Suggested fix: Introduce an indexed search strategy (MySQL FULLTEXT where suitable, generated token table, or external search if requirements grow), cache popular normalized queries briefly, and consider a higher minimum length for broad fields while preserving exact/prefix matches for tags/topics.

- [PERF2-04] Severity: Medium Confidence: High Classification: likely Cross-agent hint: architect should split shared-group data shapes.
  - Location: `apps/web/src/lib/data.ts:730-805`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:29-38`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:99-107`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:122-157`
  - Problem: A shared-group selected-photo request loads up to 100 group images, blur data, and batched tags for the entire group. Metadata does this through `getSharedGroupCached(key, { incrementViewCount: false })`, then the page body calls `getSharedGroupCached(key)` again and passes the full group to `PhotoViewer` even when only one selected photo is displayed.
  - Failure scenario: A mobile user or social crawler opens `/g/<key>?photoId=<id>` for a 100-photo group. The server fetches and serializes the whole group for metadata and again for the page, and the client hydrates a full image array before the selected-photo view is useful.
  - Suggested fix: Add smaller shared-group accessors: metadata summary/cover, selected photo detail with neighbor IDs, and paginated group grid. Keep view-count side effects separate from cached read shapes so metadata and page can dedupe safely.

- [PERF2-05] Severity: High Confidence: High Classification: likely Cross-agent hint: designer/frontend should cap or virtualize upload previews.
  - Location: `apps/web/src/components/upload-dropzone.tsx:43-47`, `apps/web/src/components/upload-dropzone.tsx:81-109`, `apps/web/src/components/upload-dropzone.tsx:125-160`, `apps/web/src/components/upload-dropzone.tsx:381-474`, `apps/web/src/lib/upload-limits.ts:1-17`
  - Problem: The upload UI allows up to 100 selected files with 200 MiB per-file / 2 GiB window defaults, creates object URLs for every accepted file, and renders every preview as a plain `<img>` backed by the original local file. Incremental URL management avoids churn, but it does not cap decode memory, DOM size, or GPU upload cost.
  - Failure scenario: An admin drags dozens of high-resolution camera originals into the uploader. The browser attempts to decode and render many originals at once, causing main-thread stalls, memory pressure, or a tab crash before the server-side upload/queue path begins.
  - Suggested fix: Limit live previews to a small viewport-sized window, virtualize/paginate the selected-file grid, and generate small thumbnails with `createImageBitmap`/canvas or a worker. Show metadata-only rows for offscreen/very large files until expanded.

- [PERF2-06] Severity: Medium Confidence: High Classification: likely Cross-agent hint: deployment/docs should expose CPU sizing guidance for image workers.
  - Location: `apps/web/src/lib/process-image.ts:17-26`, `apps/web/src/lib/process-image.ts:389-478`, `apps/web/src/lib/image-queue.ts:121-132`, `apps/web/src/app/actions/images.ts:373-388`
  - Problem: Queue concurrency defaults to one, but each queued job encodes WebP, AVIF, and JPEG concurrently, and Sharp/libvips is allowed up to CPU parallelism minus one worker thread. One image job can therefore consume most CPU cores and memory bandwidth inside the same Next.js process that serves public/admin requests.
  - Failure scenario: After a batch upload, AVIF/WebP/JPEG variant generation saturates the container while public pages and admin actions share that runtime. Users see slow TTFB and sluggish UI even though application-level queue concurrency is `1`.
  - Suggested fix: Run image processing in a separate worker process/container or lower default `SHARP_CONCURRENCY` for the web runtime. Add an explicit format-level concurrency limit (especially around AVIF), and document safe combinations of `QUEUE_CONCURRENCY`, output size count, and `SHARP_CONCURRENCY`.

- [PERF2-07] Severity: Medium-Low Confidence: Medium Classification: likely Cross-agent hint: frontend should confirm with bundle analyzer before/after dynamic imports.
  - Location: `apps/web/src/components/photo-viewer.tsx:3-20`, `apps/web/src/components/photo-viewer.tsx:634-651`, `apps/web/src/components/histogram.tsx:226-273`, `apps/web/src/components/lightbox.tsx:47-64`
  - Problem: `PhotoViewer` statically imports optional/heavy UI paths (`Lightbox`, `InfoBottomSheet`, `Histogram`, `framer-motion`, and their dependencies). The lightbox and bottom sheet are conditionally rendered, and the histogram only appears when the info sidebar is open, but their module code is still part of the initial photo-viewer client chunk.
  - Failure scenario: A first-time visitor opens a photo page to view one image. The browser downloads/parses optional fullscreen, bottom-sheet, histogram, focus-trap, motion, and canvas/worker orchestration code before the user asks for those controls, increasing initial JS cost on mobile.
  - Suggested fix: Convert lightbox, bottom sheet, and histogram to `next/dynamic` or `React.lazy` boundaries with small skeletons, keeping only the primary image/navigation code in the initial viewer chunk. Verify with `ANALYZE=true next build` or equivalent bundle stats.

- [PERF2-08] Severity: Medium Confidence: High Classification: confirmed Cross-agent hint: backend should consider a streaming export route when larger-gallery work is scheduled.
  - Location: `apps/web/src/app/[locale]/admin/db-actions.ts:53-58`, `apps/web/src/app/[locale]/admin/db-actions.ts:76-124`, `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-114`
  - Problem: CSV export caps at 50,000 rows but still materializes the DB result array, a `csvLines` array, the joined CSV string, Server Action serialization, the client string, and finally a `Blob`. The in-code comment acknowledges the memory profile, and the current implementation remains non-streaming.
  - Failure scenario: An admin exports a large gallery from a memory-constrained deployment. Server and browser each hold multiple copies of a multi-megabyte CSV, causing heap spikes and slow completion.
  - Suggested fix: Move CSV export to an authenticated streaming route that batches rows and writes CSV incrementally to the response, similar to the backup download route, avoiding Server Action payload serialization for large files.

## Final Sweep

- Re-checked current uncommitted diffs after concurrent cycle-2 edits landed; the earlier cursor object-identity reset and `GalleryImage` cursor type drift are now addressed in `home-client.tsx` and are not reported as current perf findings.
- Positive performance controls observed: public OG route success responses now have cache control and ETag; sitemap no longer forces dynamic rendering; load-more uses keyset cursor pagination for normal client calls; listing payloads exclude `blur_data_url`; image variants are served by nginx with immutable caching in the checked-in deployment; queue bootstrap is batched; view-count writes are buffered/chunked; generated photo viewer images use responsive AVIF/WebP/JPEG sources.
- Historical/deferred items still real from a performance lens: broad search indexing, first-page exact counts, CSV streaming, upload preview virtualization, and separate worker resources for image processing.

## Skipped/Limitations

- Did not edit application code, install dependencies, commit, push, or run destructive commands.
- Did not run the full test/build suite; this was a static review artifact request. Line citations are from the current working tree at review time.
- Skipped line-by-line review of generated/vendor/runtime/binary artifacts: `node_modules`, `.git`, `.next`, `.omc`, bulk historical `.context` review/plan archives, `apps/web/test-results`, uploaded media derivatives, image fixtures, and font binaries. These were inventoried or noted when relevant but not treated as source code.
