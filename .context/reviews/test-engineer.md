# Test Engineer — Cycle 9

## C9-TE-01 (Medium): No test for `viewCountRetryCount` FIFO hard-cap eviction

**File+line**: `apps/web/src/lib/data.ts:152-160`

The `viewCountRetryCount` hard-cap eviction (`size > MAX_VIEW_COUNT_RETRY_SIZE`) with FIFO eviction has no direct unit test. The existing `data-view-count-flush.test.ts` tests flush and retry re-buffer logic but not the hard-cap eviction of the retry counter itself.

**Confidence**: Medium
**Fix**: Add a test that overflows `viewCountRetryCount` beyond `MAX_VIEW_COUNT_RETRY_SIZE` and verifies oldest entries are evicted.

## C9-TE-02 (Medium): No test for `pruneRetryMaps` FIFO eviction in image-queue

**File+line**: `apps/web/src/lib/image-queue.ts:84-95`

The `pruneRetryMaps` function caps `retryCounts` and `claimRetryCounts` at `MAX_RETRY_MAP_SIZE` with FIFO eviction. There is no direct unit test for this pruning logic.

**Confidence**: Medium
**Fix**: Add a test that overflows the retry maps and verifies FIFO eviction.

## C9-TE-03 (Medium): No explicit test for `buildCursorCondition` cursor boundary cases

**File+line**: `apps/web/src/lib/data.ts:541-558`

While `data-adjacency-source.test.ts` tests `getImage` prev/next conditions, `buildCursorCondition` (used by `getImagesLite` cursor pagination) does not have explicit unit tests for the dated-to-undated and undated-to-dated cursor boundary transitions.

**Confidence**: Medium
**Fix**: Add explicit cursor-condition tests for boundary cases.
