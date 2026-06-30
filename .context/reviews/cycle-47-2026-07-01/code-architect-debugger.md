# Cycle 47 Code / Architect / Debugger Review

## Findings

### C47-IMG-01 - Failed-image retry clear is not conditionally fenced

- Severity: Low
- Confidence: High
- Citations: `apps/web/src/app/actions/images.ts:1224`, `apps/web/src/app/actions/images.ts:1262`, `apps/web/src/app/actions/images.ts:1282`, `apps/web/src/lib/image-queue.ts:578`
- Problem: `retryFailedImage()` selected only failed rows (`processed=false` and `processing_error IS NOT NULL`), but the later clear update matched only by `id`.
- Failure scenario: a concurrent retry or queue success changes the row between the SELECT and UPDATE; the action can still clear/write retry state, enqueue stale work, and return success while the queue skips the job because the row is no longer pending.
- Suggested fix: use the same failed-state predicate for the clear update, treat zero affected rows as `imageNotInFailedState`, and avoid restoring a failed state over a row that is no longer an unprocessed retry candidate.
