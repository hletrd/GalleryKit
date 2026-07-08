# Cycle 23 Document-Specialist Review

Role: `document-specialist`
Repo: `/Users/hletrd/flash-shared/gallery`
Review HEAD: `66a2ec6f0797d4c7a3a12bab6d610a2dbae21013`
Scope: review-only. No source behavior, commits, pushes, or deploys.

## Inventory

Rules and ledgers read first: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, `.context/plans/deferred-carry-forward.md`, `.context/plans/cycle-22-2026-07-08-plan.md`, `.context/plans/cycle-22-2026-07-08-deferred.md`, `.context/plans/cycle-23-2026-06-30-plan.md`, and `.context/plans/cycle-23-2026-06-30-deferred.md`.

Code/doc cross-check surfaces: root/app `package.json`, `apps/web/playwright.config.ts`, `CLAUDE.md`, `apps/web/src/lib/pending-file-deletions.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/__tests__/pending-file-deletions.test.ts`, `apps/web/src/__tests__/pending-session-revocations.test.ts`, and current Cycle 23 review artifacts under `.context/reviews/`.

## Findings

### DOC-C23-01 - Cycle 22 plan and index still say commit/push/deploy are pending after the recovery commit is pushed

Severity: Medium
Confidence: High
Status: confirmed docs/provenance mismatch
Validation: confirmed from tracked docs and git history

Evidence:

- `.context/plans/cycle-22-2026-07-08-plan.md:3` says `Status: IMPLEMENTED - GATES PENDING`.
- `.context/plans/cycle-22-2026-07-08-plan.md:154-163` says commit/push/deploy are pending and leaves WP6 unchecked.
- `.context/plans/cycle-22-2026-07-08-plan.md:167-175` records every local gate, including full Vitest and Playwright, as PASS.
- `.context/plans/README.md:34-37` still lists Cycle 22 plan/deferred as the active current-cycle pair.
- Commit `57c1ae33` is already in history and its body records the full gate list as tested. Current HEAD is later review-only work on top of that commit.

Failure scenario:

A Cycle 23 planner cannot tell whether Cycle 22 is source-complete, pushed, deployed, or still blocked. That can lead to duplicate deploy work, stale production assumptions, or incorrect deferral bookkeeping.

Suggested fix:

Append terminal Cycle 22 evidence to `.context/plans/cycle-22-2026-07-08-plan.md`: exact commit hash, push state, deploy result or explicit deploy-not-run/superseded state, and smoke result. Move Cycle 22 out of Active Current-Cycle Plans once that evidence is recorded.

### DOC-C23-02 - Cycle 22 pending-deletion plan overstates the behavior-test coverage that landed

Severity: Medium
Confidence: High
Status: confirmed doc/test mismatch
Validation: source/test confirmed; runtime behavior not changed in this lane

Evidence:

- `.context/plans/cycle-22-2026-07-08-plan.md:53-56` requires behavior tests for transient failure then later success, missing-file idempotency, and restore-active suppression.
- `.context/plans/cycle-22-2026-07-08-plan.md:64` marks the work implemented and says maintenance runs the drain behind the restore guard.
- `apps/web/src/__tests__/pending-file-deletions.test.ts:111-158` covers all-success, persistent failure, and batch limit clamping, but it mocks the strict filesystem helpers and does not cover missing files or transient failure then success.
- `apps/web/src/__tests__/pending-session-revocations.test.ts:101-116` checks restore ordering and scheduler inclusion with string/index assertions, not executable behavior.
- `CLAUDE.md:437` now documents missing files as already-cleaned and retry after restore maintenance, so the operator-facing contract depends on those unexercised paths.

Failure scenario:

Future maintainers read the plan and runbook as behavior-backed. A refactor could move the drain outside the restore guard, change ENOENT handling, or reorder post-restore cleanup while the current behavior tests remain green.

Suggested fix:

Amend the Cycle 22 plan to distinguish implemented runtime wiring from behavior coverage still missing, or add the missing tests in the next implementation lane. The best tests are a mocked restore-active scheduler test, a post-marker sequencing helper test, a temp-dir missing-file test through strict helpers, and a transient failure-then-success drain test.

### DOC-C23-03 - Older root-level `cycle-23-2026-06-30-*` plans are not disambiguated from the current Cycle 23 review

Severity: Low-Medium
Confidence: High
Status: confirmed provenance ambiguity
Validation: docs-only

Evidence:

- `.context/plans/cycle-23-2026-06-30-plan.md:1-5` is titled `Cycle 23/100 Implementation Plan`, dated 2026-06-30, and points at `.context/reviews/_aggregate.md`.
- `.context/plans/cycle-23-2026-06-30-deferred.md:1-7` is the matching deferred register.
- `.context/plans/README.md:39-43` disambiguates historical Cycle 9 and Cycle 19-22 naming collisions, but does not mention the dated Cycle 23 pair.
- The current lineage restarted run-10 on 2026-07-06 per `.context/plans/README.md:7-12`, while this prompt is Cycle 23 on 2026-07-08. The checked-in root `.context/reviews/_aggregate.md` still labels Cycle 22, so the old Cycle 23 plan's `Review source` pointer is stale for current Cycle 23 work.

Failure scenario:

A Cycle 23 planner greps for `cycle-23` and accidentally treats the 2026-06-30 plan as the current Cycle 23 ledger, importing old aggregate IDs and completed/pending states into the run-10 cycle.

Suggested fix:

Either archive the 2026-06-30 Cycle 23 pair with the other historical plans or add it to the README disambiguation section as pre-run-10/historical. Current run-10 Cycle 23 files should use dated names that cannot collide with the older pair.

## Confirmed Accurate Docs

- `CLAUDE.md:437` now documents `pending_file_deletions`, automatic retry, restore-maintenance timing, missing-file semantics, and an operator inspection query.
- Root/app package docs match the current Next/React/Node toolchain at the level reviewed here.
- The unsupported-storage warning remains clear: `CLAUDE.md` says the `@/lib/storage` abstraction exists but product support is local filesystem only.

## Final Missed-Issue Sweep

Swept README/CLAUDE/plans/reviews for deploy-state, pending-deletion, semantic-search, Lightroom/PAT, storage/S3, site-config, route-rate-limit, and current-cycle naming drift. No source behavior was modified. Live production deploy state, host nginx, real CLIP weights, and archived historical review trees were not validated.
