# Critic -- Cycle 6 (Round 3, 2026-04-20)

## Scope
Multi-perspective critique of the whole change surface. Mature codebase with 46+ prior cycles.

## Findings

### C6R3-01: Silent sanitization divergence in destructive operations [MEDIUM] [HIGH confidence]
**Files:** `apps/web/src/app/actions/topics.ts` (updateTopic, deleteTopic, deleteTopicAlias), `apps/web/src/app/actions/tags.ts` (addTagToImage, removeTagFromImage, batchUpdateImageTags)
**Description:** Multiple server actions apply `stripControlChars` to their input parameters, but if the sanitized value differs from the original, the function proceeds silently using the sanitized version. For destructive operations (delete, update, remove), this means a malformed request could operate on a different entity than the caller intended. The defense-in-depth principle for destructive operations should be: reject malformed input rather than silently sanitizing and executing.
This is flagged by multiple reviewers (SR6R3-01, CR6R3-01) indicating cross-reviewer agreement on this concern.
**Fix:** Add an early-reject check: if `stripControlChars(input) !== input`, return an error. This applies to all slug/tag parameters in mutating server actions.

### C6R3-02: Storage backend setting is available in admin UI but not functionally integrated [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/lib/storage/index.ts`
**Description:** The admin settings page allows switching storage backend to MinIO or S3. The `switchStorageBackend` function successfully switches the singleton and even validates credentials. However, the actual file I/O (uploads, processing, serving) bypasses the storage abstraction entirely and uses direct `fs` operations. An admin who switches to S3 would see "success" in the settings UI but uploads would still go to local disk. This is a UX/correctness mismatch. Also flagged by A6R3-01.
**Fix:** Either remove the storage backend option from the admin UI, or add a visible disclaimer that it's not yet active.

### C6R3-03: `processTopicImage` orphaned temp files on crash [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/lib/process-topic-image.ts` line 64
**Description:** Topic image temp files (`tmp-*` pattern) are written to `RESOURCES_DIR` and cleaned up on success/failure. If the process crashes between creation and cleanup, these files persist indefinitely. The main image processing queue has `cleanOrphanedTmpFiles()` for `.tmp` files, but topic image temp files use a different pattern (`tmp-*`) and directory. Also flagged by DB6R3-02 and CR6R3-02.
**Fix:** Add startup cleanup for `tmp-*` files in `RESOURCES_DIR`, or write temp files to `os.tmpdir()`.

## Summary

Three findings with cross-reviewer agreement. The most actionable is C6R3-01 (reject malformed input in destructive operations) and C6R3-03 (topic image temp file cleanup). C6R3-02 (storage backend UI) is a documentation/UX issue.
