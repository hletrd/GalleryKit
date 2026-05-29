# Debugger — Run-2 Cycle 3 (HEAD 420b7852)

Angle: latent bug surface, failure modes, regressions. Focus: image-queue
claim/restart races + backfill third-order effects.

## Findings
NONE net-new actionable.

### Failure-mode traces
1. **Claim-retry no-op risk (image-queue.ts)**: traced the path where `acquireImageProcessingClaim` returns null. `claimRetryScheduled=true` set, return → `finally` runs with `retried=false` → `enqueued.delete(job.id)` executes → retry timer later calls `enqueueImageProcessing(job)`, which passes the `enqueued.has` guard (now cleared) → re-enqueues. `claimRetryCounts` preserved (NOT deleted when `claimRetryScheduled`). VERDICT: correct, no stuck-job regression.
2. **Detection-failure resume invariant**: traced runner + script. Both leave `pipeline_version` behind on detection failure, so candidate selection (`pipeline_version < CURRENT`) re-picks the row on a later run. Both persist `was_downscaled`/`avif_10bit`. VERDICT: cycle-1 AGG-01 + cycle-2 AGG2-01 invariant holds on both paths.
3. **Restore mid-backfill**: `runBackfill` queue jobs check `isRestoreMaintenanceActive()` and abort gracefully (315-318); restore holds the upload-processing-contract lock AND quiesces the image queue. `quiesceImageProcessingQueueForRestore` clears `permanentlyFailedIds`. VERDICT: clean handoff.
4. **DB-config-unavailable during queue processing**: `getGalleryConfig` wrapped in try/catch → Sharp defaults (90/85/90), `forceSrgbDerivatives=false`. VERDICT: degrades safely.
5. **Backfill runner early-throw lock leak**: R29-CRIT-1 moved all state mutation + config read inside the try block; `finally` is single release point for `running` flag + advisory lock + connection. VERDICT: no leak (re-verified, correct).

### Regression check on cycle-2 commits
- `e7a5c52f` (sidecar persists avif_10bit on detection failure): `derivativeBatch` correctly issues a 2-column UPDATE inside the same transaction as `updateBatch`; `pendingUpdates()` sums both for batch-flush trigger. No double-write, no transaction nesting bug.
- `930b7398` (drop dead path import): `import path` gone from runner; build green; no residual reference.

Confidence: High.
