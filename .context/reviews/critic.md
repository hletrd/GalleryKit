# Critic — Cycle 1 Review

## SUMMARY
- The codebase is in solid shape overall. The strongest remaining critique is that performance policy is inconsistent across hot public rendering paths.

## INVENTORY
- Request-scoped data helpers: `apps/web/src/lib/data.ts`, `apps/web/src/lib/gallery-config.ts`
- Public route composition: `apps/web/src/components/nav.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Search and pagination hot paths: `apps/web/src/lib/data.ts`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/search.tsx`

## FINDINGS

### CRT-01 — Public-route data-fetching discipline is inconsistent on the most visited surfaces
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:202-204, 786-790`, `apps/web/src/components/nav.tsx:2-8`, `apps/web/src/app/[locale]/(public)/page.tsx:82-84`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-120`
- **Why fragile:** The repo already relies on request-scoped `cache()` for several hot helpers, but topic navigation still uses an uncached helper even when layout and page need the same data in the same request.
- **Failure scenario:** The most-trafficked pages pay duplicate reads for low-value shared data during cache misses or crawler traffic.
- **Suggested fix:** Align `getTopics()` with the repo's existing cached-helper pattern on shared public render paths.

### CRT-02 — Search and offset pagination will age poorly before they fail loudly
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:314-330, 664-770`, `apps/web/src/app/actions/public.ts:26-100`, `apps/web/src/components/load-more.tsx:29-43`, `apps/web/src/components/search.tsx:40-80`
- **Why fragile:** These paths are correct today, but they scale by doing more discard/scan work as traffic and dataset size increase.
- **Failure scenario:** The app remains functionally correct while gradually becoming more expensive to operate under larger libraries.
- **Suggested fix:** Treat cursor pagination and a more indexed search strategy as deferred architectural work rather than waiting for production pressure to force it.

## FINAL SWEEP
- No broader rewrite is justified this cycle; the main critique is targeted and performance-focused.
