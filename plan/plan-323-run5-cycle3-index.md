# Run-5 Cycle 3 — Plan Index

**Date:** 2026-06-12 · **Input:** `.context/reviews/run5-cycle3/_aggregate.md` (24 merged actionable findings from 11 agents, 61 raw; + 12 already-planned pull-forward escalations)

## Counts

| Document | Work items | Finding IDs covered |
|---|---|---|
| `plan-324-run5-cycle3-fixes.md` | 3 | 3 HIGH (AGG-R5C3-01..03) |
| `plan-325-run5-cycle3-medium.md` | 19 | 8 MED + security LOW + 8 pull-forward escalations (AGG-R5C3-04..07, -09, -10, -12, -13, -17, -21, -22, TRC-R5C3-04; plan-315 items 1/14/17/18/19 + designer items 25/26/27/30/31/33) |
| `plan-326-run5-cycle3-low-docs.md` | 3 units | AGG-R5C3-11, -15, -23 + plan-316 doc pull-forwards (DOC-R5C3-01/-03/-04/-05) + DOC-R5C3-07 + TEST-R5C3-08 short-term TODO + plan-320 item 6 stale-claim correction |
| `plan-327-run5-cycle3-deferred.md` | 9 entries | AGG-R5C3-08 (seeding half), -14, -16, -18, -19, -20, -24 (SEC-R5C3-02, TRC-R5C3-03), plan-315 items not pulled forward |
| **Total** | | **24/24 merged findings + all escalations accounted** ✓ |

## Implementation order (cycle 3)

1. **plan-324** (HIGH): test-leak cleanup + gitignore (item 1) → tautology test fix (item 2) → admin skip link (item 3).
2. **plan-325** sections A (correctness/security) → B (gates & test hardening) → C (pull-forwards).
3. **plan-326** docs/comment batch.
4. Gates (all 8) → SW_VERSION refresh if build changes `sw.js` → deploy.

## Archived this cycle

- plan-318/319/320/321 (run-5 cycle-2) → `plan/done/` — all items DONE per commit b5bcb93e and verifier re-verification (31/31 criteria, 1 PARTIAL doc residual now owned by plan-326 Unit A).

## Open plans carried forward

- `plan-315-run5-cycle1-medium.md` — 33 items; items 1/14/17/18/19 + designer 25/26/27/30/31/33 pulled forward into plan-325 this cycle; item 6 done (cycle-2). Remaining items keep plan-315 ownership.
- `plan-316-run5-cycle1-low-docs.md` — doc items VER-R5C1-01 / DOC-R5C1-03 / DOC-R5C1-05 / DOC-R5C1-24 pulled forward into plan-326 Unit A.
- `plan-317-run5-cycle1-deferred.md`, `plan-322-run5-cycle2-deferred.md` — unchanged.

## Verifier gate evidence at planning time

lint ✓ · lint:api-auth ✓ · lint:action-origin ✓ · lint:public-route-rate-limit ✓ · vitest 201 files / 1979 tests ✓ · typecheck ✓.

## Note on `apps/web/public/resources/`

Investigated during review (3 independent lanes): the untracked directory is residue from the repo's OWN test suite (`process-topic-image.test.ts` success-path tests write real Sharp output; +2 files per `npm test` run, reproduced). NOT review-tooling residue. Cleanup + gitignore is plan-324 item 1; the ~30 leaked files are synthetic 512×512 solid-color test blobs (verified via `file`), safe to delete as part of that item.
