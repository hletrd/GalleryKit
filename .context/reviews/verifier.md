# Verifier — Cycle 2 Review (2026-04-23)

## SUMMARY
- Current code matches the most important security/correctness expectations in the rechecked paths.
- The remaining evidence-backed issues are performance inefficiencies and missing regression coverage for them.

## INVENTORY
- Rechecked stale findings: `apps/web/src/lib/request-origin.ts`, `apps/web/src/lib/sql-restore-scan.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/live/route.ts`
- Current performance claims versus implementation: `apps/web/src/lib/data.ts`, `apps/web/src/app/[locale]/(public)/page.tsx`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`

## FINDINGS

### VER2-01 — Public metadata still performs unnecessary DB work on the default no-tag path
- **Severity:** LOW
- **Confidence:** HIGH
- **Status:** Confirmed
- **Files:** `apps/web/src/app/[locale]/(public)/page.tsx:18-31`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:18-33`
- **Why it is a problem:** The public metadata code validates tag filters even when no `tags` parameter exists, so it issues extra DB reads that do not change the output.
- **Concrete failure scenario:** Ordinary home/topic requests with no tag filter still pay a grouped tag query before rendering metadata.
- **Suggested fix:** Guard the tag-validation path behind a real `tags` search param, and reuse a cached helper when the param is present.

## FINAL SWEEP
- Verified that the previously reported cycle-2 correctness bugs are already fixed in source and should not be re-planned.
