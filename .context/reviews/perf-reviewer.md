# Perf Reviewer — Cycle 8 Prompt 1 Deep Review

Scope: performance, concurrency, CPU/memory, DB/query efficiency, queue/image processing, SSR/cache behavior, client responsiveness, and build/deploy runtime traps.

Constraints honored: review only; no code changes; no commit/push.

## Performance-relevant inventory

I inventoried all files in the performance-relevant surfaces and inspected them via direct reads plus repo-wide pattern sweeps:

- **Docs / config / deploy**
  - `README.md`
  - `apps/web/README.md`
  - `apps/web/package.json`
  - `apps/web/next.config.ts`
  - `apps/web/Dockerfile`
  - `apps/web/docker-compose.yml`
  - `apps/web/playwright.config.ts`
  - `apps/web/vitest.config.ts`
  - `apps/web/src/instrumentation.ts`
  - `apps/web/src/proxy.ts`

- **Runtime source inspected**
  - all files under `apps/web/src/app`
  - all files under `apps/web/src/components`
  - all files under `apps/web/src/lib`
  - all files under `apps/web/src/db`

- **Perf-relevant tests inspected**
  - all files under `apps/web/src/__tests__`
  - all files under `apps/web/e2e`

- **Main hot-path clusters**
  - public gallery/photo/share routes
  - admin dashboard/upload/tags/topics/settings/db tools
  - query/data layer
  - image conversion + queue bootstrap/shutdown
  - upload/export/download streaming paths
  - search/load-more/client interaction paths

## Findings

### PERF-01 — Public gallery list queries are not actually lightweight; they over-fetch EXIF-heavy columns on every page

- **Status:** Confirmed
- **Severity:** High
- **Confidence:** High
- **Evidence:**
  - `publicSelectFields` inherits almost all of `adminSelectFields`, including many EXIF/display fields not used by gallery grids: `apps/web/src/lib/data.ts:115-152`, `apps/web/src/lib/data.ts:161-181`
  - public list queries spread `...publicSelectFields` in both `getImagesLite` and `getImagesLitePage`: `apps/web/src/lib/data.ts:322-334`, `apps/web/src/lib/data.ts:372-385`
  - homepage consumes only a narrow subset for cards: `apps/web/src/components/home-client.tsx:45-57`, `apps/web/src/components/home-client.tsx:150-230`
  - homepage first page uses `getImagesLitePage(...)`: `apps/web/src/app/[locale]/(public)/page.tsx:133-176`
  - topic page does the same: `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:156-188`
- **Failure scenario:** every home/topic request fetches and serializes camera/lens/ISO/f-number/exposure/focal-length/color-space/etc. for 30 images even though the grid never renders them. That inflates DB row size, SSR payload size, and hydration cost.
- **Concrete fix:** create a true gallery-card projection for public list pages containing only the fields actually rendered (`id`, filenames, width/height, title/description, `tag_names`, `topic`, maybe `user_filename` fallback). Keep EXIF only for detail pages/search where it is used.

### PERF-02 — Admin dashboard list query over-fetches the full admin image record for every row

- **Status:** Confirmed
- **Severity:** High
- **Confidence:** High
- **Evidence:**
  - admin dashboard fetches `getAdminImagesLite(PAGE_SIZE, offset, true)`: `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:8-22`
  - `getAdminImagesLite` spreads `...adminSelectFields` for every row: `apps/web/src/lib/data.ts:420-438`
  - `adminSelectFields` includes many unused columns for this screen, including full EXIF and private/original metadata: `apps/web/src/lib/data.ts:115-152`
  - dashboard client only needs a much smaller shape: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:11-19`
  - row renderer uses an even narrower subset: `apps/web/src/components/image-manager.tsx:49-60`, `apps/web/src/components/image-manager.tsx:377-440`
- **Failure scenario:** each admin dashboard page pulls 50 oversized rows, increasing query cost and serialized React payload size before the client table even mounts.
- **Concrete fix:** add a dashboard-specific query selecting only the fields the dashboard actually renders. Keep full admin image reads for edit/detail surfaces only.

### PERF-03 — The main photo viewer forces synchronous image decoding on the critical path

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - photo viewer main `<img>` uses `decoding="sync"` with eager loading: `apps/web/src/components/photo-viewer.tsx:218-228`
- **Failure scenario:** opening or navigating between large photos can block the main thread during decode, causing visible input lag/jank exactly where the UI is supposed to feel most responsive.
- **Concrete fix:** change to `decoding="async"` or omit the attribute and let the browser choose. If instant navigation is required, prefetch adjacent assets separately rather than forcing synchronous decode.

### PERF-04 — Batch delete can fan out into hundreds of full directory scans at once

- **Status:** Confirmed
- **Severity:** High
- **Confidence:** High
- **Evidence:**
  - `deleteImageVariants(..., sizes = [])` falls back to scanning the whole derivative directory: `apps/web/src/lib/process-image.ts:170-205`
  - single delete intentionally calls that path for all three derivative dirs: `apps/web/src/app/actions/images.ts:426-431`
  - batch delete does this inside `Promise.all(imageRecords.map(...))`: `apps/web/src/app/actions/images.ts:537-553`
  - batch size is allowed up to 100 images: `apps/web/src/app/actions/images.ts:462-465`
- **Failure scenario:** deleting 100 images can trigger ~300 concurrent directory scans/unlink waves across `webp/avif/jpeg`, which can saturate disk I/O and stall uploads/queue work.
- **Concrete fix:** do at most one scan per format per batch, discover all matching legacy variants once, then unlink in a bounded-concurrency pass. Avoid per-image full-directory scans.

### PERF-05 — CSV export still materializes the whole export in server memory and then again in browser memory

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - export query loads up to 50k rows into memory: `apps/web/src/app/[locale]/admin/db-actions.ts:51-67`
  - server builds `csvLines` and then one giant `csvContent` string: `apps/web/src/app/[locale]/admin/db-actions.ts:70-99`
  - client wraps returned data in a `Blob` before download: `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx:94-115`
- **Failure scenario:** a large export temporarily exists as DB result rows + line array + final string on the server, then as action payload + Blob on the client. That can spike memory and freeze slower browsers.
- **Concrete fix:** move CSV export to a route handler that streams rows directly to the response. Do not return the CSV body through a Server Action.

### PERF-06 — Live search is still a leading-wildcard multi-query scan without a real search index

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - search builds `%query%`: `apps/web/src/lib/data.ts:731-733`
  - primary search scans multiple columns with leading-wildcard `LIKE`: `apps/web/src/lib/data.ts:743-757`
  - it may then run tag and alias fallback queries too: `apps/web/src/lib/data.ts:766-820`
  - schema has normal indexes for browse paths, but no full-text search index: `apps/web/src/db/schema.ts:61-80`
  - client calls this on a 300ms debounce while typing: `apps/web/src/components/search.tsx:89-104`
- **Failure scenario:** legitimate search use on a large gallery can still trigger expensive scans/JOINs per debounced keystroke; rate limiting reduces abuse, not normal query cost.
- **Concrete fix:** add MySQL FULLTEXT or a dedicated search table/index. Keep the current fallback logic only for small datasets or as a degraded path.

### PERF-07 — Queue/job concurrency can still oversubscribe CPU under default settings

- **Status:** Likely
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:**
  - queue default concurrency is `2`: `apps/web/src/lib/image-queue.ts:118-121`
  - Sharp global concurrency defaults to `cpuCount - 1`: `apps/web/src/lib/process-image.ts:16-23`
  - each job generates three formats in parallel: `apps/web/src/lib/process-image.ts:381-444`
  - each format may generate multiple sizes: `apps/web/src/lib/process-image.ts:390-436`, `apps/web/src/lib/gallery-config-shared.ts:48-57`, `apps/web/src/lib/gallery-config-shared.ts:150-153`
- **Failure scenario:** two queued large uploads can mean six active format pipelines while libvips also uses most cores, making the web process sluggish under concurrent public/admin traffic.
- **Concrete fix:** bound conversion concurrency at the format/job level, not just queue-job level. Consider sequential format generation per job or lower weighted concurrency for AVIF.

### PERF-08 — Admin dashboard responsiveness degrades because each row mounts a full `TagInput` with its own global listener and tag filtering work

- **Status:** Confirmed
- **Severity:** Medium
- **Confidence:** High
- **Evidence:**
  - admin dashboard page size is 50: `apps/web/src/app/[locale]/admin/(protected)/dashboard/page.tsx:8-16`
  - each row renders a `TagInput`: `apps/web/src/components/image-manager.tsx:405-436`
  - `TagInput` filters the entire `availableTags` array on render/input: `apps/web/src/components/tag-input.tsx:54-59`
  - each `TagInput` installs its own document-level `mousedown` listener: `apps/web/src/components/tag-input.tsx:131-139`
  - upload tray can mount even more `TagInput` instances, one per selected file: `apps/web/src/components/upload-dropzone.tsx:397-476`
- **Failure scenario:** a dashboard page with 50 rows and a large tag catalog mounts dozens of duplicate listeners and autocomplete filters; selecting many upload files amplifies this further and causes noticeable typing/click lag.
- **Concrete fix:** lazy-open tag editing instead of rendering a full autocomplete in every row/card, and centralize outside-click handling instead of one document listener per instance.

## Manual-validation risks

### RISK-01 — Infinite load-more grows DOM/image count without any windowing

- **Status:** Manual-validation risk
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:**
  - load-more keeps increasing offset and appending rows: `apps/web/src/components/load-more.tsx:29-42`
  - home client appends to `allImages` and renders the whole accumulated set: `apps/web/src/components/home-client.tsx:85-89`, `apps/web/src/components/home-client.tsx:149-236`
- **Why manual validation:** code shape is clearly unbounded, but the practical breakpoint depends on device memory, gallery length, and image dimensions.
- **Suggested validation:** profile long-scroll sessions on low-memory mobile hardware; if jank appears, add virtualization or a rolling render window.

### RISK-02 — Server Action upload transport still carries a very large body budget

- **Status:** Manual-validation risk
- **Severity:** Medium
- **Confidence:** Medium
- **Evidence:**
  - total upload body limit defaults to 2 GiB: `apps/web/src/lib/upload-limits.ts:1-24`
  - Next body limits are wired to that setting: `apps/web/next.config.ts:46-58`
  - client uploads with concurrency 3: `apps/web/src/components/upload-dropzone.tsx:193-254`
  - server action receives `File` objects before streaming originals to disk: `apps/web/src/app/actions/images.ts:96-196`, `apps/web/src/lib/process-image.ts:224-253`
- **Why manual validation:** the actual buffering/temp-file behavior depends on Next/runtime deployment details.
- **Suggested validation:** load-test concurrent large uploads in the real deployment topology and inspect RSS/tmp usage; if high, move uploads to streaming route handlers.

## Final missed-issues sweep

- Re-scanned the repo for:
  - queue/timer/listener leaks
  - `setInterval`/`setTimeout` cleanup
  - unbounded `Map`/`Set` growth
  - `Promise.all` fan-out
  - `GROUP_CONCAT`, `COUNT(*) OVER()`, leading-wildcard `LIKE`
  - image decode/worker/object-URL usage
  - route/cache invalidation patterns
- No additional confirmed timer-leak issue found:
  - `lightbox`, `photo-navigation`, `search`, `nav-client`, `optimistic-image`, `histogram`, `image-zoom`, and `info-bottom-sheet` all clean up their listeners/timers.
- No additional confirmed unbounded-memory issue found in:
  - queue retry maps (`apps/web/src/lib/image-queue.ts:73-85`)
  - upload tracker (`apps/web/src/lib/upload-tracker-state.ts:23-42`)
  - rate-limit maps (`apps/web/src/lib/rate-limit.ts:113-162`)
- Direct file serving paths are properly streamed rather than buffered:
  - `apps/web/src/lib/serve-upload.ts:67-103`
  - `apps/web/src/app/api/admin/db/download/route.ts:82-94`

## Reviewed surfaces

- All performance-relevant files under:
  - `apps/web/src/app`
  - `apps/web/src/components`
  - `apps/web/src/lib`
  - `apps/web/src/db`
  - `apps/web/src/__tests__`
  - `apps/web/e2e`
- Plus:
  - `apps/web/package.json`
  - `apps/web/README.md`
  - `apps/web/next.config.ts`
  - `apps/web/Dockerfile`
  - `apps/web/docker-compose.yml`
  - `apps/web/playwright.config.ts`
  - root `README.md`
