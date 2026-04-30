# Tracer Review — tracer (Cycle 15)

Repository: `/Users/hletrd/flash-shared/gallery`
Date: 2026-04-30

## Summary

- No new critical, high, or medium findings.
- All race conditions and shared-state hazards previously identified remain properly guarded.

## Causal tracing: key flow verification

### Upload + Processing Pipeline
- Upload tracker pre-increment prevents TOCTOU on concurrent uploads from same IP: confirmed.
- Upload processing contract lock serializes uploads with `image_sizes` / `strip_gps_on_upload` changes: confirmed.
- Per-image advisory lock (`gallerykit:image-processing:{jobId}`) prevents duplicate processing across workers: confirmed.
- Queue detects mid-processing deletion via `WHERE processed = false` conditional UPDATE: confirmed.

### DB Restore Flow
- Advisory lock `gallerykit_db_restore` serializes concurrent restore requests: confirmed.
- Restore maintenance flag gates all mutating admin actions: confirmed.
- Queue quiescence before restore prevents processing during DB replacement: confirmed.

### Admin Delete Flow
- Advisory lock `gallerykit_admin_delete` prevents concurrent deletion of the last admin: confirmed.
- Raw SQL with dedicated connection is correct for advisory-lock semantics: confirmed.

### Topic Mutation Flow
- Advisory lock `gallerykit_topic_route_segments` serializes slug/alias uniqueness checks: confirmed.
- Transaction wraps reference updates before PK rename in `updateTopic`: confirmed.

### View Count Buffering
- Atomic Map swap prevents losing increments during flush: confirmed.
- Retry cap (VIEW_COUNT_MAX_RETRIES = 3) prevents infinite re-buffering: confirmed.
- Exponential backoff on flush failures (BASE_FLUSH_INTERVAL_MS to MAX_FLUSH_INTERVAL_MS): confirmed.
- `isFlushing` flag prevents concurrent flush: confirmed.

### Rate Limiting
- All mutating surfaces use pre-increment-then-check pattern: confirmed.
- DB-backed counters provide cross-restart accuracy: confirmed.
- Rollback on infrastructure failure (not user error): confirmed across all surfaces.

## New Findings

None. All critical race conditions and shared-state hazards are properly guarded.

## Carry-forward (unchanged — existing deferred backlog)

- C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit (partially addressed by retry cap).
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion.
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU.
