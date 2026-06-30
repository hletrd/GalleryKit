# Cycle 31 Performance Review

Scope: current HEAD `f1dd39eb` on `master`. Product code was not edited.

## Inventory

- Runtime and processing paths: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/instrumentation.ts`.
- Expensive public/API paths: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/app/api/og/photo/[id]/route.tsx`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/rate-limit.ts`.
- Shared data/concurrency layers: `apps/web/src/lib/data.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`.
- UI responsiveness surfaces: `apps/web/src/components/search.tsx`, `apps/web/src/components/load-more.tsx`, `apps/web/src/components/similar-photos.tsx`, `apps/web/src/components/histogram.tsx`.
- Operational paths: `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, deploy/backfill scripts, and committed tests covering rate limits, privacy fields, touch targets, queue behavior, and semantic search.

## Findings

### MEDIUM - CLIP inference slot handoff can exceed the configured concurrency cap

- Location: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-160`.
- Callers affected: `apps/web/src/app/api/search/semantic/route.ts:247-260`, `apps/web/scripts/backfill-clip-embeddings.ts:179-190`, plus production image embedding calls from the image queue.
- Severity: Medium.
- Confidence: High.

`withInferenceSlot` checks `activeInferenceCount`, awaits `waitForInferenceSlot` when saturated, then increments `activeInferenceCount` after the await. The release path decrements `activeInferenceCount` before resolving the next waiter:

1. `CLIP_INFERENCE_CONCURRENCY=1`.
2. Request A is running, so `activeInferenceCount === 1`.
3. Request B enters `waitForInferenceSlot` and is pushed into `inferenceWaiters`.
4. A finishes; `finally` decrements `activeInferenceCount` to `0` and resolves B.
5. Before B resumes and increments, request C enters `withInferenceSlot`, sees `activeInferenceCount === 0`, skips the queue, and increments to `1`.
6. B resumes from its await and increments to `2`.

The configured limiter is then breached under the exact burst conditions it is meant to absorb. In production semantic mode this can run more ONNX CLIP inference work than configured while `/api/search/semantic` embeds text queries (`semantic/route.ts:247-260`) and operator backfills run `BATCH_CONCURRENCY=2` image embeddings (`backfill-clip-embeddings.ts:79-80`, `backfill-clip-embeddings.ts:179-190`). The practical failure mode is CPU/RSS spikes and longer event-loop stalls during semantic search or backfill windows, even though operators set a low `CLIP_INFERENCE_CONCURRENCY`.

Fix: make slot acquisition atomic. The release path should transfer a reserved slot to the next waiter instead of decrementing to zero before the waiter resumes. One safe shape is a `releaseInferenceSlot` helper that resolves one waiter while keeping the active count reserved for that waiter, and decrements only when no waiter remains. Add a regression test with a deferred running inference, one queued waiter, and a new caller started during the handoff; assert the observed active count never exceeds the configured cap.

## Missed-Issue Sweep

- Image queue and backfill paths already have bounded queue admission, per-image advisory locks, delete-mid-processing cleanup, bootstrap retry, connection budget guards, and restore quiesce checks. No additional high-confidence performance defect was found there beyond the shared CLIP limiter.
- Semantic and similar-photo search have rate limits, hard scan caps, model-version filtering, request-abort checks around expensive work, and production/stub separation. The main performance risk is the shared inference limiter race above.
- Restore and backup paths use maintenance markers, lock checks, bounded waits, temp-file cleanup, and restore guards. No new race was identified in the reviewed restore flow.
- Upload serving and OG generation use ETag/cache controls, bounded metadata paths, abort-aware streaming, and fd cleanup. No new CPU or descriptor leak was found.
- Client search, load-more, similar-photo, and histogram components were checked for obvious runaway rendering, unbounded timers, and repeated expensive work. No new UI responsiveness issue met the reporting bar.
