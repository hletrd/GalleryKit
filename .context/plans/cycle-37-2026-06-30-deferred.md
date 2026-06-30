# Cycle 37/100 Deferred Findings

Date: 2026-06-30 KST
Source review: `.context/reviews/cycle-37-2026-06-30/_aggregate.md`
Reviewed HEAD: `d6c3a8f69911c84a63985a59827d4597def922d4`

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/**`, and current repository plan/review history. No `.cursorrules`, `CONTRIBUTING.md`, or `docs/` style/policy files exist in this checkout.

Deferred work remains bound by repo policy: GPG-signed Conventional Commit + gitmoji commits, no `--no-verify`, no force-push, required quality gates, and per-cycle deploy policy.

## New Cycle 37 Deferred Items

### AGG-C37-04 - Reconcile adds FK constraints without first converging orphaned legacy rows

- Original severity/confidence: High / High
- File+line citation: `apps/web/scripts/migrate.js:288`, `apps/web/scripts/migrate.js:692`, `apps/web/src/app/actions/admin-users.ts:251`, `apps/web/src/app/actions/images.ts:708`, `apps/web/src/db/schema.ts:200`, `apps/web/src/db/schema.ts:228`, `apps/web/src/db/schema.ts:284`
- Reason for deferral: Implementing the suggested convergence requires deleting orphan child records or rewriting nullable owner references during deploy. The user-level destructive-action rule requires explicit confirmation before deleting or modifying production database records, and this cycle only has deploy authorization, not separate authorization for destructive legacy-data cleanup. The current production target already deployed through the Cycle 36 FK repair at `d6c3a8f6`, so this is not blocking the configured `gallery.atik.kr` cycle deploy unless a future legacy/dirty database target is introduced.
- Exit criterion: Re-open when the operator explicitly authorizes a legacy orphan-row convergence policy, or if a deploy/reconcile log reports FK-add failure due orphan rows. The implementation should record affected counts, preserve a clear audit trail, add tests for dirty legacy data, and obey all migration/runbook rules.

### PERF-C37-01 - Live queue bootstrap can launch duplicate CLIP embedding sweeps

- Original severity/confidence: Medium / High
- File+line citation: `apps/web/src/lib/image-queue.ts:978`, `apps/web/src/lib/image-queue.ts:981`, `apps/web/src/lib/image-queue.ts:395`, `apps/web/src/lib/image-queue.ts:408`, `apps/web/src/lib/image-queue.ts:425`, `apps/web/src/lib/image-queue.ts:1007`
- Reason for deferral: Medium-severity performance/resource issue in an operator-gated semantic-search path. This cycle is reserved for high-severity scanner fail-open fixes that protect all future mutating server actions.
- Exit criterion: Re-open when semantic-search production/backfill work is scheduled, when production traces show overlapping live embedding sweeps, or when queue bootstrap/shutdown ownership is otherwise being touched.

## Carry-Forward Note

Cycle 36 deferred findings remain recorded in `.context/plans/cycle-36-2026-06-30-deferred.md` with original severity/confidence, reason, and exit criterion. This cycle did not re-open those items because no fresh evidence changed their severity or made them scheduled now.
