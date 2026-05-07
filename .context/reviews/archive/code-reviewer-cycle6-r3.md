# Code Reviewer -- Cycle 6 (Round 3, 2026-04-20)

## Scope
Full codebase review focusing on code quality, logic, SOLID, and maintainability. This is a mature codebase with 46+ prior review cycles. Focus on newly introduced issues and previously missed findings.

## Findings

### CR6R3-01: `deleteTopic` audit log uses `cleanSlug` but original `slug` param could differ [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/topics.ts` lines 187-231
**Description:** The `deleteTopic` function sanitizes `slug` into `cleanSlug` at line 192, then uses `cleanSlug` for the DB transaction and revalidation. However, if `slug !== cleanSlug` (i.e., the raw param contained control characters that were stripped), the function proceeds to delete using `cleanSlug` without informing the caller that their input was modified. This is a correctness concern: an admin passing a slug with control characters would see "success" for deleting a different topic than the one they intended (if a slug exists that matches the stripped version but not the original). The same pattern exists in `updateTopic` (line 100) and `deleteTopicAlias` (line 285), where `cleanCurrentSlug`/`cleanTopicSlug`/`cleanAlias` may silently diverge from the caller's intent.
**Fix:** If `slug !== cleanSlug` after sanitization, return an error indicating invalid input. This follows the same defense-in-depth pattern as `isValidSlug` rejecting input — if control characters were present, the input was malformed and should not silently proceed with a modified version.
**Note:** The impact is limited because `isValidSlug` already rejects control characters (the regex only allows `[a-z0-9_-]`), so in practice `cleanSlug` would fail the `isValidSlug` check if any control chars were stripped from a valid-slug-looking input. However, the defense-in-depth argument still applies: the function should not silently modify and proceed.

### CR6R3-02: `processTopicImage` temp file uses predictable naming pattern [LOW] [LOW confidence]
**File:** `apps/web/src/lib/process-topic-image.ts` line 64
**Description:** The temp file is named `tmp-${id}` where `id` is a UUID. This is fine for uniqueness, but the file is created in the same directory as the final output (`RESOURCES_DIR`). If the process crashes between writing the temp file and renaming it to the final output, orphaned `tmp-*` files accumulate. Unlike the main image processing queue which has `cleanOrphanedTmpFiles()` (in `image-queue.ts`), there is no cleanup for topic image temp files on startup.
**Fix:** Either add topic tmp file cleanup to the startup routine, or write temp files to `os.tmpdir()` and move them to `RESOURCES_DIR` after successful processing (matching the db-actions `runRestore` pattern).

### CR6R3-03: `exportImagesCsv` releases `results` by reassignment but `csvLines` holds equivalent data in memory [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 59-81
**Description:** The comment at line 77 says "Release reference to allow GC" and sets `results = []`. However, by that point `csvLines` already holds all the formatted CSV string data derived from `results`, so the memory is still consumed. The GC hint on `results` only helps if the string representation is significantly smaller than the object representation, which depends on the data. The comment is misleading about the memory benefit.
**Fix:** Update the comment to be more accurate: "Release reference to allow GC of the raw DB result objects (field names, type metadata) while the CSV string data remains in memory."

### CR6R3-04: `S3StorageBackend.writeStream` collects entire stream into memory [MEDIUM] [MEDIUM confidence]
**File:** `apps/web/src/lib/storage/s3.ts` lines 95-115
**Description:** `writeStream` collects all chunks from the stream into a buffer before uploading via `PutObjectCommand`. For large files (up to 200MB), this means the entire file content is held in Node.js heap memory. The local backend uses streaming writes, but S3 does not. For a gallery that could handle many concurrent uploads, this could cause memory pressure.
**Fix:** Consider using `@aws-sdk/lib-storage`'s `Upload` class which supports multipart uploads with streaming, or at minimum document this limitation. Since the storage backend is not yet integrated into the upload pipeline (per the NOTE in `storage/index.ts`), this is a future concern but worth documenting.

### CR6R3-05: `getImage` navigation queries for NULL capture_date produce `IS NOT NULL` for "prev" but skip it for "next" [LOW] [HIGH confidence]
**File:** `apps/web/src/lib/data.ts` lines 354-415
**Description:** When `image.capture_date` is NULL, the "prev" query (line 362-363) uses `sql\`${images.capture_date} IS NOT NULL\`` which means "find any image with a non-null capture_date" — all dated images are considered "newer". But the "next" query (line 393-394) uses the same `IS NOT NULL` pattern for capture_date, meaning it would also find any image with a non-null capture_date as "older" — but wait, the "next" query uses `lt()` (less than), so with NULL capture_date, the `lt` branch is `FALSE` (per the comment), and only the `created_at`/`id` tiebreakers apply. This is actually correct behavior per the comments, but the "prev" query's `IS NOT NULL` condition in the first `or` branch is a bit confusing because it means "all images with any capture_date are newer than an image with NULL capture_date" — which is correct for MySQL DESC ordering where NULLs sort last. This is not a bug, just a note that the logic is correct but subtle.

## No New High/Critical Findings

The codebase is well-hardened after 46+ review cycles. The sanitization ordering issues (C46-01, C46-02) from the last cycle have been properly fixed. The stripControlChars pattern is consistently applied across all user-input entry points.
