# Cycle 8 Debugger Review - 2026-06-29

Role: `debugger`  
Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `1e182969`  
Constraint: review-only for implementation files. This report is the only file written.

## Scope And Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory and context checked before filing:

- Active review-relevant files inventoried across source, tests, scripts, migrations, config, and current/prior review docs: 1137 text files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `.context/reviews/cycle-8-2026-06-29`, and `.context/plans`.
- Current Cycle 8 peer reports read to avoid duplicates: `code-reviewer.md`, `critic.md`, `perf-reviewer.md`, `security-reviewer.md`, `test-engineer.md`, and `verifier.md`.
- Restore/backup and queue lifecycle surfaces inspected in detail: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/image-queue.ts`, restore-maintenance wiring, upload/restore coordination tests, image-queue quiesce tests, and prior restore lifecycle plans/deferred items.
- Final sweeps covered auth/origin/rate-limit gates, queue/bootstrap state transitions, restore rollback/cleanup paths, migration/runbook docs, production deploy scripts, current Cycle 8 findings, and historical deferred restore/queue findings.

Skipped as non-review-relevant: dependency/build/runtime artifacts (`node_modules`, `.next`, `.omx`/`.omc` state), generated uploads/resources, binary fixtures/screenshots except where named by tests, and local env/secret files.

## Findings

### DBG-C8-01 - Restore validation failures clear the image queue without restarting bootstrap

Severity: Medium  
Confidence: High  
Status: Confirmed latent production incident trigger.

File/region:

- `apps/web/src/app/[locale]/admin/db-actions.ts:360-381`
- `apps/web/src/app/[locale]/admin/db-actions.ts:443-464`
- `apps/web/src/app/[locale]/admin/db-actions.ts:492-502`
- `apps/web/src/lib/image-queue.ts:953-1007`
- `apps/web/src/__tests__/restore-upload-lock.test.ts:56-63`

Evidence:

- The restore action flushes view counts and calls `quiesceImageProcessingQueueForRestore()` before it validates the uploaded SQL dump inside `runRestore`: `apps/web/src/app/[locale]/admin/db-actions.ts:360-369`.
- `quiesceImageProcessingQueueForRestore()` pauses the PQueue, clears queued work, waits for idle, drains side effects, clears in-memory enqueue/retry/error state, and sets `bootstrapped = false`: `apps/web/src/lib/image-queue.ts:953-990`.
- `runRestore()` can still fail before any MySQL import starts: invalid dump header returns `invalidSqlDump` at `apps/web/src/app/[locale]/admin/db-actions.ts:443-464`; dangerous SQL returns `disallowedSql` at `apps/web/src/app/[locale]/admin/db-actions.ts:492-495`; missing DB env returns `missingDbConfig` at `apps/web/src/app/[locale]/admin/db-actions.ts:497-502`.
- The `finally` block ends restore maintenance when `keepRestoreMaintenance` is false, but it only calls `resumeImageProcessingQueueAfterRestore()` when `restoreLifecycleVerified` is true: `apps/web/src/app/[locale]/admin/db-actions.ts:373-381`.
- The only test around failed restore maintenance pins post-restore migration failure latching (`keepMaintenance: true`) and does not cover a pre-import validation failure after queue quiesce: `apps/web/src/__tests__/restore-upload-lock.test.ts:56-63`.

Concrete failure scenario:

1. The site has pending image-processing work: queued jobs and/or rows with `processed = false`.
2. An admin starts a DB restore with a bad file, such as a non-SQL upload or a SQL file containing a denied statement.
3. The restore action enters maintenance and quiesces the image queue before validating the dump. Existing queued jobs are intentionally cleared and `bootstrapped` is reset so the post-restore bootstrap can rediscover pending rows.
4. `runRestore()` rejects the file before MySQL import starts and returns `{ success: false }` without `keepMaintenance`.
5. The `finally` block ends maintenance, but because `restoreLifecycleVerified` is false it never starts the queue or calls `bootstrapImageProcessingQueue()`.
6. The restore attempt visibly fails, but pre-existing pending image rows can remain unprocessed until a process restart or another path happens to bootstrap the queue. This is a production incident trigger after an operator mistake, with no successful restore required.

Concrete fix:

- Split restore validation from destructive/import work. Perform the non-destructive checks that can return `invalidSqlDump`, `disallowedSql`, or `missingDbConfig` before `quiesceImageProcessingQueueForRestore()`, or have `runRestore()` return a failure phase such as `importStarted: false`.
- For failures before import starts, pair `endRestoreMaintenance()` with `resumeImageProcessingQueueAfterRestore()` so the cleared queue state is bootstrapped again.
- Preserve the existing latch/no-resume behavior for post-import or post-restore migration failures where the database may be inconsistent (`keepMaintenance: true`).
- Add a regression test beside `restore-upload-lock.test.ts` that simulates a pre-import `runRestore` failure after quiesce and asserts maintenance end is paired with queue resume/bootstrap, while the existing migration-failure case still keeps maintenance active and does not resume.

Why this is not a duplicate:

- Current Cycle 8 reports cover env-concurrency parsing, CLIP preprocessing admission, card hydration, analytics indexes/referrer privacy, tracked secrets, stale docs, and test-gate gaps. None covers restore validation failures after queue quiesce.
- `plan/plan-317-run5-cycle1-deferred.md:43-46` records a different deferred concern: failed restore ending maintenance and bootstrapping against a possibly inconsistent DB after import failure. This finding is narrower: pre-import validation failures happen after queue quiesce but before any MySQL import starts, so the DB is not made inconsistent; the bug is that the cleared queue is not resumed.
- `.context/plans/cycle-6-2026-06-29-plan.md:33` intentionally says to resume only after import and post-restore migrations succeed. That policy still makes sense for post-import uncertainty; it does not account for validation failures caused by quiescing before validation.

## Non-Findings Checked

- Post-restore migration failures intentionally keep maintenance active and avoid queue resume through `keepMaintenance: true`; this is covered by the existing source-contract test and is not refiled.
- The prior quiesce deadlock ordering issue is fixed: `pause()`, `clear()`, then `onIdle()` is present in `apps/web/src/lib/image-queue.ts:977-980`.
- Uploads are still blocked during restore maintenance before new work can interleave with queue quiesce; this review did not find a new upload/restore race.
- Existing Cycle 8 findings from peer reports were not duplicated: `CODE-C8-01`, `SEC-C8-01`, `PERF-C8-01`, `PERF-C8-02`, `C8-CRIT-01`, `C8-CRIT-02`, `C8-V-01`, `TEST-C8-01`, `TEST-C8-02`, and `TEST-C8-03`.

## Final Missed-Issue Sweep

Final sweep commands and checks:

- Re-ran source searches for `quiesceImageProcessingQueueForRestore`, `resumeImageProcessingQueueAfterRestore`, `invalidSqlDump`, `disallowedSql`, `missingDbConfig`, `keepMaintenance`, `failed restore`, and queue/bootstrap terms across source, tests, current Cycle 8 reports, `.context/plans`, and `plan/`.
- Rechecked exact line evidence with `nl -ba` on the restore action, queue lifecycle helper, and restore/upload coordination tests.
- Checked `git status --short` before writing this report; the only pre-existing untracked file was `.context/reviews/cycle-8-2026-06-29/test-engineer.md`, left untouched.

No additional debugger-grade bug survived deduplication and evidence review without overlapping a current Cycle 8 peer report or historical deferred item.
