# Debugger Review — debugger (Cycle 15)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30

## Summary

- No new critical, high, or medium findings.
- All latent bug surfaces and failure modes previously identified are properly guarded.

## Latent bug surface analysis

### Edge Conditions
- Empty array inputs: All batch operations (`deleteImages`, `createGroupShareLink`, etc.) validate non-empty arrays before proceeding.
- Null values in cursor pagination: `normalizeImageListCursor` returns `null` for invalid cursors, and callers fall back to offset pagination.
- Zero-byte files: `saveOriginalAndGetMetadata` rejects files with `file.size === 0`.
- Missing EXIF: `extractExifForDb` gracefully handles missing/empty EXIF data, returning `null` for all fields.

### Failure Modes
- DB connection drops during flush: View count buffer swaps the Map atomically before draining, so a crash mid-flush doesn't lose unprocessed increments. Failed increments are re-buffered with a retry cap.
- Sharp errors mid-processing: Queue catches processing errors, retries up to 3 times, then gives up. Orphaned variant files are cleaned up when the image is detected as deleted during processing.
- Advisory lock connection drops: `finally` blocks always release connections and locks, even on exceptions.
- Filesystem cleanup failures: `collectImageCleanupFailures` retries once, then reports failures without blocking the main operation. Failed cleanups are logged for operator attention.
- Disk full during upload: `statfs` check requires at least 1GB free before accepting uploads. If the check fails, the upload is rejected with `insufficientDiskSpace`.

### Error Recovery
- Upload tracker pre-increment settlement: `settleUploadTrackerClaim` reconciles claimed vs actual bytes after upload completes or partially fails.
- Rate limit rollback: All rate-limiting surfaces roll back on infrastructure failures (not user errors).
- Queue bootstrap retry: Exponential backoff with 30s delay on connection failures, with cursor-based continuation for large pending sets.

## New Findings

None. All latent bug surfaces and failure modes are properly handled.

## Carry-forward (unchanged — existing deferred backlog)

- C6-V-02: `bootstrapImageProcessingQueue` cursor continuation path untested.
