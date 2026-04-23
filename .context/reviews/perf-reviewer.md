# Performance Review — Cycle 5 (leader fallback; dedicated perf-reviewer role unavailable in current tool catalog)

## Scope and inventory covered
Reviewed current hot paths in `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`, and related render helpers.

## Findings summary
- Confirmed Issues: 1
- Likely Issues: 0
- Risks Requiring Manual Validation: 0

## Confirmed Issues

### PERF5-01 — Public gallery pages still do duplicate filtered DB work by splitting list and count into two queries
- **Severity:** MEDIUM
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:108-114`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:116-123`, `apps/web/src/lib/data.ts:253-276`
- **Why it is a problem:** The same request computes the page rows and then immediately runs a second exact `count(*)` for the identical filter set.
- **Concrete failure scenario:** Every cold/public request incurs an avoidable extra query on the most-trafficked routes, which becomes visible under crawl bursts and larger tag-filtered datasets.
- **Suggested fix:** Introduce a single paginated helper that returns rows plus total count/hasMore in one round-trip.

## Final sweep
No stronger current hotspot was confirmed than the duplicate first-page count path.
