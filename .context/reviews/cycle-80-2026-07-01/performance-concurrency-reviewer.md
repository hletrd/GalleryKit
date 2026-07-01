# Cycle 80 Performance / Concurrency Reviewer

Start HEAD: `8c4999c9294e0196608b4a0bce8078edc3be2366`.

## Inventory

- Read `AGENTS.md`, `CLAUDE.md`, image queue shutdown, background DB write tracking, audit writes, public analytics actions, restore maintenance drains, and admin backfill concurrency notes.
- Historical restore foreground mutation fencing and other carry-forward deferred items were not re-raised without new evidence.

## Findings

### C80-02 - SIGTERM shutdown does not drain tracked background DB writes

- Severity: Medium
- Confidence: High
- Citations: `apps/web/src/lib/background-db-writes.ts:3`, `apps/web/src/lib/background-db-writes.ts:20`, `apps/web/src/lib/audit.ts:86`, `apps/web/src/app/actions/public.ts:431`, `apps/web/src/app/[locale]/admin/db-actions.ts:492`, `apps/web/src/instrumentation.ts:36`, `apps/web/src/instrumentation.ts:55`
- Problem: Fire-and-forget audit and analytics writes are tracked in a process-local set and restore drains them before import, but graceful shutdown drains only the image-processing queue and shared-group view buffer before `process.exit()`.
- Failure scenario: deploy or container stop sends `SIGTERM` while an audit event or public analytics insert is still in flight; the process can exit before the tracked write settles, losing the row.
- Suggested fix: expose a generic `drainBackgroundDbWrites()` helper, include it in instrumentation's bounded shutdown `Promise.all`, and add a source contract test.

## Final Sweep

No additional current-HEAD performance or race-condition finding was confirmed beyond this shutdown drain gap.
