# Cycle 62 Code / Debug / Trace Review

Reviewer: code-reviewer/debugger/tracer
Date: 2026-07-01
Scope: Cycle 61 changes from `7e85644e` to `0bf3371c` plus the current plan/review ledgers.

## Context Read

- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `.context/plans/cycle-61-2026-07-01-plan.md`
- `.context/plans/cycle-61-2026-07-01-deferred.md`
- `.context/reviews/cycle-61-2026-07-01/_aggregate.md`

## Inventory

Changed implementation files reviewed:

- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/api/og/photo/[id]/route.tsx`
- `apps/web/src/app/api/admin/lr/upload/route.ts`

Changed regression/source-contract files reviewed:

- `apps/web/src/__tests__/og-route-rate-limit-behavior.test.ts`
- `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`
- `apps/web/src/__tests__/migration-journal.test.ts`

Relevant cross-file invariants traced:

- Restore maintenance process/durable state: `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/instrumentation.ts`
- Restore/upload coordination: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`
- Browser upload parity: `apps/web/src/app/actions/images.ts`
- OG rate limit behavior: `apps/web/src/lib/rate-limit.ts`
- Migration journal/file parity: `apps/web/drizzle/meta/_journal.json`, `apps/web/drizzle/*.sql`
- Cycle plan/review ledgers under `.context/plans/` and `.context/reviews/`

Deferred Cycle 61 coverage gaps `C61-06` and `C61-07` were not re-raised; this pass only checked whether current code made them active source defects.

## Findings

### C62-CDT-01 - Cycle 61 remains marked active/incomplete after its fix commit reached origin

- Severity: Medium
- Confidence: High
- File/line: `.context/plans/cycle-61-2026-07-01-plan.md:8`, `.context/plans/cycle-61-2026-07-01-plan.md:45`, `.context/plans/cycle-61-2026-07-01-plan.md:54`, `.context/plans/cycle-61-2026-07-01-plan.md:55`, `.context/plans/README.md:7`, `.context/plans/README.md:12`
- Scenario: `HEAD` and `origin/master` are both `0bf3371c fix(cycle-61): guard restore-sensitive routes`, and `git show --show-signature 0bf3371c` reports a good GPG signature. The Cycle 61 plan still says its goal includes commit/push/deploy, still instructs `npm run deploy`, leaves "Commit, pull --rebase, push" and "Deploy with npm run deploy" unchecked, and the plan index still lists Cycle 61 as active/scheduled.
- Impact: Later review-plan-fix cycles cannot tell whether Cycle 61 actually completed or whether production is still on the previous deployed baseline. This is the same ledger class Cycle 61 fixed for Cycle 60, and it can cause repeated review work or a missed per-iteration deploy under the repo policy.
- Suggested fix: Update `cycle-61-2026-07-01-plan.md` with the signed commit SHA, origin/master evidence, and deploy result for `0bf3371c`; check off commit/push/deploy if completed. If deploy was not run, schedule/run `npm run deploy` before closing. Update `.context/plans/README.md` so Cycle 61 is no longer listed as active once terminal evidence is recorded.

## Confirmed Non-Findings

- The OG route guards run before rate-limit charging and before DB/config/image work in the changed routes (`apps/web/src/app/api/og/route.tsx:64`, `apps/web/src/app/api/og/photo/[id]/route.tsx:46`). Startup durable-marker hydration is wired through `apps/web/src/instrumentation.ts:3`.
- The Lightroom route now re-checks restore maintenance and acquires the upload-processing contract lock before the topic `SELECT` (`apps/web/src/app/api/admin/lr/upload/route.ts:257`, `apps/web/src/app/api/admin/lr/upload/route.ts:272`, `apps/web/src/app/api/admin/lr/upload/route.ts:287`). Early returns settle the upload tracker and the lock is released in `finally`.
- The migration journal test now checks both directions. Local inventory found 29 top-level SQL files and 29 journal entries, with no missing or extra tags.

## Validation

- `npm test --workspace=apps/web -- og-route-rate-limit-behavior lr-upload-hdr-gate migration-journal` passed: 4 files, 55 tests.
- `git show --show-signature --no-patch 0bf3371c` showed a good GPG signature.
- `git branch -vv` showed `master 0bf3371c [origin/master]`.

## Residual Risks

- Full `npm test`, lint, typecheck, build, and deploy were not re-run in this review subtask; Cycle 61 recorded those gate results in its plan, except terminal commit/deploy closure remains stale as noted above.
- Cycle 61 deferred coverage gaps remain deferred by plan: shared-group view-count behavioral tests and full Lightroom handler-level integration tests.
