# Cycle 31 Tracer Review

Scope: current HEAD `f1dd39eb` on `master`. Product code was not edited.

## Inventory

- Traced request and job flows: upload/import to image queue; image queue to processing and semantic embedding; text semantic search; similar-photo search; database restore and maintenance gating; upload serving; OG image generation; client search/load-more interactions.
- Main files traversed: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/lib/db-restore.ts`, `apps/web/src/lib/serve-upload.ts`, and representative client components.

## Findings

### TRC-31-01 - MEDIUM - CLIP limiter wakeup trace allows a new caller to steal a queued waiter's slot

- Location: `apps/web/src/lib/clip-model.ts:53-72`, `apps/web/src/lib/clip-model.ts:117-160`.
- Downstream flows: semantic text search at `apps/web/src/app/api/search/semantic/route.ts:247-260`; semantic image backfill at `apps/web/scripts/backfill-clip-embeddings.ts:179-190`; production image queue embedding.
- Severity: Medium.
- Confidence: High.

Causal trace:

1. A production semantic route or image embedding caller invokes `embedTextReal` or `embedImageReal`.
2. The embedder enters `withInferenceSlot` and increments `activeInferenceCount` after capacity is checked (`clip-model.ts:148-154`).
3. When capacity is full, another caller enters `waitForInferenceSlot` and pushes a waiter into `inferenceWaiters` (`clip-model.ts:117-144`).
4. The running inference completes. The `finally` block decrements `activeInferenceCount` and then resolves one waiter (`clip-model.ts:157-160`).
5. That resolved waiter is only scheduled to continue; it has not reserved capacity.
6. A new caller can run before the waiter continuation, observe `activeInferenceCount` below the cap, and start.
7. The waiter then resumes and starts too, so the process runs more inferences than `CLIP_INFERENCE_CONCURRENCY` allows.

Broken invariant: "no more than `CLIP_INFERENCE_CONCURRENCY` CLIP inference calls are active in one Node process." The current code enforces this only when there is no wakeup interleaving between a release and a resumed waiter.

Failure mode: live text search and background production backfill can unexpectedly overlap ONNX inference beyond the operator's cap. Because semantic search also scans embedding rows after inference (`semantic/route.ts:263-311`), this can stack CPU-heavy work and produce tail-latency spikes under burst load.

Fix: transfer an owned token to a waiter. The release path should either keep `activeInferenceCount` reserved while resolving the next waiter, or resolve with an explicit grant object that prevents fresh callers from observing a free slot before the waiter owns it. Add a forced-interleaving test to capture the trace above.

## Other Traced Flows

- Upload/import to queue: traced queue admission, processing leases, retry paths, delete-mid-processing cleanup, and semantic embedding follow-up. No new trace defect was found outside the shared CLIP limiter.
- Restore and maintenance: traced admin restore actions through maintenance markers, lock acquisition/release, background write suppression, and cleanup. No new causal break was found.
- Public search and similar-photo routes: traced admission, rate limiting, embedding/vector decode, scan caps, and result enrichment. The route-level flow is bounded; the shared inference handoff is the weak point.
- Upload serving and OG generation: traced metadata lookup, ETag behavior, stream abort handling, and fallback paths. No new descriptor or cache-flow issue was found.
- Client UI responsiveness: traced search form state, load-more paging, similar-photo expansion, and histogram rendering. No new stale-state or repeated-work issue met the reporting bar.

## Final Sweep

No critical or high-severity missed issue was found in the final pass. The remaining material risk is the CLIP limiter's non-atomic slot handoff because it breaks a cross-path resource invariant and can surface only under concurrent production traffic.
