# Perf Reviewer — Cycle 2 Review (2026-04-23)

## SUMMARY
- Confirmed 3 current performance findings.
- Two are small, high-confidence wins suitable for this cycle; one is a small hot-path CPU cleanup with direct test coverage.

## INVENTORY
- Shared data helpers: `apps/web/src/lib/data.ts`
- Public metadata/page stack: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Public search path: `apps/web/src/app/actions/public.ts`, `apps/web/src/components/search.tsx`, `apps/web/src/lib/rate-limit.ts`

## FINDINGS

### PERF2-01 — Public metadata and page renders duplicate grouped tag queries, and metadata does them even with no tag filter
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:229-246`, `apps/web/src/app/[locale]/(public)/page.tsx:24-25,83-86`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:32-33,111-122`
- **Why it is a problem:** `getTags()` performs a grouped aggregate on hot public routes, but current route composition re-runs it in metadata and body rendering and does not skip it on the common no-tag path.
- **Concrete failure scenario:** Anonymous route traffic and crawlers repeatedly trigger the same tag aggregation, raising DB work for no visible benefit.
- **Suggested fix:** Add `getTagsCached(topic?)` and skip metadata tag resolution when `tags` is absent.

### PERF2-02 — Home metadata still issues fallback image/config lookups when a custom OG image makes them dead work
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:22-31,44-54`
- **Why it is a problem:** The route fetches the latest image and gallery config before checking whether `seo.og_image_url` is already present.
- **Concrete failure scenario:** Branded deployments that always use a fixed OG image still pay an avoidable DB query and config read on every metadata render.
- **Suggested fix:** Return early for the custom-OG branch.

### PERF2-03 — `searchImagesAction` does full-map in-memory pruning on every request in an already expensive public hot path
- **Severity:** LOW
- **Confidence:** MEDIUM
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/public.ts:33-49`, `apps/web/src/components/search.tsx:67-81`, `apps/web/src/lib/rate-limit.ts:19-25`
- **Why it is a problem:** Search is debounced but still user-typing-driven; each request scans up to the entire `searchRateLimit` map before doing the DB-backed search/rate-limit work.
- **Concrete failure scenario:** Concurrent users typing quickly create repeated O(n) JS work on top of the existing wildcard-search cost.
- **Suggested fix:** Extract search-map pruning into a throttled helper so the full scan does not happen on every request, while preserving the cap and expiry semantics.

## FINAL SWEEP
- I excluded older stale performance findings that the current code already fixed (`getTopicsCached`, photo viewer `sizes`, earlier route hardening).
