# Cycle 76/100 Aggregate Review

Start HEAD: `a295ae4432f071c374cb68278a706f5a516ae593`.

## Review Fan-Out

The registered native agent surface exposed generic roles rather than the named review roles in the workflow prompt, so Cycle 76 fanned out by independent review lane and preserved the results in this directory.

- Server/security lane: no new confirmed finding; auth/origin/public-rate-limit gates passed in that lane.
- Performance/deploy lane: backfill same-value update misclassification, per-photo OG derivative freshness, Cycle 75 ledger drift.
- Test/verifier lane: confirmed the per-photo OG freshness gap and found two low-risk coverage gaps.
- UI/UX lane: no new UI finding; `C75-08` remains a prior deferred admin accessibility item.

## Deduplicated Findings

### C76-01 - Backfill same-value updates can be misclassified as deleted rows

- Severity: High
- Confidence: High
- Citations: `apps/web/src/lib/admin-backfill-runner.ts:594`, `apps/web/src/lib/admin-backfill-runner.ts:631`, `apps/web/scripts/backfill-color-pipeline.ts:458`, `apps/web/scripts/backfill-color-pipeline.ts:475`
- Problem: both re-encode paths use `affectedRows === 0` as proof of deletion. MySQL's default affected-row count is changed rows, so same-value updates can report zero while the row still exists.
- Failure scenario: a settings-only or forced re-encode writes fresh derivatives, persists values equal to the existing row, then deletes the new derivatives for a live image as if it had been deleted mid-reencode.
- Disposition: scheduled for Cycle 76.

### C76-02 - Per-photo OG validators can miss derivative-byte changes

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:54`, `apps/web/src/app/api/og/photo/[id]/route.tsx:133`, `apps/web/src/app/api/og/photo/[id]/route.tsx:188`
- Problem: the per-photo OG ETag omits derivative byte-impact settings and pipeline version, while the route can return 304 before fetching a derivative.
- Failure scenario: a crawler retains a stale card after derivative bytes are rewritten because the validator inputs did not change.
- Disposition: scheduled for Cycle 76.

### C76-03 - Cycle 75 ledger still marks terminal steps open

- Severity: Medium
- Confidence: High
- Citations: `.context/plans/README.md:5`, `.context/plans/cycle-75-2026-07-01-plan.md:58`, `.context/reviews/_aggregate.md:3`
- Problem: Cycle 76 started from deployed `a295ae44`, but Cycle 75's plan/index/aggregate still mark Cycle 75 as active or incomplete.
- Failure scenario: future cycles inherit ambiguous release state and re-open completed ledger work.
- Disposition: scheduled for Cycle 76.

### C76-04 - Bottom-sheet dropdown portal coverage is source-shaped only

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:15`
- Problem: coverage checks exact source strings rather than runtime containment of dropdown content inside the bottom-sheet dialog subtree.
- Failure scenario: a refactor preserves the strings while the dropdown portals to `document.body`, re-opening the focus-trap issue with green tests.
- Disposition: deferred.

### C76-05 - `getImageProcessingState` test would miss a processed-predicate drift

- Severity: Low
- Confidence: Medium
- Citations: `apps/web/src/__tests__/image-processing-state-data.test.ts:42`, `apps/web/src/__tests__/og-photo-fallback.test.ts:98`, `apps/web/src/lib/data.ts:1204`
- Problem: mocked behavior coverage returns rows independently of the generated Drizzle predicate; the source guard only forbids `eq(images.processed, true)`.
- Failure scenario: a future processed-state predicate can make pending-photo misses cacheable or processed rows invisible while the mock-shaped tests remain green.
- Disposition: deferred.

## Carry-Forward

`C75-08` remains deferred with original severity/confidence in `.context/plans/cycle-75-2026-07-01-deferred.md`; Cycle 76 did not add new evidence changing its severity or exit criterion.

## Agent Failures

None.
