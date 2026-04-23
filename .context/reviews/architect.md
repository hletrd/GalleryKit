# Architect — Cycle 1 Review

## SUMMARY
- The main architectural risk is uneven application of request-scoped caching conventions across hot public routes.

## INVENTORY
- Cached helper patterns: `apps/web/src/lib/data.ts:786-790`, `apps/web/src/lib/gallery-config.ts:87-88`
- Uncached topic helper: `apps/web/src/lib/data.ts:202-204`
- Public route composition: `apps/web/src/components/nav.tsx`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

## FINDINGS

### ARC-01 — Shared public-route topic data is fetched through an uncached helper despite existing request-scope cache patterns elsewhere
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/lib/data.ts:202-204, 786-790`, `apps/web/src/components/nav.tsx:2-8`, `apps/web/src/app/[locale]/(public)/page.tsx:82-84`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-120`
- **Why it is a design risk:** The codebase already treats repeated SSR fetches as something worth deduping, but one of the hottest shared datasets (`topics`) still bypasses that convention on public pages.
- **Failure scenario:** Layout and page bodies independently hit the same topics query during cache misses, leaving the public render path more expensive than the architecture intends.
- **Suggested fix:** Export a cached topic helper and standardize public-route consumers on it.

## FINAL SWEEP
- No broader layering change is needed; this is a local consistency fix.
