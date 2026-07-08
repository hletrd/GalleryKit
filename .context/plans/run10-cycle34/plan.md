# Run-10 Cycle 34/100 Implementation Plan

Status: IMPLEMENTED - gates/deploy pending
Aggregate: `.context/reviews/run10-cycle34/_aggregate.md` and rolling `.context/reviews/_aggregate.md`
Date: 2026-07-08 KST
Review start HEAD: `5124d17ec6bf801f302c180cabf6a58539d892c5`

## Scope

This cycle fixes the contained correctness, reliability, and provenance findings from the Cycle 34 aggregate:

- PAT Lightroom upload must participate in the restore admin-mutation barrier.
- In-app color backfill must be included in graceful shutdown drain evidence.
- Browser upload topic-lookup DB errors must return structured localized action errors.
- `seed-e2e` cleanup must validate/contain DB-sourced filenames before unlink.
- Cycle 33/current review ledgers must stop presenting shipped/stale artifacts as current pending work.
- Sidecar color backfill must claim the same per-image processing lock as the in-app runner.

Repo rules read before scheduling: `CLAUDE.md`, `AGENTS.md`, `README.md`, `apps/web/README.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/run10-cycle33/plan.md`, `.context/plans/run10-cycle33/deferred.md`, the Cycle 34 review artifacts, and the review-plan-fix / ralph skill instructions.

No new dependency, schema migration, payment/editing/product feature, or destructive production operation is required.

## Scheduled Work Packages

### WP1 - Put PAT Lightroom upload inside the restore mutation barrier

Finding: `C34-01`.

Files:

- `apps/web/src/app/api/admin/lr/upload/route.ts`
- `apps/web/src/__tests__/cycle-17-source-contracts.test.ts` or a focused route source-contract test

Plan:

1. Import `acquireAdminMutationSlot`.
2. Acquire a slot near the top of the authenticated POST handler before the route can enter the long parse/save/insert mutation window.
3. Return a 503 JSON error when the exclusive restore side is active.
4. Keep PAT same-origin exemption unchanged; this is restore serialization, not origin enforcement.
5. Add a source-contract test proving the LR route imports/acquires the barrier and checks `mutationSlot.acquired`.

Acceptance:

- Restore drain can see an in-flight PAT upload admitted before restore maintenance started.
- New PAT uploads are rejected while restore exclusive drain is active.
- `lint:api-auth`, `lint:action-origin`, typecheck, and targeted tests pass.

### WP2 - Drain in-app admin backfill during graceful shutdown

Finding: `C34-02`.

Files:

- `apps/web/src/lib/admin-backfill-runner.ts`
- `apps/web/src/instrumentation.ts`
- `apps/web/src/__tests__/admin-backfill-runner-*.test.ts` or a source-contract test

Plan:

1. Track the active `runBackfill()` promise in the admin-backfill state.
2. Export a bounded `shutdownAdminBackfillRunner()` helper that waits for that promise when a run is active and is idempotent when no run is active.
3. Include that helper in `instrumentation.ts` graceful shutdown `Promise.all`.
4. Preserve fire-and-forget UI semantics and the existing `state.running` lifecycle.
5. Add focused test/source-contract coverage that shutdown imports and awaits the backfill drain.

Acceptance:

- A SIGTERM waits for an in-process admin color backfill, bounded by the existing shutdown race timeout.
- No stale `running`/lock state remains after normal or failed backfill completion.

### WP3 - Return structured browser-upload topic lookup failures

Finding: `C34-03`.

Files:

- `apps/web/src/app/actions/images.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`
- Existing upload action/source-contract tests as needed

Plan:

1. In the topic existence DB `catch`, keep `settleClaim(0, 0)`.
2. Replace the rethrow with a logged structured return.
3. Add localized `failedToVerifyTopic` messages or reuse an existing suitable localized server-action key.
4. Add focused source/test coverage for the branch if practical.

Acceptance:

- A DB error during topic validation does not leak quota and does not surface as an unstructured framework error.
- The upload UI receives a normal `{ error }` action result.

### WP4 - Contain destructive cleanup in `seed-e2e`

Finding: `C34-04`.

Files:

- `apps/web/scripts/seed-e2e.ts`
- `apps/web/src/__tests__/seed-e2e*.test.ts` or source-contract coverage

Plan:

1. Add a small containment helper for DB-sourced seed filenames.
2. Permit only valid basename filenames matching the known `e2e-landscape` / `e2e-portrait` seed basenames and expected derivative extensions.
3. Skip and log any unexpected filename before filesystem deletion.
4. Pin the helper/source contract in tests.

Acceptance:

- A poisoned disposable e2e DB row cannot make the seed helper unlink arbitrary paths outside the known seed fixture set.
- The normal e2e seed path still removes and recreates the known fixture files.

### WP5 - Repair Cycle 33 and Cycle 34 review/provenance ledgers

Findings: `C34-05`, `C34-06`.

Files:

- `.context/plans/run10-cycle33/plan.md`
- `.context/plans/README.md`
- `.context/reviews/_aggregate.md`
- `.context/reviews/run10-cycle34/_aggregate.md`

Plan:

1. Mark Cycle 33 signed push complete at `5124d17e`.
2. Preserve Cycle 33 deploy/live-smoke gap honestly and state that Cycle 34 per-cycle deploy supersedes it.
3. Move Cycle 33 out of Active Current-Cycle Plans and add Cycle 34 as active.
4. Keep root `_aggregate.md` as the rolling current-cycle aggregate and cycle-scoped `run10-cycle34/_aggregate.md` as the archival pointer/copy.

Acceptance:

- Future planners can identify the current active cycle without mixing stale root review files.
- Shipped Cycle 33 work no longer appears pending.

### WP6 - Claim per-image processing locks in sidecar color backfill

Finding: `C34-08`.

Files:

- `apps/web/scripts/backfill-color-pipeline.ts`
- `apps/web/src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts`
- `apps/web/src/__tests__/cycle-17-source-contracts.test.ts` or adjacent source-contract tests

Plan:

1. Import `getImageProcessingLockName` and the shared advisory-lock release helper.
2. Add sidecar `acquireImageProcessingClaim` / `releaseImageProcessingClaim` helpers matching in-app runner semantics.
3. Hold the per-image lock across reprocess and persistence. If preserving batch updates would release the lock before DB persistence, change sidecar persistence for protected rows so update happens before release.
4. Count held-lock rows as skipped without advancing `pipeline_version`, so they remain candidates.
5. Add source/unit coverage proving the sidecar uses `GET_LOCK(?, 0)` with `getImageProcessingLockName`, release-on-failure semantics, and a skipped-locked path.

Acceptance:

- The sidecar no longer races live queue/retry processing for the same image derivatives.
- Rows skipped due to held claims remain retryable on later runs.
- Existing detection-failure and deleted-mid-reencode semantics remain intact.

## Deferred Finding Map

Deferred items are recorded in `deferred.md` with original severity/confidence, reason, and exit criterion:

- `C34-07`
- `C34-09`
- `C34-10`
- `C34-11`
- `C34-12`
- `C34-13`
- `C34-14`
- `C34-15`

No confirmed security, correctness, or data-loss finding is deferred in this plan.

## Progress

- [x] Prompt 1 review artifacts returned and aggregate written.
- [x] Prompt 2 plan/deferred pair written.
- [x] WP1 PAT upload restore barrier.
- [x] WP2 admin backfill shutdown drain.
- [x] WP3 browser upload topic lookup error.
- [x] WP4 seed-e2e cleanup containment.
- [x] WP5 provenance ledger repair.
- [x] WP6 sidecar per-image processing lock.
- [x] Full required gates.
- [ ] Signed commit/push.
- [ ] Per-cycle deploy and production smoke (`/api/live` plus missing-upload 404).

## Verification Plan

Focused checks before full gates:

- `npm test --workspace=apps/web -- --run src/__tests__/images-action-toctou-claim.test.ts src/__tests__/cycle-17-source-contracts.test.ts src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts` passed (3 files, 39 tests).
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run typecheck --workspace=apps/web` passed.
- `git diff --check` passed after trimming subagent review trailing whitespace.

Full required gates:

- `npm run lint --workspace=apps/web` passed.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm run audit:prod` passed (`found 0 vulnerabilities`).
- `npm run typecheck --workspace=apps/web` passed.
- `npm run build --workspace=apps/web` passed (Next.js 16.2.10).
- `npm test --workspace=apps/web` passed (361 files passed, 2 skipped; 3394 tests passed, 4 skipped).
- Browser e2e not run: implemented changes are server routes/actions, shutdown/operator scripts, tests, and ledgers; no browser-flow UI behavior changed.

Deployment:

- After commits are pushed and all configured gates are green, run exactly `npm run deploy` from the repo root.
- Record production `https://gallery.atik.kr/api/live` evidence and a direct missing-upload 404 smoke before final report.
