# Security Review — Cycle 1 (2026-04-19)

**Scope:** Full repository security audit
**Methodology:** File-by-file inspection of auth, session, rate-limiting, SQL injection, file upload, and access control paths
**Previous findings status:** All previously identified security issues (D-01, A-01 through A-10, C-07, C-08, R-03) have been fixed in commits 7a8e096 through 6567a21.

---

## NEW FINDINGS

### SEC-01: `uploadImages` sends each file as a separate server action invocation, bypassing the 100-file batch limit
**File:** `apps/web/src/components/upload-dropzone.tsx:86-121`
**Severity:** MEDIUM
**Confidence:** HIGH

The client-side `handleUpload` processes files with `UPLOAD_CONCURRENCY=3` parallel workers, but each worker calls `uploadImages(formData)` with a **single file** per FormData. The server action validates `files.length > 100` but since each call has exactly 1 file, the limit is never triggered. A malicious user could upload thousands of files by keeping the upload loop running.

The server does have a `MAX_TOTAL_UPLOAD_BYTES` check per invocation, but with single-file invocations, only the per-file 200MB limit applies. The intended 10GB total batch limit is never enforced because it checks `totalSize` of the files in a single FormData.

**Concrete scenario:** A user uploads 500 files of 150MB each (well under 200MB per file). Each succeeds individually. Total server storage consumed: ~75GB without hitting any batch limit.

**Fix:** Either (a) move the batch processing to a single `uploadImages` call with all files in one FormData, or (b) add a server-side session-level upload quota that tracks cumulative upload bytes per admin session.

---

### SEC-02: `dumpDatabase` backup files are served via URL with only filename as auth — predictable filename pattern
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:84-131`, `apps/web/src/app/api/admin/db/download/route.ts`
**Severity:** LOW
**Confidence:** MEDIUM

The backup filename follows the pattern `backup-YYYY-MM-DDTHH-MM-SS-mmm.sql`. While the download route requires admin authentication, the filename pattern is predictable. If the download route's auth check were ever bypassed (e.g., middleware misconfiguration), an attacker could enumerate backups by guessing timestamps.

The current auth guard on the download route mitigates this, but defense-in-depth would benefit from adding a random component (e.g., UUID) to backup filenames.

**Fix:** Append a short random suffix to the backup filename: `backup-${timestamp}-${randomUUID().slice(0,8)}.sql`.

---

### SEC-03: `revokePhotoShareLink` checks `affectedRows === 0` but the image might have never had a share key
**File:** `apps/web/src/app/actions/sharing.ts:126-146`
**Severity:** LOW
**Confidence:** HIGH

The function first selects the image to verify it exists, then sets `share_key = null`. If the image exists but never had a share key, the UPDATE's `affectedRows` is 0 (MySQL doesn't count rows where the value didn't change). The function returns `{ error: 'Share link not found' }` which is misleading — the image exists but simply wasn't shared.

**Fix:** Check if `image.share_key` is null before the UPDATE, or use a different condition for the error message.

---

### SEC-04: `searchImagesAction` rate-limit increment is not atomic — same TOCTOU as the previously fixed login issue
**File:** `apps/web/src/app/actions/public.ts:55-60`
**Severity:** MEDIUM
**Confidence:** HIGH

The in-memory rate limit check (line 41) and increment (line 57-58) are separated by the DB-backed check (`await checkRateLimit`) which yields the event loop. Concurrent requests from the same IP can pass the in-memory check before any of them increment.

Unlike the login path (which was fixed in commit 1036d7b to increment before the expensive operation), the search path still checks first and increments after.

**Fix:** Move the in-memory increment before the DB-backed check, similar to the login flow fix.

---

### SEC-05: `topicRouteSegmentExists` is vulnerable to TOCTOU race — two concurrent alias creations for the same segment can both pass the check
**File:** `apps/web/src/app/actions/topics.ts:12-29, 228`
**Severity:** LOW
**Confidence:** MEDIUM

`createTopicAlias` calls `topicRouteSegmentExists(alias)` then inserts. Two concurrent requests for the same alias both pass the check. The `catch (ER_DUP_ENTRY)` handler at line 242 mitigates this (returns an error), so the data integrity is maintained. However, the error message says "Alias already conflicts with an existing topic or alias" which is the correct behavior.

**Assessment:** Already handled correctly via catch-on-duplicate pattern. Not a real issue.

**Reclassification:** NOT AN ISSUE — the ER_DUP_ENTRY catch makes this safe.

---

## PREVIOUSLY FIXED — Confirmed Resolved

| Previous ID | Description | Fix Commit | Verified |
|-------------|-------------|------------|----------|
| D-01 | SQL restore conditional comment bypass | 7a8e096 | YES — `stripSqlCommentsAndLiterals` now extracts `/*!ddddd */` inner content before stripping |
| A-01 | Rate limit TOCTOU on login | 1036d7b | YES — increment before Argon2 verify, rollback on success |
| A-02 | Credential-confirming error message | 1036d7b | YES — now returns generic "Authentication failed" |
| A-03 | TRUST_PROXY warning | 6567a21 | YES — warns on X-Forwarded-For without TRUST_PROXY |
| A-04 | No rate limiting on password change | 95f17ce | YES — same rate limit pattern applied |
| A-05 | Audit events fire-and-forget | 95f17ce | YES — critical events now awaited |
| A-07 | parseInt partial numeric IDs | 8b96b63 | YES — regex validation before parseInt |
| A-09 | HTML chars in topic aliases | 22ad3c5 | YES — `isValidTopicAlias` rejects `<>"'&` |
| A-10 | HTML chars in tag names | 22ad3c5 | YES — `isValidTagName` rejects `<>"'&` |
| C-07 | OG image rate limiting | (deferred) | N/A — documented as architectural decision |
| C-08 | Dead \r in CSV regex | efe1a0c | YES — removed |
| R-03 | Octet-stream fallback | bccabf5 | YES — returns 404 for unknown extensions |

---

## ISSUE SUMMARY

| ID | Severity | File | Description | Status |
|----|----------|------|-------------|--------|
| SEC-01 | MEDIUM | `upload-dropzone.tsx:86` | Per-file upload bypasses batch limits | New |
| SEC-02 | LOW | `db-actions.ts:84` | Predictable backup filenames | New |
| SEC-03 | LOW | `sharing.ts:136` | revokePhotoShareLink misleading error on unshared image | New |
| SEC-04 | MEDIUM | `actions/public.ts:55` | Search rate-limit TOCTOU (same pattern as fixed login issue) | New |
