# Data Integrity & Correctness Review — Cycle 1 (2026-04-19)

**Scope:** Database interactions, transactional consistency, race conditions, edge cases
**Methodology:** Cross-file analysis of all server actions, data layer, and queue processing

---

## FINDINGS

### DI-01: `bigint mode: 'number'` for `original_file_size` can lose precision
**File:** `apps/web/src/db/schema.ts:50`
**Severity:** LOW
**Confidence:** HIGH

```ts
original_file_size: bigint('original_file_size', { mode: 'number' }),
```

MySQL BIGINT can store values up to 2^63-1 (~9.2 EB), but JavaScript `number` loses precision above 2^53 (~9 PB). While individual files won't exceed 200MB (the upload limit), the precision loss could theoretically affect very large values. The display code divides by `1024*1024` and calls `.toFixed(1)`, which produces incorrect results for values that lost precision during the number conversion.

The previous review (C-01) identified this. The practical risk is negligible given the 200MB upload limit, but the type mismatch is a code smell.

**Fix:** Use `{ mode: 'bigint' }` and format as a string for display, or add a validation check at the application boundary.

---

### DI-02: `uploadImages` per-file invocation bypasses intended batch limits
**File:** `apps/web/src/components/upload-dropzone.tsx:86-121`, `apps/web/src/app/actions/images.ts:16-181`
**Severity:** MEDIUM
**Confidence:** HIGH

Same as SEC-01. The client sends one file per `uploadImages` call, so the server's batch-level validations (`files.length > 100`, `totalSize > MAX_TOTAL_UPLOAD_BYTES`) are never triggered for bulk uploads.

**Fix:** See SEC-01.

---

### DI-03: `updateTopic` deletes previous topic image only after successful DB update, but cleanup failure is not logged
**File:** `apps/web/src/app/actions/topics.ts:161-163`
**Severity:** LOW
**Confidence:** MEDIUM

```ts
if (previousImageFilename && imageFilename && previousImageFilename !== imageFilename) {
    await deleteTopicImage(previousImageFilename);
}
```

If `deleteTopicImage` fails (e.g., permission error, disk issue), the old image file remains on disk as an orphan. There's no error handling or logging. The previous review (D-11) identified a similar issue for orphaned topic images on insert failure.

**Fix:** Wrap in try/catch and log the error:
```ts
try { await deleteTopicImage(previousImageFilename); }
catch (e) { console.error('Failed to delete previous topic image:', previousImageFilename, e); }
```

---

### DI-04: `revokePhotoShareLink` returns error for images that were never shared
**File:** `apps/web/src/app/actions/sharing.ts:136-142`
**Severity:** LOW
**Confidence:** HIGH

Same as SEC-03. If the image exists but `share_key` is already null, the UPDATE affects 0 rows (MySQL doesn't count no-op updates), and the function returns `{ error: 'Share link not found' }`. This is misleading — the image exists but simply wasn't shared.

**Fix:** Check `share_key` before the UPDATE and return a more specific message.

---

### DI-05: `createGroupShareLink` doesn't validate image order consistency
**File:** `apps/web/src/app/actions/sharing.ts:97-114`
**Severity:** LOW
**Confidence:** MEDIUM

The `position` for shared group images is derived from the array index: `uniqueImageIds.map((imgId, position) => ({ groupId, imageId: imgId, position }))`. If two concurrent group-creation requests use the same image IDs in different orders, the position values could conflict. However, since each group creation is a separate transaction with a unique group ID, this is not a real data integrity issue.

**Reclassification:** NOT AN ISSUE — each group is independent.

---

### DI-06: `searchImages` returns `combined.slice(0, limit)` but `effectiveLimit` may be larger than `limit`
**File:** `apps/web/src/lib/data.ts:519-564`
**Severity:** LOW
**Confidence:** MEDIUM

`effectiveLimit = Math.min(Math.max(limit, 1), 500)` is used for the DB queries, but the final return uses `combined.slice(0, limit)` which uses the original `limit` parameter. If `limit < effectiveLimit`, the function fetches more rows than needed from the DB, then discards the extras. This is wasteful but not incorrect.

**Fix:** Use `combined.slice(0, limit)` is correct behavior (limit is what the caller asked for). No fix needed — the extra fetch is intentional to allow for deduplication.

**Reclassification:** NOT AN ISSUE — intentional design.

---

## PREVIOUSLY FIXED — Confirmed Resolved

| Previous ID | Description | Fix Commit | Verified |
|-------------|-------------|------------|----------|
| D-01 | SQL conditional comment bypass | 7a8e096 | YES |
| D-02 | Advisory lock with pooled connections | e992dfb | YES |
| D-03 | viewCountBuffer loss on crash | 1d6ac21 | YES — parallel flush + SIGINT handler |
| D-04 | updateTag success on 0 rows | a466cbf | YES |
| D-05 | deleteTopicAlias no error handling | cc5ec10 | YES |
| D-07 | batchUpdateImageTags non-transactional | 53c57d8 | YES |
| D-08 | CSV silent truncation | efe1a0c | YES |
| D-09 | revokePhotoShareLink success on 0 rows | a466cbf | YES |

---

## ISSUE SUMMARY

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| DI-01 | LOW | `db/schema.ts:50` | bigint mode:'number' precision loss | New (prev C-01) |
| DI-02 | MEDIUM | `upload-dropzone.tsx:86` | Per-file upload bypasses batch limits | Same as SEC-01 |
| DI-03 | LOW | `topics.ts:161` | Orphaned topic image on cleanup failure | New |
| DI-04 | LOW | `sharing.ts:136` | Misleading error for unshared image revoke | Same as SEC-03 |
