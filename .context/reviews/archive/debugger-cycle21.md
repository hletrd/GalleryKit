# Debugger Review — Cycle 21

**Reviewer:** debugger
**Date:** 2026-04-19

## Review Scope

Full repository scan focusing on latent bug surface, failure modes, and regressions.

## Findings

### DBG-21-01: `uploadImages` does not clean up partially-saved original file when DB insert fails [MEDIUM] [HIGH confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 135-259
- **Description:** The upload loop saves the original file first (via `saveOriginalAndGetMetadata`), then inserts into the DB. If the DB insert fails (e.g., constraint violation, connection lost), the original file remains on disk but the image record doesn't exist in the DB. The `catch` block at line 255 pushes the filename to `failedFiles` but does NOT delete the orphaned original file. Over time, repeated DB failures could accumulate orphaned files in `public/uploads/original/`.
- **Concrete failure scenario:** DB connection pool is exhausted. Admin uploads 50 files. All originals are saved to disk, but all DB inserts fail. 50 orphaned files remain on disk. No error messages about orphan cleanup.
- **Fix:** In the catch block, after pushing to `failedFiles`, attempt to delete the saved original file:
  ```typescript
  } catch (e) {
      console.error(`Failed to process file ${file.name}:`, e);
      // Clean up saved original if DB insert failed
      if (data?.filenameOriginal) {
          await fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal)).catch(() => {});
      }
      failedFiles.push(file.name);
  }
  ```
  Note: `data` is defined inside the try block, so it may not be accessible in the catch. The cleanup should be placed after the DB insert failure specifically, not in the general catch.

### DBG-21-02: `deleteImage` audit log records event even when transaction deletes 0 rows (concurrent deletion) [LOW] [MEDIUM confidence]
- **File:** `apps/web/src/app/actions/images.ts` lines 343-350
- **Description:** The audit log at line 350 fires after the transaction, but the transaction doesn't check `affectedRows`. If two admins delete the same image concurrently, both transactions could succeed (the second deleting 0 rows), and both would log an audit event. The comment says "avoids false-positive entries when concurrent deletion causes the transaction to delete 0 rows" but the code doesn't actually check — it just logs unconditionally.
- **Concrete failure scenario:** Two admins delete image #42 simultaneously. Transaction 1 deletes the image (1 row). Transaction 2 deletes 0 rows but still logs an audit event. The audit log shows two deletions for image #42.
- **Fix:** Check `affectedRows` from the `images` delete inside the transaction. If 0, don't log the audit event (or log with a different action like "image_delete_noop").

### DBG-21-03: Verified previous cycle fixes — no regressions detected [INFO]
- **Description:** Upload tracker clamping, deleteAdminUser fix, and revokePhotoShareLink fix are all properly implemented and working correctly.

## Summary
- 0 CRITICAL findings
- 1 MEDIUM finding (orphaned original file on DB insert failure)
- 1 LOW finding (duplicate audit log on concurrent deletion)
- 1 INFO finding
