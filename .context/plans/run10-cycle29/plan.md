# Run-10 Cycle 29/100 Implementation Plan

Status: IMPLEMENTED - SIGNED PUSHED; PER-CYCLE DEPLOY/LIVE SMOKES PASSED
Aggregate: `.context/reviews/run10-cycle29/_aggregate.md`
Date: 2026-07-08 KST
Review start HEAD: `d985f549afa73b23cdccf5d8fea30f4bfc840847`

## Scope

This plan schedules all four Cycle 29 aggregate findings. No new Cycle 29 findings are deferred.

Repo rules read before scheduling: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/run10-cycle27/deferred.md`, `.context/plans/run10-cycle28/plan.md`, `.context/plans/run10-cycle28/deferred.md`, `.context/plans/deferred-carry-forward.md`, and the Cycle 29 review artifacts.

## Scheduled Work Packages

### WP1 - Inline server-action scanner coverage

Findings: `AGG-C29-01`, `AGG-C29-02`

Files:

- `apps/web/scripts/check-action-origin.ts`
- `apps/web/src/__tests__/check-action-origin.test.ts`
- `apps/web/src/__tests__/cycle-28-source-contracts.test.ts`

Plan:

1. Add an app-wide use-server discovery helper that detects top-level server-action modules outside the approved scanned set.
2. Fail closed on function-level inline `'use server'` directives under `src/app`, because they bypass the export-based scanner model.
3. Replace source-string-only assurance with executable fixture tests for both unscanned top-level modules and inline server actions.

Acceptance:

- `lint:action-origin` fails on future inline route-component actions before they can bypass same-origin and mutation-barrier checks.
- The unscanned top-level module detector has behavior-level fixture coverage.

Status: implemented; focused verification passed.

### WP2 - Cycle 28 terminal ledger closure

Findings: `AGG-C29-03`

Files:

- `.context/plans/run10-cycle28/plan.md`
- `.context/plans/README.md`
- `.context/plans/run10-cycle29/plan.md`

Plan:

1. Mark Cycle 28 as signed and pushed at `d985f549`.
2. Record that Cycle 28's committed plan lacked deploy evidence before Cycle 29.
3. Use Cycle 29's required per-cycle deploy and live smoke as the production closure evidence for current pushed history.

Acceptance:

- Cycle 28 is no longer advertised as the active current-cycle plan.
- Cycle 28 no longer claims signed push is pending.
- Cycle 29 records current deploy/live-smoke evidence before completion.

Status: implemented; first Cycle 29 deploy evidence recorded below. The final report records the redeploy of this terminal-evidence commit.

### WP3 - Carry-forward register refresh

Findings: `AGG-C29-04`

Files:

- `.context/plans/deferred-carry-forward.md`

Plan:

1. Update the register to a Cycle 29 check basis.
2. Add Cycle 27 and Cycle 28 deferred rows with preserved severity/confidence and short exit criteria.
3. Keep per-cycle deferred files authoritative for full citations/rationale.

Acceptance:

- The consolidated register includes Cycle 27 and Cycle 28 open deferred findings.
- The age-budget header no longer points at the stale Cycle 24/26 checkpoint.

Status: implemented.

## Finding Disposition Map

Scheduled here: `AGG-C29-01`, `AGG-C29-02`, `AGG-C29-03`, `AGG-C29-04`.

Deferred this cycle: none.

## Progress

- [x] Prompt 1 review artifacts written and aggregated.
- [x] Prompt 2 plan written.
- [x] WP1 inline server-action scanner coverage.
- [x] WP3 carry-forward register refresh.
- [x] WP2 terminal deploy evidence.
- [x] Required full gates.
- [x] Signed commit/push for implementation.
- [x] Per-cycle deploy and live smoke.

## Gate Evidence

- Focused scanner tests passed: `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/cycle-28-source-contracts.test.ts src/__tests__/cycle-29-source-contracts.test.ts` (3 files, 138 tests).
- ESLint passed: `npm run lint --workspace=apps/web`.
- Admin API auth lint passed: `npm run lint:api-auth --workspace=apps/web`.
- Server-action origin lint passed: `npm run lint:action-origin --workspace=apps/web`.
- Public route rate-limit lint passed: `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Typecheck passed: `npm run typecheck --workspace=apps/web`.
- Production build passed: `npm run build --workspace=apps/web` (Next.js 16.2.10).
- Full unit suite passed: `npm test --workspace=apps/web` (361 files passed, 2 skipped; 3384 tests passed, 4 skipped).
- Browser e2e not run: not required for scanner/docs/source-contract changes.

## Terminal Evidence

- Signed implementation commit: `36a79146a7519a267af0c5dbcaf3d9909e727289` (`git log -1 --format='%G?'` reported `G`).
- Push: `git pull --rebase` reported `Current branch master is up to date`; `git push` updated `master` from `f4faad29` to `36a79146`.
- Deploy: `npm run deploy` completed successfully from repo root; the helper pulled `36a79146`, rebuilt the remote image, recreated and started `gallerykit-web`, waited for health, and completed the documented Docker cleanup.
- Live smoke: `curl -fsS https://gallery.atik.kr/api/live` returned `{"status":"ok"}`.
- Missing-photo smoke: `curl -sS -o /dev/null -w '%{http_code}' https://gallery.atik.kr/uploads/jpeg/__missing-cycle29__.jpg` returned `404`.
