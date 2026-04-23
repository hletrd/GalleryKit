# Performance Review — Cycle 1

## SUMMARY
- Confirmed 4 current performance findings.
- Two are small, high-confidence wins suitable for this cycle; two are larger architectural follow-ups that should be deferred with explicit exit criteria.

## INVENTORY
- Public rendering/data helpers: `apps/web/src/lib/data.ts`, `apps/web/src/components/nav.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Photo viewer rendering: `apps/web/src/components/photo-viewer.tsx`
- Search path: `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/components/search.tsx`
- Pagination path: `apps/web/src/lib/data.ts`, `apps/web/src/components/load-more.tsx`

## FINDINGS

### PERF-01 — Shared public-route topic data is not request-cached
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:202-204, 786-790`, `apps/web/src/components/nav.tsx:2-8`, `apps/web/src/app/[locale]/(public)/page.tsx:82-84`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-120`
- **Why it is a problem:** `Nav` and the page body independently fetch topics on the same public request even though the repo already uses `cache()` for other hot SSR helpers.
- **Concrete failure scenario:** Cache misses or crawler traffic cause avoidable duplicate `topics` queries on the highest-traffic public routes.
- **Suggested fix:** Add a cached `getTopicsCached` export and switch shared public render paths to it.

### PERF-02 — Photo viewer overstates image display width when the desktop info panel is open
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/components/photo-viewer.tsx:202-223`
- **Why it is a problem:** Both `<source>` tags advertise `100vw`, so the browser picks larger AVIF/WebP derivatives than the actual image pane needs on desktop.
- **Concrete failure scenario:** Desktop viewers with the sidebar open pay extra bytes and decode time for images that render substantially narrower than the full viewport.
- **Suggested fix:** Use a sidebar-aware `sizes` string and regression-test the helper that computes it.

### PERF-03 — Infinite-scroll listings still scale with `OFFSET` discard work
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:314-330, 337-377`, `apps/web/src/components/load-more.tsx:29-43`, `apps/web/src/app/actions/public.ts:10-23`
- **Why it is a problem:** Later pages get progressively more expensive because MySQL must walk and discard all prior rows before returning the next slice.
- **Concrete failure scenario:** Large galleries feel increasingly slower the farther a user scrolls, and DB CPU rises under concurrent browsing.
- **Suggested fix:** Migrate the public/admin listing path to cursor/seek pagination using the existing sort tuple.

### PERF-04 — Search still performs broad wildcard scans and up to three DB queries per debounced request
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:664-770`, `apps/web/src/app/actions/public.ts:26-100`, `apps/web/src/components/search.tsx:40-80`
- **Why it is a problem:** `%term%` scans across multiple columns are not index-friendly, and the client only discards stale responses after the server has already done the work.
- **Concrete failure scenario:** A few users typing quickly into search create repeated broad scans on hot public traffic, even when most intermediate responses are thrown away client-side.
- **Suggested fix:** Plan an indexed search path (FULLTEXT or another more selective strategy) and stronger request coalescing/cancellation.

## FINAL SWEEP
- I re-checked earlier stale performance artifacts (thumbnail consumers, standalone E2E startup) and excluded them because the current code already fixed those issues.
