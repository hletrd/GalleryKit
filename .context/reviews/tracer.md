# Tracer — Cycle 1 Fresh Review (2026-04-27)

## Causal Traces

### Trace 1: Upload → Process → Serve (happy path)

1. `uploadImages()` receives `FormData` with files + topic + tags
2. `requireSameOriginAdmin()` — origin check passes
3. `acquireUploadProcessingContractLock()` — MySQL advisory lock acquired
4. `getUploadTracker()` — pre-increment count/bytes
5. `saveOriginalAndGetMetadata(file)` — stream to disk, Sharp metadata, EXIF, blur, ICC
6. `extractExifForDb(data.exifData)` — GPS stripping if configured
7. `db.insert(images).values(insertValues)` — row inserted with `processed: false`
8. `ensureTagRecord()` + `db.insert(imageTags).ignore()` — tags attached
9. `enqueueImageProcessing(job)` — PQueue job added
10. `processImageFormats()` — Sharp generates AVIF/WebP/JPEG in parallel
11. `db.update(images).set({ processed: true })` — conditional on `processed = false`
12. `serveUploadFile()` — serves from `public/uploads/{jpeg,webp,avif}/`

**Verdict:** Happy path is well-guarded. Advisory locks prevent concurrent config changes. Conditional UPDATE prevents double-processing. File cleanup on delete-while-processing is handled.

---

### Trace 2: Login → Session → Authenticated Request

1. `login()` receives username + password + locale
2. `hasTrustedSameOrigin()` — origin check (CSRF)
3. `pruneLoginRateLimit()` — prune stale entries
4. Pre-increment rate limit (IP + account-scoped)
5. DB-backed rate limit check with rollback on exceed
6. `argon2.verify()` — constant-time password check (dummy hash for non-existent users)
7. `db.transaction()` — insert new session, delete old sessions (prevents session fixation)
8. `cookieStore.set()` — httpOnly, secure (in production), sameSite: lax, 24h maxAge
9. `redirect()` — Next.js redirect to dashboard
10. Subsequent request: `verifySessionToken()` — HMAC verification + timing-safe comparison + DB session lookup
11. `isAdmin()` / `getCurrentUser()` — cached via React `cache()`

**Verdict:** Auth flow is solid. Timing-safe comparison prevents timing attacks. Dummy hash prevents user enumeration. Rate limiting is pre-increment to prevent TOCTOU. Session fixation is prevented by deleting old sessions on login.

---

### Trace 3: Public photo page → potential PII leak

1. `GET /[locale]/p/[id]` — public route
2. `getImage(id)` — uses `publicSelectFields` (omits lat/lon/filename_original/user_filename/processed/original_format/original_file_size)
3. Compile-time privacy guard ensures sensitive keys are not in `publicSelectFields`
4. `blur_data_url` fetched only in individual query (not listing)
5. Photo viewer renders image with `isSafeBlurDataUrl()` before CSS injection

**Verdict:** Privacy is well-enforced. Multiple layers of protection: compile-time guard, separate field sets, reader-side validation.

---

### Trace 4: DB Restore → potential SQL injection

1. `restoreDatabase()` receives file upload
2. File size checked (< 250 MB)
3. Header validated (`hasPlausibleSqlDumpHeader`)
4. `sql-restore-scan.ts` scans for dangerous statements
5. MySQL advisory lock acquired (`gallerykit_db_restore`)
6. `mysql` CLI reads from stdin with `--one-database` flag
7. Post-restore: queue quiesced, then resumed

**Verdict:** Restore flow has multiple safety layers. Advisory lock prevents concurrent restores. Header validation and SQL scanning prevent obvious injection. `--one-database` flag limits scope.

---

## Findings

### C1-TR-01: Upload tracker pre-increment is not rolled back on all error paths
**File:** `apps/web/src/app/actions/images.ts:242-243`
**Severity:** Low | **Confidence:** Medium

```ts
tracker.bytes += totalSize;
tracker.count += files.length;
```

The pre-increment at line 242-243 claims bytes/count before processing. The `settleUploadTrackerClaim()` at lines 405 and 410 adjusts the tracker after processing. However, if an error occurs between the pre-increment and the settlement (e.g., an unhandled exception in the file loop), the claim is not settled. The `finally` block at line 429 only releases the upload contract lock, not the tracker claim.

On closer inspection, the `for (const file of files)` loop at line 251 has its own try/catch, so individual file failures are handled. The overall function doesn't have a try/catch around the entire upload section (lines 178-429), only the `try/finally` for the contract lock. If an unexpected error occurs outside the per-file try/catch (e.g., in the disk space check at line 208 or the topic validation at line 234), the pre-incremented tracker is not rolled back.

**Fix:** Add error handling for the section between the tracker pre-increment (line 242) and the settlement calls (lines 405/410), or move the pre-increment closer to the file processing loop.

---

### C1-TR-02: `getImage()` prev/next navigation query is complex and potentially slow for large galleries
**File:** `apps/web/src/lib/data.ts:514-583`
**Severity:** Low | **Confidence:** Medium

The prev/next queries use a complex `OR` condition with 3 branches each (capture_date comparison, capture_date + created_at tiebreaker, capture_date + created_at + id tiebreaker). These are 2 extra DB queries per image view (3 total including tags). The `Promise.all` parallelization helps, but the queries themselves are not index-optimal because the `OR` conditions may not fully utilize the composite index `(processed, capture_date, created_at)`.

**Fix:** For personal-gallery scale, this is acceptable. If the gallery grows, consider using a cursor-based approach or caching the prev/next IDs.
