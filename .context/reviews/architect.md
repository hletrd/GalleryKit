# Architect — cycle 4 provenance

Review target: `01d39653`, 2026-07-18 KST. Review only.

## Architecture inventory

The full maintained system inventory covers 81 App Router files, 115 libraries, 61 components, DB/schema/migrations/reconcile, scripts/background jobs, 369 unit-test files and 12 Playwright files, build/runtime/deploy/nginx/PWA assets, and governing/operator/current/deferred documentation. I reviewed all post-Cycle-3 changes and swept server/client ownership, config lifetime, persistence, concurrency, privacy, caching, image/color delivery, and operational state across the repository.

## New architecture findings

### ARCH-C4-01 — Release state has two owners and the plan owner is stale

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed** current-head architecture/provenance issue
- Regions: `.context/plans/cycle-3-2026-07-18-plan.md:5,45-48,56-65`; `.context/plans/README.md:34-38`

Git/production own the actual release transition, while the committed plan/index own the recovery frontier. The first pair says Cycle 3 is signed, pushed, and live; the latter still says terminal work is pending. There is no reconciliation step that forces the durable ledger to match the external transition.

Concrete failure: the next cycle must rediscover release state from multiple systems and can repeat deploy work or archive the wrong frontier.

Suggested fix: close and archive the plan with exact commit/live evidence. Longer term, make terminal ledger sync a required final release commit or generate the status from machine-verifiable commit/deploy metadata.

### ARCH-C4-02 — The old layout-aware priority abstraction remains after layout ownership was removed

- Severity: **Low**
- Confidence: **High**
- Status: **Confirmed** structural debt; runtime code is correct
- Regions: `apps/web/src/components/home-client.tsx:26-49,127-145,247-262,344-345`; `apps/web/src/components/masonry-card.tsx:23-33,121-144`

Cycle 3 correctly transferred image-priority ownership away from column-count inference: only the invariant first DOM card receives explicit eager/high policy. However, two separate helpers, two props, ignored column/measurement arguments, and comments still model a wider layout-aware policy. Layout estimation legitimately still needs column count, but scheduling no longer does.

Concrete failure: the obsolete abstraction suggests that priority can safely consume column-count state, reopening the architectural mismatch between scheduling and browser-owned CSS balancing.

Suggested fix: define one explicit `isUniversalPriorityCard(index, itemCount)` policy, derive eager/high from it, and keep viewport/column state solely inside intrinsic-size/layout estimation. Update interface comments and tests to that ownership boundary.

## Revalidated carry-forward architecture risks

### ARCH-C4-R1 — Background DB capacity has non-composable owners

- Severity/Confidence: **High / High**
- Status: confirmed carry-forward
- Regions: `apps/web/src/db/index.ts:21-45`; `apps/web/src/lib/image-queue.ts:120-152`; `apps/web/src/lib/admin-backfill-runner.ts:97-142`; `apps/web/src/lib/background-db-writes.ts`
- Failure/fix: overlapping modules can exhaust foreground reserve; centralize weighted admission or quiesce conflicting workers.

### ARCH-C4-R2 — Single-instance correctness is an operator convention, not enforced architecture

- Severity/Confidence: **High / High** in the security/topology lane
- Status: confirmed carry-forward under current single-instance policy
- Regions: `apps/web/src/lib/single-writer-guard.ts:6-16,218-235`; process-local `rate-limit.ts`, `admin-mutation-barrier.ts`, `image-queue.ts`, and `upload-tracker-state.ts`
- Failure/fix: a second replica splits safety state; fail closed on the lifetime lease or migrate coordinators to shared storage.

### ARCH-C4-R3 — SQL and mutable photo stores have no shared restore generation

- Severity/Confidence: **Medium / High**
- Status: documented carry-forward
- Regions: `apps/web/src/app/[locale]/admin/db-actions.ts:789-1098`; `apps/web/docker-compose.yml:24-32`
- Failure/fix: restoring old rows can reference missing files and orphan newer ones; add paired generation manifests and reconciliation if full-stack rollback becomes a requirement.

## Final architecture sweep

The closing sweep covered request boundaries, runtime/build-time config, all persistence mounts, schema journal/reconcile, every writer against restore barriers/locks, file-lifecycle durability, process-local versus DB-shared coordination, cache invalidation, image/color/HDR delivery, and deploy promotion. No additional new architectural break survived cross-file validation.
