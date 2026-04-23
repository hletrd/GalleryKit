# Tracer — Cycle 2 Review (2026-04-23)

## SUMMARY
- The current high-signal causal trace is repeated tag aggregation along the public request path.

## INVENTORY
- Route entry points: `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- Shared query helper: `apps/web/src/lib/data.ts`

## FINDINGS

### TRACE2-01 — Public request flow repeatedly converges on `getTags()` for identical inputs
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:24-25,83-86`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:32-33,111-122`, `apps/web/src/lib/data.ts:229-246`
- **Why it is a problem:** The metadata pass and page pass both walk into the same grouped tag query with no request-scoped dedupe.
- **Concrete failure scenario:** One route request triggers the same aggregate twice before any user-visible data changes.
- **Suggested fix:** Cache the helper per request and skip it entirely when the metadata branch has no tag-filter work to do.

## FINAL SWEEP
- No alternate causal path produced a stronger current issue than this duplicate-query flow.
