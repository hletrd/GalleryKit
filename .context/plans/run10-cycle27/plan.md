# Run-10 Cycle 27/100 Implementation Plan

Status: COMPLETED - SIGNED PUSHED; DEPLOY EVIDENCE ABSENT AND SUPERSEDED BY CYCLE 28
Aggregate: `.context/reviews/run10-cycle27/_aggregate.md`
Date: 2026-07-08 KST
Review start HEAD: `cff8d59f0301df8f64e030adc0fb2d65e825903a`

## Scope

This plan schedules every Cycle 27 aggregate finding that is bounded and safe for this cycle. Deferred findings are recorded in `deferred.md` with severity/confidence preserved, citations, deferral rationale, and exit criteria.

Repo rules read before scheduling/deferring: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/cycle-26-2026-07-08-plan.md`, `.context/plans/cycle-26-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`, and the Cycle 27 review artifacts.

## Scheduled Work Packages

### WP1 - Restore-maintenance fast-paths before admin/session DB work

Findings: `AGG-C27-01`

Files:

- `apps/web/src/app/[locale]/admin/page.tsx`
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/admin-backfill.ts`
- `apps/web/src/__tests__/admin-page-restore-maintenance.test.tsx`
- `apps/web/src/__tests__/auth-actions-behavior.test.ts`
- `apps/web/src/__tests__/admin-backfill-status-shape.test.ts`
- `apps/web/src/__tests__/protected-admin-restore-maintenance-layout.test.tsx`
- `apps/web/src/__tests__/cycle-22-source-contracts.test.ts`

Plan:

1. Render the admin restore-maintenance shell from `/admin` before `isAdmin()`.
2. Move `updatePassword()` restore-maintenance rejection ahead of `getCurrentUser()`.
3. Move `triggerBackfill()` maintenance rejection ahead of `isAdmin()`.
4. Add a maintenance gate to `getBackfillStatus()` before auth and candidate-count reads.
5. Add behavior/source tests that prove these paths do not call auth/session/candidate helpers during maintenance.

Acceptance:

- `/admin` returns `PublicRestoreMaintenance` and does not call `isAdmin()` while maintenance is active.
- `updatePassword()` returns maintenance before session lookup, Argon2, or transaction work.
- Backfill status returns maintenance before `isAdmin()` or candidate counting.
- Parent admin layout behavior test covers its maintenance-before-current-user rule.

Status: implemented. Focused tests pass.

### WP2 - Release ledger closure

Findings: `AGG-C27-03`

Files:

- `.context/plans/cycle-26-2026-07-08-plan.md`
- `.context/plans/README.md`
- `.context/plans/run10-cycle27/plan.md`

Plan:

1. Update the Cycle 26 plan status so commit/push/local gates are no longer shown as pending.
2. Record that Cycle 26 deploy evidence was not committed before Cycle 27 and is superseded by Cycle 27's required per-cycle deploy.
3. Update the plan index with Cycle 27 as the active/current plan.
4. After full gates, push, deploy, and live smoke, record terminal evidence in this plan.

Acceptance:

- No current plan/index line falsely says Cycle 26 source commit/push is pending.
- Cycle 27 records full gate and deploy evidence.

Status: implemented. Signed commit `8753b939a780984b2c988fb6b75ed23ebad98ec9` is present on `origin/master`; no Cycle 27 deploy transcript was committed before Cycle 28, so Cycle 28's per-cycle deploy supersedes production evidence for this work.

## Finding Disposition Map

Scheduled here: `AGG-C27-01`, `AGG-C27-03`.

Deferred in `deferred.md`: `AGG-C27-02`, `AGG-C27-04`, `AGG-C27-05`.

## Progress

- [x] WP1 restore-maintenance fast-paths and focused tests.
- [x] WP2 ledger closure and full local gates.
- [x] Signed push.
- [x] Deploy/live-smoke disposition recorded: no Cycle 27 deploy transcript was committed before Cycle 28; superseded by Cycle 28's required per-cycle deploy.

## Gate Evidence

- Focused tests passed: `npm test --workspace=apps/web -- --run src/__tests__/admin-page-restore-maintenance.test.tsx src/__tests__/auth-actions-behavior.test.ts src/__tests__/admin-backfill-status-shape.test.ts src/__tests__/protected-admin-restore-maintenance-layout.test.tsx src/__tests__/cycle-22-source-contracts.test.ts` (5 files, 26 tests).
- Full lint passed: `npm run lint --workspace=apps/web`.
- Admin API auth lint passed: `npm run lint:api-auth --workspace=apps/web`.
- Server-action origin lint passed: `npm run lint:action-origin --workspace=apps/web`.
- Public route rate-limit lint passed: `npm run lint:public-route-rate-limit --workspace=apps/web`.
- Typecheck passed: `npm run typecheck --workspace=apps/web`.
- Production build passed: `npm run build --workspace=apps/web`.
- Full unit suite passed: `npm test --workspace=apps/web` (361 files passed, 2 skipped; 3378 tests passed, 4 skipped).
- E2E not run: changes are server-action/admin maintenance ordering plus source-contract coverage; no browser-only flow changed.

## Terminal Evidence

- Signed commit: `8753b939a780984b2c988fb6b75ed23ebad98ec9` (`fix(cycle27): 🐛 gate restore maintenance earlier`), GPG good signature from `Jiyong Youn <01@0101010101.com>`.
- Push state: Cycle 28 started with `8753b939a780984b2c988fb6b75ed23ebad98ec9` at `origin/master`.
- Deploy evidence: no committed Cycle 27 deploy transcript was found before Cycle 28. Cycle 28's per-cycle deploy is the production-closure evidence for the current pushed history.
