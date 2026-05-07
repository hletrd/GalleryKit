# Debugger -- Cycle 6 (Round 3, 2026-04-20)

## Scope
Latent bug surface, failure modes, regressions. Mature codebase with 46+ prior cycles.

## Findings

### DB6R3-01: `flushGroupViewCounts` can lose increments during `isFlushing` gate [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/lib/data.ts` lines 39-77
**Description:** The `isFlushing` guard at line 42 (`if (isFlushing) return`) means that if `flushGroupViewCounts` is called while a flush is already in progress, the call returns immediately without adding the increment to `viewCountBuffer`. This means that concurrent view count increments during a flush are silently dropped, not buffered. The `bufferGroupViewCount` function (called from `getSharedGroup`) adds to the buffer, but if the timer fires while a flush is running, the `flushGroupViewCounts` call from the timer will be a no-op. However, since `bufferGroupViewCount` adds to `viewCountBuffer` (which is separate from the flush's `batch`), the increments aren't actually lost — they'll be flushed in the next timer cycle. The concern is that `viewCountBuffer` is cleared at line 46 (`viewCountBuffer.clear()`) at the start of the flush, so any increments added between lines 46 and the end of the flush would be in the buffer and available for the next flush. This is actually correct — the `isFlushing` guard only prevents concurrent flushes, not concurrent buffering. Reclassifying as LOW.

**Revised assessment:** LOW [HIGH confidence] — The `isFlushing` guard is working as intended. Increments added to `viewCountBuffer` during a flush will be picked up by the next flush cycle. The guard prevents the same batch from being processed twice.

### DB6R3-02: `processTopicImage` temp file not cleaned on process crash [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/lib/process-topic-image.ts` lines 64-83
**Description:** The temp file `tmp-${id}` is written to `RESOURCES_DIR` and deleted on success (line 75) or failure (line 77). However, if the Node.js process crashes (SIGKILL, OOM) between creating the temp file and the cleanup in the catch block, the orphaned `tmp-*` file persists. Unlike the main image processing queue which has `cleanOrphanedTmpFiles()` (in `image-queue.ts` line 21-35) that removes `.tmp` files from `UPLOAD_DIR_WEBP/AVIF/JPEG` on startup, topic image temp files are never cleaned up on restart. Over time, if crashes are frequent, these could accumulate.
**Fix:** Either:
1. Write temp files to `os.tmpdir()` instead of `RESOURCES_DIR` (OS cleans up on restart), or
2. Add a startup cleanup routine similar to `cleanOrphanedTmpFiles()` that scans `RESOURCES_DIR` for `tmp-*` files.

### DB6R3-03: `uploadTracker` adjustment can undercount on concurrent uploads from same IP [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/images.ts` lines 282-297
**Description:** The post-upload tracker adjustment (lines 292-297) uses additive adjustment: `currentTracker.count = Math.max(0, currentTracker.count + (successCount - files.length))`. If two concurrent uploads from the same IP both finish around the same time, both will read the same `currentTracker` state and write back their respective adjustments. Since Map operations are not atomic in JavaScript's event loop (but they are single-threaded), this isn't actually a race condition — Node.js is single-threaded, so the adjustments happen sequentially. The `Math.max(0, ...)` clamp prevents negative drift. This is correct.

**Revised assessment:** Not a bug. The single-threaded nature of Node.js ensures sequential execution of the adjustment code.

## Summary

Only one genuine new finding: DB6R3-02 (topic image temp file cleanup on crash). The codebase is well-hardened with proper error handling, transactional consistency, and race condition protections.
