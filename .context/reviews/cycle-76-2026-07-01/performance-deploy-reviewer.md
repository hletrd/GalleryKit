# Cycle 76 Performance/Deploy Review

Start HEAD: `a295ae4432f071c374cb68278a706f5a516ae593`.

## Inventory

- Backfill and re-encode paths: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`
- Per-photo OG route: `apps/web/src/app/api/og/photo/[id]/route.tsx`
- Cycle state ledgers: `.context/plans/README.md`, `.context/plans/cycle-75-2026-07-01-plan.md`, `.context/reviews/_aggregate.md`

## Findings

### C76-01 - Backfill same-value updates can be misclassified as deleted rows

- Severity: High
- Confidence: High
- Citations: `apps/web/src/lib/admin-backfill-runner.ts:594`, `apps/web/src/lib/admin-backfill-runner.ts:631`, `apps/web/scripts/backfill-color-pipeline.ts:458`, `apps/web/scripts/backfill-color-pipeline.ts:475`
- Problem: both backfill paths treat `affectedRows === 0` as proof that the row was deleted mid-reencode. MySQL reports changed rows by default, so a same-value `UPDATE` can return `0` while the row still exists.
- Failure scenario: a force re-encode rewrites derivatives but persists identical metadata. The update reports zero changed rows, the code assumes deletion, and freshly-written derivatives are deleted for a live image.
- Suggested fix: confirm row absence before cleanup, and make derivative rewrites bump a freshness field.

### C76-02 - Per-photo OG validators can miss derivative-byte changes

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:54`, `apps/web/src/app/api/og/photo/[id]/route.tsx:133`, `apps/web/src/app/api/og/photo/[id]/route.tsx:188`
- Problem: per-photo OG ETags include row timestamps and configured sizes, but not derivative byte-impact settings or pipeline version. A 304 is returned before fetching the derivative.
- Failure scenario: an admin changes JPEG/color quality settings and re-encodes derivatives. A crawler with a matching old validator can keep a stale card if the route's validator inputs did not change.
- Suggested fix: include the validated derivative byte-impact settings hash and pipeline version in the per-photo OG ETag, and ensure backfill rewrites advance `updated_at`.

### C76-03 - Cycle 75 ledger still marks terminal steps open

- Severity: Medium
- Confidence: High
- Citations: `.context/plans/README.md:5`, `.context/plans/cycle-75-2026-07-01-plan.md:58`, `.context/reviews/_aggregate.md:3`
- Problem: Cycle 76 started from deployed `a295ae44`, but the Cycle 75 plan/index/aggregate still describe Cycle 75 as active or incomplete.
- Failure scenario: future agents treat the previous cycle as still open or lack durable evidence for the deployed baseline.
- Suggested fix: mark Cycle 75 commit/push/deploy complete using the Cycle 76 invocation's deployed-HEAD evidence.
