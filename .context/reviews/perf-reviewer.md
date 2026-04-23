# Performance Review — Cycle 6 (2026-04-23)

## Scope and inventory covered
Reviewed public-route render paths, SSR data helpers, infinite-scroll behavior, and related tests/docs across the current repository.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### PERF6-01 — Public SSR entrypoints still serialize independent reads instead of overlapping them
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:95-110`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:90-125`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-123`, `apps/web/src/app/[locale]/layout.tsx:55-64`
- **Why it is a problem:** The request path blocks on multiple unrelated DB/config/session reads one after another.
- **Concrete failure scenario:** Every cold request adds avoidable async latency before stream start, especially on pages that need SEO settings plus gallery config plus tags/topics plus auth state.
- **Suggested fix:** Parallelize independent reads with `Promise.all` and keep only filter-dependent queries sequential.

### PERF6-02 — Load-more uses an exact-multiple blind spot that guarantees one wasted fetch on some galleries
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/public.ts:11-25`, `apps/web/src/components/load-more.tsx:29-43`
- **Why it is a problem:** The client has no authoritative `hasMore` bit, so it probes with an extra request whenever the terminal page size equals the requested limit.
- **Concrete failure scenario:** Exact-multiple galleries cause needless DB work, wasted spinner time, and an extra server action invocation per browsing session.
- **Suggested fix:** Overfetch one row in the action (or reuse the paginated helper) and return `{ images, hasMore }`.

## Final sweep
No stronger cross-file hotspot was confirmed than serialized SSR reads plus the exact-multiple infinite-scroll probe.
