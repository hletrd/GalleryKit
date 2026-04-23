# Aggregate Review -- Cycle 6 Round 3 (2026-04-20)

## Summary

Cycle 6 round 3 deep review of the full codebase found **3 new actionable issues** (1 MEDIUM, 2 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase continues to be well-hardened after 46+ previous review cycles.

## New Findings (Deduplicated)

### C6R3-01: Silent sanitization divergence in destructive operations [MEDIUM] [HIGH confidence]
**Cross-reviewer agreement:** SR6R3-01, CR6R3-01, V6R3-01, C6R3-01, T6R3-01 (5 reviewers)
**Files:** `apps/web/src/app/actions/topics.ts` (updateTopic line 100, deleteTopic line 192, deleteTopicAlias lines 285-286), `apps/web/src/app/actions/tags.ts` (addTagToImage line 121, removeTagFromImage line 172, batchUpdateImageTags lines 313, 344)
**Description:** Multiple server actions apply `stripControlChars()` to their input parameters (slugs, tag names), but if the sanitized value differs from the original, the function proceeds silently using the sanitized version. For destructive operations (delete, update, remove), this means a malformed request could operate on a different entity than the caller intended. Example: `deleteTopic("my\x00-topic")` strips to `"my-topic"` and deletes that topic — a different entity than named.

While practically no legitimate client would send slugs with control characters (since `isValidSlug` rejects them at creation time, so no DB slug contains control chars), the defense-in-depth principle for destructive operations says: reject malformed input rather than silently sanitizing and executing.

**Fix:** Add an early-reject check in all mutating server actions: if `stripControlChars(input) !== input`, return an error (e.g., `t('invalidSlug')` or `t('invalidTagName')`). This applies to:
- `updateTopic`: `currentSlug` param
- `deleteTopic`: `slug` param
- `deleteTopicAlias`: `topicSlug` and `alias` params
- `addTagToImage`: `tagName` param
- `removeTagFromImage`: `tagName` param
- `batchUpdateImageTags`: individual `name` values in `addTagNames`/`removeTagNames`

### C6R3-02: `processTopicImage` temp files not cleaned on process crash [LOW] [MEDIUM confidence]
**Cross-reviewer agreement:** DB6R3-02, CR6R3-02, C6R3-03, T6R3-02 (4 reviewers)
**File:** `apps/web/src/lib/process-topic-image.ts` line 64
**Description:** Topic image temp files (`tmp-*` pattern) are written to `RESOURCES_DIR` and cleaned up on success/failure. If the Node.js process crashes (SIGKILL, OOM) between creation and cleanup, these files persist indefinitely. The main image processing queue has `cleanOrphanedTmpFiles()` (in `image-queue.ts`) for `.tmp` files in webp/avif/jpeg dirs, but topic image temp files use a different pattern and directory and have no startup cleanup.

**Fix:** Either:
1. Write temp files to `os.tmpdir()` instead of `RESOURCES_DIR` (OS cleans up on restart), or
2. Add a startup cleanup routine (similar to `cleanOrphanedTmpFiles`) that scans `RESOURCES_DIR` for `tmp-*` files and removes them.

### C6R3-03: Storage backend setting available in admin UI but not functionally integrated [LOW] [MEDIUM confidence]
**Cross-reviewer agreement:** A6R3-01, C6R3-02, D6R3-01, P6R3-01 (4 reviewers)
**Files:** `apps/web/src/lib/storage/index.ts`, `apps/web/src/app/actions/settings.ts`, admin settings UI
**Description:** The admin settings page allows switching storage backend to MinIO or S3. The `switchStorageBackend` function successfully switches the singleton and validates credentials. However, the actual file I/O (uploads, processing, serving) bypasses the storage abstraction entirely and uses direct `fs` operations. An admin who switches to S3 would see "success" in the settings UI but uploads would still go to local disk. Additionally, `S3StorageBackend.writeStream` materializes entire files in heap memory, which would cause memory issues if activated for large uploads.

**Fix:** Options:
1. Remove the storage backend option from the admin UI until integration is complete
2. Add a visible disclaimer in the settings UI that storage backend switching is not yet active
3. Document in CLAUDE.md that the storage backend abstraction is not yet integrated

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-46 remain deferred with no change in status.

## Recommended Priority for Implementation

1. C6R3-01 -- Add early-reject for malformed input in destructive operations (MEDIUM, high signal from 5 reviewers)
2. C6R3-02 -- Add startup cleanup for topic image temp files (LOW, moderate signal)
3. C6R3-03 -- Document or disable storage backend setting (LOW, moderate signal)
