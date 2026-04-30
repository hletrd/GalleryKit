# Plan -- Cycle 6 Round 3 Fixes

## Status: COMPLETE

## Findings to Address

### F1: C6R3-01 -- Add early-reject for malformed input in destructive operations [MEDIUM] [HIGH confidence]

**Files:**
- `apps/web/src/app/actions/topics.ts` (updateTopic, deleteTopic, deleteTopicAlias)
- `apps/web/src/app/actions/tags.ts` (addTagToImage, removeTagFromImage, batchUpdateImageTags)

**Description:** Multiple server actions apply `stripControlChars()` to their input parameters, but if the sanitized value differs from the original, the function proceeds silently using the sanitized version. For destructive operations, malformed input should be rejected rather than silently sanitized and executed.

**Implementation plan:**

1. **`updateTopic` (topics.ts line 100):** After `const cleanCurrentSlug = stripControlChars(currentSlug) ?? '';`, add: `if (cleanCurrentSlug !== currentSlug) return { error: t('invalidCurrentSlug') };`

2. **`deleteTopic` (topics.ts line 192):** After `const cleanSlug = stripControlChars(slug) ?? '';`, add: `if (cleanSlug !== slug) return { error: t('invalidSlug') };`

3. **`deleteTopicAlias` (topics.ts line 285-291):** After both `cleanTopicSlug` and `cleanAlias` are computed, add: `if (cleanTopicSlug !== topicSlug) return { error: t('invalidTopicSlug') };` and `if (cleanAlias !== alias) return { error: t('invalidAlias') };`

4. **`addTagToImage` (tags.ts line 121):** After `const cleanName = stripControlChars(tagName?.trim() ?? '') ?? '';`, add: `if (cleanName !== (tagName?.trim() ?? '')) return { error: t('invalidTagName') };`

5. **`removeTagFromImage` (tags.ts line 172):** After `const cleanName = stripControlChars(tagName?.trim() ?? '') ?? '';`, add: `if (cleanName !== (tagName?.trim() ?? '')) return { error: t('invalidTagName') };`

6. **`batchUpdateImageTags` (tags.ts lines 313, 344):** After each `const cleanName = stripControlChars(name.trim()) ?? '';`, add: `if (cleanName !== name.trim()) continue;` (skip invalid tag names in batch operations rather than failing the entire batch)

### F2: C6R3-02 -- Add startup cleanup for topic image temp files [LOW] [MEDIUM confidence]

**File:** `apps/web/src/lib/process-topic-image.ts`

**Description:** Topic image temp files (`tmp-*` pattern) in `RESOURCES_DIR` are not cleaned up on process crash. Need a startup cleanup routine similar to `cleanOrphanedTmpFiles()` in `image-queue.ts`.

**Implementation plan:**

1. Add a `cleanOrphanedTopicTempFiles()` function to `process-topic-image.ts`:
   ```typescript
   export async function cleanOrphanedTopicTempFiles(): Promise<void> {
       try {
           const entries = await fs.readdir(RESOURCES_DIR);
           const tmpFiles = entries.filter(f => f.startsWith('tmp-'));
           if (tmpFiles.length > 0) {
               console.info(`[Cleanup] Removing ${tmpFiles.length} orphaned temp files from ${RESOURCES_DIR}`);
               await Promise.all(tmpFiles.map(f => fs.unlink(path.join(RESOURCES_DIR, f)).catch(() => {})));
           }
       } catch {
           // Directory may not exist yet — skip
       }
   }
   ```

2. Call it from `image-queue.ts` in `bootstrapImageProcessingQueue()` (after `cleanOrphanedTmpFiles()`):
   ```typescript
   cleanOrphanedTopicTempFiles().catch(err => console.debug('cleanOrphanedTopicTempFiles failed:', err));
   ```

### F3: C6R3-03 -- Document storage backend non-integration in CLAUDE.md [LOW] [MEDIUM confidence]

**File:** `CLAUDE.md`

**Description:** The storage backend abstraction is not yet integrated into the upload/processing/serving pipeline. This should be documented to prevent confusion.

**Implementation plan:**

1. Add a note to CLAUDE.md under "Key Files & Patterns" or as a new subsection:
   ```
   - **Storage Backend (Not Yet Integrated):** The `@/lib/storage` module provides a `StorageBackend` abstraction (local, MinIO, S3), but it is **not yet integrated** into the upload/processing/serving pipeline. The `storage_backend` admin setting switches the singleton but actual file I/O still uses direct `fs` operations in `process-image.ts` and `serve-upload.ts`.
   ```

2. Optionally add a warning in the settings UI -- but this requires reading the settings-client.tsx to determine the best approach.

## Progress Tracking

- [x] F1: Add early-reject for malformed input in destructive operations
- [x] F2: Add startup cleanup for topic image temp files
- [x] F3: Document storage backend non-integration in CLAUDE.md
- [x] Run gates (eslint, next build, vitest)
- [x] Deploy
