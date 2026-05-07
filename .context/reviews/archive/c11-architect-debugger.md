# Architect + Debugger — Cycle 11

## Method
Deep review from architectural (coupling, layering, design risks) and debugging (latent bugs, failure modes, regressions) perspectives. Examined all key modules.

## Findings

### C11-AR-01 (Medium / Medium): `image-queue.ts` claim retry re-enqueues without checking `permanentlyFailedIds`

- **File+line**: `apps/web/src/lib/image-queue.ts:246-249`
- **Issue**: When a claim fails (another worker has the advisory lock), the code schedules a retry via `setTimeout(() => enqueueImageProcessing(job), delay)`. The `enqueueImageProcessing` function checks `state.enqueued.has(job.id)` and `state.shuttingDown`, but does NOT check `state.permanentlyFailedIds.has(job.id)`. If the image was marked as permanently failed between the claim failure and the retry timer firing, the retry will add the job, attempt to process it, and fail on the claim-check query. This is handled correctly but wastes a DB query and an advisory lock attempt.
- **Fix**: Add a `state.permanentlyFailedIds.has(job.id)` check at the top of `enqueueImageProcessing` to skip known-failed IDs.
- **Confidence**: Medium

### C11-AR-02 (Low / Low): `data.ts` still 1258 lines — deferred split remains valid

- **File+line**: `apps/web/src/lib/data.ts` (entire file)
- **Issue**: Previously flagged as D3-MED / D2-MED. The file has grown from 1123 to 1258 lines since cycle 1. Merge-conflict risk remains. Deferral is still appropriate.
- **Fix**: Already deferred. Confirming validity.
