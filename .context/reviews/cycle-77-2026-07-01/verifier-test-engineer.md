# Cycle 77 Verifier + Test-Engineer Review

Reviewed HEAD: `8aefc3659fa8b6c08bff0da62d29b9ceb40029c5` (`fix(backfill): 🐛 confirm reencode row absence`).

## Inventory

- Required repo guidance read: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/_aggregate.md`, `.context/plans/cycle-76-2026-07-01-plan.md`, `.context/plans/cycle-76-2026-07-01-deferred.md`, root `package.json`, and `apps/web/package.json`.
- Blocking gate surface from package scripts: root delegates lint/typecheck/test/e2e/auth-origin/rate-limit scripts to `apps/web` (`package.json:11`); app scripts define ESLint, custom auth/action/public-route scanners, `typecheck:app`, `typecheck:scripts`, `build`, Vitest, and Playwright (`apps/web/package.json:8`).
- Test inventory: `apps/web/src/__tests__/` currently has 303 Vitest files; `apps/web/e2e/` currently has 8 files, including 5 specs and fixtures/helpers.
- Recent-cycle changed areas reviewed from `HEAD~15..HEAD`: settings/backfill warning state, semantic-search settings, service-worker cache/HEAD revalidation, restore-maintenance sidecar guards, admin backfill runner, color-pipeline sidecar, per-photo OG route, Atom feed conditional validators, `serve-upload` ETags, HTTP ETag matcher, dropdown portal wiring, select/touch target coverage, search stale-state feedback, and custom lint scanners.
- Current HEAD changed areas reviewed: `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, and the focused regression tests under `apps/web/src/__tests__/admin-backfill-runner-*`, `backfill-color-pipeline-deleted-mid-reencode.test.ts`, and `og-route-rate-limit-behavior.test.ts`.
- Focused validation run: `npm test --workspace=apps/web -- --run src/__tests__/admin-backfill-runner-deleted-mid-reencode.test.ts src/__tests__/admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts src/__tests__/og-route-rate-limit-behavior.test.ts` passed: 4 files, 32 tests.

## Findings

### C77-01 - Per-photo OG pipeline-version freshness is not behavior-pinned

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:64`, `apps/web/src/app/api/og/photo/[id]/route.tsx:76`, `apps/web/src/app/api/og/photo/[id]/route.tsx:149`, `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts:234`
- Problem: Cycle 76 correctly folds `pipelineVersion` into `createPhotoOgEtag`, but the route-level regression only proves settings-hash invalidation. The helper in the test can accept `pipelineVersion`, but no test sends an old pipeline-version ETag while keeping settings, timestamps, and sizes unchanged.
- Failure scenario: a future refactor drops `input.pipelineVersion` from the route ETag formula. The existing matching-ETag test still passes, and the settings-change test still fails open correctly, but an `IMAGE_PIPELINE_VERSION` bump can leave crawlers receiving `304` before derivative fetch/render on otherwise unchanged photo rows.
- Suggested focused test: add a sibling case in `og-route-rate-limit-behavior.test.ts` that builds `staleEtag = createPhotoOgEtag({ ..., pipelineVersion: IMAGE_PIPELINE_VERSION - 1 })`, leaves `getColorSettingsHashMock` at the current hash, and asserts the route does not return `304` and calls `pickFirstAvailablePhotoBufferMock`.

### C77-02 - Re-encode freshness bumps are not regression-locked

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/app/api/og/photo/[id]/route.tsx:145`, `apps/web/src/lib/admin-backfill-runner.ts:625`, `apps/web/src/lib/admin-backfill-runner.ts:654`, `apps/web/scripts/backfill-color-pipeline.ts:469`, `apps/web/scripts/backfill-color-pipeline.ts:479`, `apps/web/src/__tests__/admin-backfill-runner-deleted-mid-reencode.test.ts:239`, `apps/web/src/__tests__/admin-backfill-runner-deleted-mid-reencode-detection-failure.test.ts:233`
- Problem: Cycle 76 made both in-app and sidecar re-encode updates write `updated_at = CURRENT_TIMESTAMP`, and the per-photo OG ETag uses `image.updated_at`. The focused tests assert cleanup/counter behavior for same-value `affectedRows: 0`, but they do not assert that either success or detection-failure update branch actually advances `updated_at`.
- Failure scenario: a later cleanup removes the timestamp write while preserving all current counters and cleanup behavior. A same-settings force re-encode can rewrite derivative bytes without changing the route ETag inputs, so a crawler with the old validator can still get a stale `304`.
- Suggested focused tests: in the two admin-backfill runner regression files, inspect the captured UPDATE SQL for `updated_at = CURRENT_TIMESTAMP` on both the full metadata branch and the detection-failure derivative-only branch. For the sidecar, extract the UPDATE construction or add a narrow source/SQL-shape test that covers both `updateBatch` and `derivativeBatch` branches.

### C77-03 - Sidecar row-existence confirmation is only helper/source-shape covered

- Severity: Medium
- Confidence: Medium
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:485`, `apps/web/scripts/backfill-color-pipeline.ts:487`, `apps/web/scripts/backfill-color-pipeline.ts:491`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:65`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:145`, `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts:155`
- Problem: the pure helpers now correctly require `affectedRows === 0 && !rowStillExists`, and a source-shape test checks that `flushBatch` passes `confirmedUpdateResults` into the helper. There is no behavior test for the `flushBatch` wiring that sets `rowStillExists` from `rowExists(result.id)`.
- Failure scenario: a future edit accidentally sets `rowStillExists: false`, probes the wrong id, or drops the `affectedRows === 0 ? await rowExists(...) : true` guard while still passing `confirmedUpdateResults` into the helper. The helper tests stay green, but the sidecar can reintroduce the Cycle 76 live-row derivative deletion bug.
- Suggested focused test/fix: extract `confirmUpdateResults(updateResults, rowExists)` or similar from `flushBatch`, export it for tests, and cover three cases: changed row skips the existence probe and stays live, same-value zero-row update with `rowExists=true` does not cleanup, and zero-row update with `rowExists=false` does cleanup. If extraction is undesirable, build a narrow sidecar harness that mocks `db.transaction`/`db.execute` through `flushBatch`.

## Coverage Map

- Backfill deleted-mid-reencode, in-app: behavior-covered for success branch and detection-failure branch, including live-row same-value `affectedRows: 0` (`admin-backfill-runner-deleted-mid-reencode*.test.ts`).
- Backfill deleted-mid-reencode, sidecar: pure helper coverage plus source-shape closure wiring. Good for helper semantics; weaker for the closure's existence-probe wiring.
- Per-photo OG: route-level coverage for matching ETag `304`, settings-hash invalidation, restore-maintenance pre-charge behavior, rate-limit pre-DB behavior, derivative-miss `no-store`, and pending-row `no-store`.
- Feed/cache validators: route-level feed conditional tests and shared `ifNoneMatchMatches` tests cover weak/strong validator equivalence and stable empty-feed ETags.
- Upload derivative serving: `serve-upload.test.ts` covers versioned ETags, weak validator matching, file-handle closure, abort handling, and path constraints.
- Custom lint gates: `check-api-auth.test.ts`, `check-action-origin.test.ts`, and `check-public-route-rate-limit.test.ts` back the blocking package scripts.
- UI/touch/a11y surfaces: broad static audits exist for touch targets and recent UI source contracts, but deferred DOM/runtime component gaps remain as noted below.

## Historical Deferred Not Re-raised

- `C76-04` bottom-sheet dropdown portal coverage remains deferred. I did not re-raise it because Cycle 77 did not touch the dropdown/bottom-sheet wiring, and no new DOM-test infrastructure evidence changes its exit criterion.
- `C76-05` `getImageProcessingState` predicate drift remains deferred. I did not re-raise it because the helper was not touched after Cycle 76, and the current route tests still cover pending/permanent fallback behavior at the route boundary.
- `C75-08` bulk-edit validation alert association remains deferred. I did not inspect new UI changes that would change its severity or make it scheduled now.
- Carry-forward deferred items listed in `.context/plans/cycle-76-2026-07-01-deferred.md` remain historical unless their exit criteria are hit. `C77-03` is not the same as deferred `C73-05`; this review concerns the new Cycle 76 row-existence confirmation, not the older derivative write-boundary rollback guard.

## Final Sweep

- Current implementation evidence: focused Cycle 76 regressions pass (4 files, 32 tests).
- Source correctness: no current source defect confirmed in the reviewed Cycle 76 fix paths.
- Test adequacy risk: three focused gaps remain, all fixable with narrow tests/extraction and no broad infrastructure work.
- Worktree constraint: no source files were modified by this verifier lane; intended write is this review file only.
