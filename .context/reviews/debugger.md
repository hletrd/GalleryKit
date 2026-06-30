# Cycle 31 Debugger Review

Scope: current HEAD `f1dd39eb` on `master`. Product code was not edited.

## Inventory

- Primary runtime suspects: image processing queue, admin backfill runner, CLIP model loading/inference, semantic routes, similar-photo routes, restore/maintenance actions, upload serving, and client search/render loops.
- Files inspected for root cause and failure modes: `apps/web/src/lib/clip-model.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/rate-limit.ts`, and representative UI components.

## Findings

### DBG-31-01 - MEDIUM - Inference waiters do not own the slot they were woken for

- Location: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-160`.
- Affected user paths: production semantic search text embedding at `apps/web/src/app/api/search/semantic/route.ts:247-260`; production semantic backfill image embedding at `apps/web/scripts/backfill-clip-embeddings.ts:179-190`; image-queue production embedding callers.
- Severity: Medium.
- Confidence: High.

Root cause: `waitForInferenceSlot` only waits for a notification; it does not reserve capacity. `withInferenceSlot` increments `activeInferenceCount` after the awaited waiter resumes. The releasing inference decrements `activeInferenceCount` before resolving a waiter (`clip-model.ts:157-160`), creating an observable gap where a fresh caller can take the slot first.

Concrete failure scenario:

1. CLIP production search is enabled and `CLIP_INFERENCE_CONCURRENCY` is left at the default `1` (`clip-model.ts:53-56`).
2. One semantic query or image embedding is active.
3. A second query waits in `inferenceWaiters` (`clip-model.ts:117-144`).
4. The first inference finishes and resolves the waiter after decrementing the active count (`clip-model.ts:157-160`).
5. A third request enters before the waiter continuation runs. It sees available capacity and starts immediately (`clip-model.ts:148-154`).
6. The waiter then resumes and also increments the active count. Two CLIP inferences now run with a cap of one.

Expected symptom: intermittent production-only CPU and memory spikes during semantic search bursts or backfill periods, plus latency that does not match the configured limiter. The bug is timing-sensitive, so it may not appear in steady single-request manual testing.

Fix: treat the limiter as a token handoff rather than a notification queue. On release, either decrement active count only when there is no waiter, or pre-reserve the slot for the waiter before resolving it. The regression test should force the interleaving with deferred promises and verify `maxObservedActive <= CLIP_INFERENCE_CONCURRENCY`.

Competing hypotheses checked:

- "JavaScript is single-threaded, so the counter cannot race." Rejected. The race happens at promise continuation boundaries; a fresh caller can run after the old inference decrements and before the queued waiter resumes.
- "FIFO waiter order prevents slot stealing." Rejected. The fresh caller does not consult `inferenceWaiters`, only `activeInferenceCount`.
- "Backfill concurrency already bounds this." Rejected as a complete mitigation. Backfill has `BATCH_CONCURRENCY=2` (`backfill-clip-embeddings.ts:79-80`), but the shared limiter is the cross-path CPU guard for backfill, live image embeddings, and text queries.
- "Semantic search is disabled by default." Not a root-cause fix. The defect is latent until the documented production semantic mode is enabled.

## Missed-Issue Sweep

- The image queue was checked for duplicate work, delete-mid-processing races, connection starvation, and bootstrap retry failure modes. Existing lock and cleanup logic covered the reviewed scenarios.
- Restore and admin DB actions were checked for lock leaks, maintenance-marker drift, and concurrent writes during restore. Existing durable markers, lock release paths, and timeouts covered the reviewed scenarios.
- Public actions and API rate-limit paths were checked for rollback/refund mistakes around expensive work. No new bug met the reporting threshold.
- Client components were checked for stale async state, unbounded timers, and avoidable heavy render loops. No new debugger finding was identified.
