# Cycle 26 Architect Review

Reviewer: cycle-26 architect
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

Architecture review focus: restore/maintenance lifecycle ownership, process-local versus durable state, queue/DB restore coordination, public analytics side effects, action/server boundary coupling, deploy/runtime contracts, and changed-source delta since cycle 25.

## Findings

### C26-ARCH-HIGH-01 - Restore lifecycle lacks a single exception-safe owner

Severity: High
Confidence: High
Region: `apps/web/src/lib/restore-maintenance-durable.ts:60-78`, `apps/web/src/app/[locale]/admin/db-actions.ts:482-526`, `apps/web/src/instrumentation.ts:1-5`

Failure scenario:
Restore state is now split across a process-local flag, a durable marker file, the image queue pause/quiesce state, and several MySQL advisory locks. The durable helper is intended to bridge process restarts, but it does not own the lifecycle transactionally. Marker write happens after process state is set, and marker unlink happens before process state is cleared. A filesystem exception at either edge leaves different layers disagreeing:

- marker write failure: process says restore maintenance is active, marker may not exist, DB locks are released, and future requests in that process are blocked until restart.
- marker unlink failure after a verified restore: marker remains, process maintenance remains active, queue resume can be skipped, and the next startup re-enters maintenance from the stale marker.

This is an architectural ownership bug: the restore lifecycle spans DB, filesystem, queue, and process state, but no component provides an all-or-rollback state transition.

Concrete fix:
Introduce a small restore lifecycle manager that owns `begin`, `quiesce`, `complete`, and `abort` as explicit phases. Its phase transitions should use `try/finally` around each side effect and define the fallback state for marker I/O failure. At minimum, refactor `beginDurableRestoreMaintenance()` and `endDurableRestoreMaintenance()` so process state and queue resume cannot be skipped by marker I/O exceptions; then adjust `restoreDatabase()` to surface marker failures as restore setup/cleanup errors. Add source-contract or unit tests for marker write failure, marker unlink failure, and successful restore cleanup preserving queue resume.

## Evidence

Commands run:

- `git status --short` - clean before writing this report.
- `git ls-files` inventory - 2588 tracked files.
- `npm test --workspace=apps/web -- restore-maintenance public-actions` - passed, 2 files / 28 tests.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- Whole-repo sweeps for `globalThis`, `Symbol.for`, filesystem marker operations, `begin/endDurableRestoreMaintenance`, public analytics recorders, queue shutdown/quiesce paths, broad action-barrel imports, raw SQL/query surfaces, deploy scripts, and server/client boundary imports.

## Final Missed-Issues Sweep

Final sweep revisited schema/migration/reconciler surfaces, restore/backfill/upload locks, process-local state, public analytics writes, CI/deploy scripts, and action lint gates. No second new architecture finding met the confidence bar beyond the restore lifecycle ownership issue. Cycle-25 deferred architecture items remain valid backlog context but are not re-reported as new cycle-26 findings.
