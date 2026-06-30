# Cycle 26 Code Review

Reviewer: cycle-26 code-reviewer
Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `d13d66377e6952ae974a6ee3d29ce52f0aa77640`
Date: 2026-06-30

## Inventory

Read first, before inventory/review: `AGENTS.md`, `CLAUDE.md`.

Tracked file inventory from `git ls-files`:

| Area | Count |
| --- | ---: |
| App Router/API/actions | 77 |
| Components | 57 |
| Shared/domain/runtime libs | 98 |
| DB schema | 3 |
| Unit/source-contract tests | 274 |
| E2E tests | 8 |
| Scripts | 27 |
| Drizzle migrations/meta | 31 |
| Other app/config/assets | 42 |
| Review history | 1678 |
| Plans | 275 |
| Docs | 2 |
| Root/config/other | 16 |
| Total tracked files | 2588 |

Review focus: whole-repo code quality, logic, maintainability, correctness, cross-file interactions, and the delta since cycle 25 (`4cb1258b..HEAD`). Deep inspection covered restore maintenance, DB restore, image queue quiescing/resume, public analytics rate limiting, action-origin linting, deploy/entrypoint scripts, changed tests, and broad `rg` sweeps for unsafe SQL, filesystem side effects, server/client boundary issues, broad action imports, ignored promises, and TODO/suppression hotspots.

## Findings

### C26-CODE-HIGH-01 - Durable restore marker I/O can wedge maintenance state

Severity: High
Confidence: High
Region: `apps/web/src/lib/restore-maintenance-durable.ts:68-78`, called from `apps/web/src/app/[locale]/admin/db-actions.ts:448` and `apps/web/src/app/[locale]/admin/db-actions.ts:498`

Failure scenario:
`beginDurableRestoreMaintenance()` sets the process-local restore flag before writing `data/restore-maintenance.json`. If `fs.mkdirSync` or `fs.writeFileSync` throws because the bind mount is read-only, full, or permission-broken, the exception aborts `restoreDatabase()` before the inner cleanup block is entered. The outer `finally` releases advisory locks, but no code clears the in-process maintenance flag. The current Node process then rejects uploads/admin mutations/analytics as "restore in progress" until restart.

The end path has the same exception-ordering problem. `endDurableRestoreMaintenance()` unlinks the marker before calling `endRestoreMaintenance()`. If `fs.unlinkSync` throws after a successful restore, `restoreDatabase()` exits its cleanup block before clearing maintenance or resuming the quiesced image-processing queue, leaving the process and queue wedged even though the DB restore may have completed.

Concrete fix:
Make the durable lifecycle exception-safe and atomic. On begin, either write the marker first and then set process state, or catch marker-write failure and immediately `endRestoreMaintenance()` before rethrowing/returning a failed restore result. Prefer write-to-temp + fsync/rename for the marker. On end, use `try/finally` so process cleanup and queue resume cannot be skipped by marker cleanup failure, and make `restoreDatabase()` catch/report marker cleanup errors explicitly. Add tests for marker write failure and marker unlink failure that assert maintenance state is cleared or intentionally preserved with a surfaced error and that the queue resume path is not skipped accidentally.

## Evidence

Commands run:

- `git status --short` - clean before writing this report.
- `git ls-files` inventory - 2588 tracked files.
- `npm test --workspace=apps/web -- restore-maintenance public-actions` - passed, 2 files / 28 tests.
- `npm run lint:action-origin --workspace=apps/web` - passed, all mutating server actions covered.
- Static sweeps over `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, deploy scripts, and app config for filesystem side effects, raw SQL/query surfaces, broad action imports, public analytics recorders, restore marker usage, exception ordering, and lint suppressions.

## Final Missed-Issues Sweep

Rechecked the confirmed finding against `restoreDatabase()` cleanup order, image queue quiesce/resume, and marker startup sync. Rechecked public analytics rate-limit ordering and action-origin scanner fixtures; no additional code-review findings met the confidence bar. Existing cycle-25 architecture backlog items remain separate and are not duplicated here.
