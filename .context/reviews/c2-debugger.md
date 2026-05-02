# Debugger — Cycle 2 Deep Review

## C2-DB-01 (High/High): `permanentlyFailedIds` stale entries after image deletion cause silent bootstrap exclusion

- **File**: `apps/web/src/app/actions/images.ts:482-483`, `584-588`
- **Issue**: When images are deleted, their IDs are removed from `enqueued` but not from `permanentlyFailedIds`. After a DB restore, the auto-increment counter may reuse those IDs for new images, which would then be silently excluded from bootstrap scanning. The FIFO eviction cap (1000) limits but does not prevent this scenario.
- **Failure scenario**: 1) Image IDs 10-50 fail processing 3 times, added to permanentlyFailedIds. 2) Admin deletes these images. 3) DB restore resets auto-increment. 4) New uploads get IDs 10-50. 5) Bootstrap excludes these new images from processing — they remain unprocessed forever with no error logged.
- **Fix**: Add `queueState.permanentlyFailedIds.delete(id)` in both delete paths.
- **Confidence**: High

## C2-DB-02 (Medium/Medium): `deleteImage` cleanup failures logged but not surfaced to user meaningfully

- **File**: `apps/web/src/app/actions/images.ts:511-516`
- **Issue**: When file cleanup fails after a successful DB deletion, the error is logged with `console.error` and `cleanupFailureCount` is returned, but the UI may not prominently display this. The image is gone from the DB but orphaned files remain on disk. On Docker deployments with limited disk space, accumulated orphaned files could fill the volume.
- **Fix**: Ensure the admin UI displays cleanup failure warnings prominently. Consider adding a periodic orphan cleanup.
- **Confidence**: Medium

## C2-DB-03 (Medium/Medium): `loadMoreImages` throws unhandled on `getImagesLite` error — no client error boundary

- **File**: `apps/web/src/app/actions/public.ts:105-108`
- **Issue**: When `getImagesLite` throws, `loadMoreImages` rolls back the rate limit and re-throws. The client-side component (`load-more.tsx`) may not have an error boundary for server action errors, leaving the UI in a broken state where the "Load More" button becomes non-functional after an error.
- **Failure scenario**: DB connection drops during a gallery scroll. The load-more action throws, client gets an error, button stops working.
- **Fix**: Wrap the client-side `loadMoreImages` call in a try/catch with a toast notification on failure.
- **Confidence**: Medium

## C2-DB-04 (Medium/Medium): `createPhotoShareLink` race with concurrent share creation may leave stale rate-limit counter

- **File**: `apps/web/src/app/actions/sharing.ts:122-174`
- **Issue**: In the retry loop for share key creation, if the 5 retries are exhausted, the rate-limit is rolled back. But if the loop exits due to a non-ER_DUP_ENTRY error (line 168), the rollback happens correctly. However, there's a subtle issue: if the `db.update` succeeds (affectedRows > 0) but then a subsequent DB operation fails, the rate-limit counter was already consumed and is never rolled back. This is actually correct behavior (the share key was created, so the rate-limit charge is valid), but the error path returns `{ error: t('failedToGenerateKey') }` even though the share key was actually created.
- **Fix**: After a successful `db.update` in the retry loop, if a subsequent operation fails, the function should return the successful share key rather than an error. Currently, the only subsequent operation is `revalidateLocalizedPaths` and `logAuditEvent`, which are fire-and-forget. So this scenario is unlikely but worth noting.
- **Confidence**: Low

## C2-DB-05 (Medium/Medium): `processImageFormats` silently succeeds with zero-byte files under race conditions

- **File**: `apps/web/src/lib/image-queue.ts:294-305`
- **Issue**: The queue verifies output files exist and are non-zero before marking processed. However, between the `verifyFile` check and the conditional UPDATE, another process could delete or truncate the file. The verification window is very short, but on a slow filesystem (NAS), the window could be wider.
- **Fix**: This is a very unlikely race condition given the single-writer topology documented in CLAUDE.md. No fix needed unless the deployment model changes.
- **Confidence**: Low

## C2-DB-06 (Medium/High): Admin user creation password length checked before stripControlChars

- **File**: `apps/web/src/app/actions/admin-users.ts`
- **Issue**: If the password length check happens before `stripControlChars` is applied, a password like "password\x00\x00\x00" (12 chars with control chars) would pass the >= 12 check but after stripping would be only 8 characters. The resulting Argon2 hash would be of a shorter password than intended.
- **Fix**: Verify that `stripControlChars` is applied BEFORE the length check. If not, reorder the checks.
- **Confidence**: High

## Summary

- Total findings: 6
- High: 2 (C2-DB-01, C2-DB-06)
- Medium: 3
- Low: 1
