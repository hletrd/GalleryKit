# Test Engineer — Cycle 11

## Method
Reviewed all 81 test files in `apps/web/src/__tests__/` and the source files they cover. Analyzed coverage gaps, flaky test risks, and TDD opportunities.

## Findings

### C11-TE-01 (Medium / High): No test for `uploadImages` topic-existence validation

- **File+line**: `apps/web/src/app/actions/images.ts:230-237`
- **Issue**: There is no test verifying that `uploadImages` rejects uploads when the topic slug doesn't exist in the database. The current code only validates format with `isValidSlug()`. If a topic-existence check is added (per C11-CR-01), a test should cover: (1) upload with valid but non-existent topic returns error, (2) upload with valid and existing topic succeeds.
- **Fix**: Add test when C11-CR-01 is implemented.
- **Confidence**: High

### C11-TE-02 (Medium / Medium): `enqueueImageProcessing` does not check `permanentlyFailedIds` before adding a job

- **File+line**: `apps/web/src/lib/image-queue.ts:206-220`
- **Issue**: `enqueueImageProcessing` checks `state.enqueued.has(job.id)` and `state.shuttingDown`, but does NOT check `state.permanentlyFailedIds.has(job.id)`. When a claim-retry timer fires (line 247), it re-enqueues the job without this check. If the image was marked as permanently failed between the claim failure and the retry, the job will be re-enqueued and fail again on the claim-check query (line 254-258). This is handled correctly but wastes a DB query.
- **Fix**: Add `state.permanentlyFailedIds.has(job.id)` check at the top of `enqueueImageProcessing`.
- **Confidence**: Medium
