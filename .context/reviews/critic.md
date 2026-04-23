# Critic Review — Cycle 6 (2026-04-23)

## Scope and inventory covered
Reviewed the full web application with extra skepticism around public-route hot paths, pagination contracts, and cross-file performance interactions.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### CRT6-01 — The hottest public pages still spend time waiting on unrelated reads that could run together
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:95-110`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:90-125`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-123`, `apps/web/src/app/[locale]/layout.tsx:55-64`
- **Why it is a problem:** The code is correct, but it still carries unnecessary sequencing on the most visible request path.
- **Concrete failure scenario:** Under crawler bursts or slower DB latency, the app burns TTFB budget before user-visible work starts.
- **Suggested fix:** Batch independent reads with `Promise.all` in the route entrypoints.

### CRT6-02 — Infinite scroll still needs an empty probe request to discover that some result sets are exhausted
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/public.ts:11-25`, `apps/web/src/components/load-more.tsx:29-43`
- **Why it is a problem:** The stop condition is inferred from payload size instead of being returned explicitly.
- **Concrete failure scenario:** Exact-multiple result sets show a final meaningless loading pass and hit the server one extra time.
- **Suggested fix:** Make the server action return `hasMore` explicitly.

## Final sweep
Older stale review findings were rechecked and intentionally dropped because current HEAD no longer reproduces them.
