# Code Reviewer — Cycle 11

## Method
Deep review of all source files focusing on code quality, logic errors, SOLID violations, and maintainability risks. Examined every file in apps/web/src/lib/, apps/web/src/app/actions/, apps/web/src/components/, apps/web/src/app/[locale]/admin/, and apps/web/src/db/.

## Findings

### C11-CR-01 (Medium / Medium): `uploadImages` does not validate topic exists in DB before inserting images

- **File+line**: `apps/web/src/app/actions/images.ts:230-237`
- **Issue**: The `uploadImages` function validates the topic slug format with `isValidSlug(topic)` but never checks that the topic actually exists in the `topics` table. If an admin deletes a topic while another admin has the upload form open with that topic selected, images will be inserted with a `topic` value that has no corresponding row in the `topics` table. The image will still appear in the gallery under the orphaned topic slug, but topic-level features (label, order, image_filename) will fail silently. The foreign key is not enforced at the DB level (the schema uses `varchar` without a FK constraint on `images.topic`).
- **Fix**: Before the file processing loop, verify the topic exists with a `SELECT 1 FROM topics WHERE slug = ?` query. Return an error if not found.
- **Confidence**: High

### C11-CR-02 (Low / Medium): `pruneRetryMaps` in `image-queue.ts` does not prune `permanentlyFailedIds`

- **File+line**: `apps/web/src/lib/image-queue.ts:89-101`
- **Issue**: `pruneRetryMaps` handles `retryCounts` and `claimRetryCounts` but not `permanentlyFailedIds`. The `permanentlyFailedIds` set has its own cap (`MAX_PERMANENTLY_FAILED_IDS = 1000`) with FIFO eviction in the catch block. However, `pruneRetryMaps` is called from the GC interval (line 508) and the finally block (line 381), but `permanentlyFailedIds` is only pruned at insertion time. If many IDs are added rapidly, the eviction only happens one-at-a-time per insertion.
- **Fix**: Consider adding a `permanentlyFailedIds` size check in `pruneRetryMaps` or the GC interval.
- **Confidence**: Low

### C11-CR-03 (Low / Low): `db-restore.ts` exports `MAX_RESTORE_SIZE_BYTES` derived from `MAX_RESTORE_FILE_BYTES` but the naming is inconsistent

- **File+line**: `apps/web/src/lib/db-restore.ts:1-3`
- **Issue**: `MAX_RESTORE_FILE_BYTES` is imported from `upload-limits` and re-exported as `MAX_RESTORE_SIZE_BYTES`. The two names refer to the same constant. This could confuse future maintainers.
- **Fix**: Either use the same name or add a comment explaining the alias.
- **Confidence**: Low
