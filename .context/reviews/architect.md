# Architect Review — Cycle 6 (2026-04-23)

## Scope and inventory covered
Reviewed route/data-layer boundaries, pagination contracts, and public SSR composition across the repository.

## Findings summary
- Confirmed Issues: 2
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### ARCH6-01 — Public SSR composition still lacks a consistent “fetch independent state in parallel” seam
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:95-110`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:90-125`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:104-123`, `apps/web/src/app/[locale]/layout.tsx:55-64`
- **Why it is a problem:** Multiple route modules independently repeat serial fetch choreography instead of sharing the architecture rule that unrelated reads should overlap.
- **Concrete failure scenario:** TTFB regresses organically as each entrypoint adds another await in sequence.
- **Suggested fix:** Refactor the route entrypoints to use explicit `Promise.all` groupings for unrelated reads.

### ARCH6-02 — The load-more contract leaks pagination knowledge into the client and causes avoidable probe traffic
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/actions/public.ts:11-25`, `apps/web/src/components/load-more.tsx:29-43`
- **Why it is a problem:** The action returns only rows while the client is forced to reconstruct `hasMore` heuristically.
- **Concrete failure scenario:** Exact-multiple result sets always require an extra no-op request.
- **Suggested fix:** Return an explicit `{ images, hasMore }` contract from the server action.

## Final sweep
Current HEAD does not reproduce the prior split count-query issue; the main architectural follow-ups are now SSR concurrency and pagination contract shape.
