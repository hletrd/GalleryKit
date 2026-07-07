# Cycle 23 Code Reviewer Report

Date: 2026-07-08 KST
Role: `code-reviewer`
Review HEAD: `57c1ae33c0b9a0dd483cfdf58750b81d42a7d775`
Base reviewed: Cycle 22 implementation range `8b795862..HEAD`
Scope: review-only. No implementation changes made.

## Inventory

Guidance read first:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `code-review` skill instructions at `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Review-relevant changed files inventoried before findings:
- 28 files changed in `8b795862..HEAD`.
- Runtime/scripts/tests: `apps/web/scripts/check-action-origin.ts`, `apps/web/src/__tests__/check-action-origin.test.ts`, `apps/web/src/__tests__/data-timeline-behavior.test.ts`, `apps/web/src/__tests__/pending-file-deletions.test.ts`, `apps/web/src/__tests__/pending-session-revocations.test.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/pending-file-deletions.ts`, `CLAUDE.md`.
- Review/plan docs: `.context/plans/README.md`, `.context/plans/cycle-21-2026-07-08-plan.md`, `.context/plans/cycle-22-2026-07-08-plan.md`, `.context/plans/cycle-22-2026-07-08-deferred.md`, `.context/plans/deferred-carry-forward.md`, and top-level review artifacts under `.context/reviews/`.

Connected files examined for cross-file interactions:
- Pending deletion schema/migration/reconcile surface: `apps/web/src/db/schema.ts`, `apps/web/drizzle/0030_pending_file_deletions.sql`, `apps/web/scripts/migrate.js`.
- Filesystem delete semantics: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/process-image.ts`.
- Delete action writers: `apps/web/src/app/actions/images.ts`.
- Timeline parser and grouping: `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/mysql-datetime.ts`.
- Maintenance/restore source-contract tests: `apps/web/src/__tests__/maintenance-scheduler-source.test.ts`, `apps/web/src/__tests__/pending-file-deletions-source.test.ts`.

Validation evidence:
- `npm test --workspace=apps/web -- --run src/__tests__/check-action-origin.test.ts src/__tests__/pending-file-deletions.test.ts src/__tests__/pending-session-revocations.test.ts src/__tests__/data-timeline-behavior.test.ts` passed: 4 files, 124 tests.
- `npm run lint:action-origin --workspace=apps/web` passed on current source.
- Synthetic scanner repro with `npx tsx -e ... checkActionSource(...)` confirmed `src/app/actions/settings.ts` can pass when a slot is acquired inside an inner branch and a later outer `db.update(...).set(...)` is outside that slot's scope.
- `git diff --check 8b795862..HEAD` failed on trailing whitespace in changed review docs.

## Findings

### CR23-01 - Mutation-barrier scanner accepts a nested slot that does not fence later outer mutations

- Severity: High
- Confidence: High
- Status: Confirmed
- Region: `apps/web/scripts/check-action-origin.ts:687-735`, especially `blockHasApprovedSlot` returning true for any visited block at `698-725` and the nested-block traversal at `728-735`; `apps/web/src/__tests__/check-action-origin.test.ts:624-675`; `CLAUDE.md:434`.
- Problem: `bodyAcquiresAdminMutationSlot()` walks every non-function block and returns true when any block contains `using mutationSlot = acquireAdminMutationSlot()` followed by an acquired-state gate. It does not prove that the discovered block dominates later mutating statements in the exported action body. Cycle 22 fixed same-block sibling mutations after a positive guard, but a slot inside an `if`/loop/try block can still satisfy the scanner while a later mutation in the outer function runs without holding a slot.
- Failure scenario: a future action is written as:
  ```ts
  if (input.skip) {
      using mutationSlot = acquireAdminMutationSlot();
      if (!mutationSlot.acquired) return { error: 'restore in progress' };
  }
  await db.update(settings).set(input);
  ```
  `checkActionSource()` returns `OK`, but when `input.skip` is false the DB write runs without a restore-mutation slot. A restore can drain zero foreground slots and then import while that mutation is still allowed to commit.
- Suggested fix: make the scanner reason at the exported action body boundary, not at any nested block. Either require the mutation slot/gate to be in the same top-level statement list that owns all later protected mutations, or compute the lexical region protected by the slot and require every protected write to be inside it. Add negative fixtures for slots inside `if`, `for`, `try`, and nested blocks followed by outer `db.*`, `logAuditEvent`, and revalidation calls.

### CR23-02 - Pending-deletion restore-suppression and missing-file behavior are under-tested compared with the plan contract

- Severity: Medium
- Confidence: High
- Status: Confirmed test-design risk; runtime wiring is source-confirmed
- Region: `.context/plans/cycle-22-2026-07-08-plan.md:51-64`; `apps/web/src/__tests__/pending-file-deletions.test.ts:111-158`; `apps/web/src/__tests__/maintenance-scheduler-source.test.ts:28-33`; `apps/web/src/lib/maintenance-scheduler.ts:26-47`; `apps/web/src/lib/pending-file-deletions.ts:105-139`.
- Problem: the Cycle 22 plan explicitly required behavior tests for "missing-file idempotency" and "restore-active suppression" (`cycle-22...plan.md:53-56`). The added behavior test covers success, persistent failure, and limit clamping only. Restore suppression is still source-pinned in `maintenance-scheduler-source.test.ts`, and missing-file idempotency is inferred from strict helper implementations rather than tested through the pending-deletion drain.
- Failure scenario: a later refactor could call `drainPendingFileDeletions()` outside `runMaintenanceTask`, or change strict delete helper ENOENT handling, while the new behavior test suite remains green. That would re-open the exact restore-window and stale-row classes Cycle 22 intended to close.
- Suggested fix: add executable tests that mock `isRestoreMaintenanceActive()` and prove `runMaintenanceSweep()` does not invoke the drain while active, plus temp-dir based tests where every referenced original/variant is already absent and the pending row is deleted. Keep the source-contract tests only as secondary tripwires.

### CR23-03 - Changed review artifacts contain trailing whitespace that fails `git diff --check`

- Severity: Low
- Confidence: High
- Status: Confirmed
- Region: `.context/reviews/_aggregate.md:3-5`; `.context/reviews/designer.md:3-5`, `26-27`, `52-53`, `78-79`, `111-118`; `.context/reviews/ui-ux-designer-reviewer.md:3-4`, `28-29`, `53-54`, `77-78`, `100-107`; `.context/reviews/product-marketer-reviewer.md:33-34`.
- Problem: several changed Markdown review artifacts carry trailing spaces. This is not a runtime bug, but it makes the changed range fail a standard patch hygiene check and creates noisy diffs.
- Failure scenario: if `git diff --check` is added to CI or used by a release reviewer, the cycle docs fail despite runtime gates being green. The noise also makes future review artifact edits harder to inspect.
- Suggested fix: trim trailing whitespace in the changed review artifacts and avoid Markdown hard-break spaces in committed review files unless there is a rendering requirement.

## Non-Findings / Verified Areas

- Pending-file deletion rows are selected oldest-first, bounded to 1..100 rows, and retry failures are retained with `attempts + 1` plus `last_error` (`apps/web/src/lib/pending-file-deletions.ts:95-139`).
- Missing original/variant files appear intended to be idempotent through `deleteOriginalUploadFileStrict()` ENOENT handling and `deleteImageVariantsStrict()`/`strictUnlink()` behavior (`apps/web/src/lib/upload-paths.ts:90-118`, `apps/web/src/lib/process-image.ts:552-640`).
- Restore completion drains pending deletions after clearing the durable marker (`apps/web/src/app/[locale]/admin/db-actions.ts:655-678`), and hourly/startup maintenance invokes the drain behind restore-active checks (`apps/web/src/lib/maintenance-scheduler.ts:35-47`).
- Timeline grouping now uses `parseMySqlDateTimeParts()` and skips invalid capture dates (`apps/web/src/lib/data-timeline.ts:244-266`); the added test exercises that path.

## Final Sweep

Swept for missed issues across raw SQL and Drizzle calls in changed code, restore-maintenance ordering, pending-deletion row lifecycle, strict filesystem delete semantics, action-origin scanner control-flow, source-contract versus behavior-test coverage, docs/ledger status, `.only` tests, and changed-file whitespace. I did not inspect binary screenshot artifacts, `.next`, `node_modules`, live MySQL, live nginx, production deployment state, uploaded runtime files, or CLIP model weights.
