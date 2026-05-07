# Security Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: security-reviewer
## Scope: Full repository, focus on storage abstraction, settings, and new routes

---

### C6R2-S01: Storage backend switch has no credential validation (HIGH)

**File:** `apps/web/src/lib/storage/s3.ts:57-78`, `apps/web/src/app/actions/settings.ts:73-78`

When an admin switches to `s3` or `minio` backend via settings, `switchStorageBackend()` is called. The S3 client is constructed with whatever env vars exist at that moment — but if `S3_ACCESS_KEY_ID` or `S3_SECRET_ACCESS_KEY` are empty strings (the default), the S3 client is created with empty credentials. The `init()` method then tries to `HeadBucket` which will fail, but the error is caught and logged at `console.error` — the backend switch still completes successfully (the `catch` in settings.ts:75 swallows the error).

Result: The storage singleton is now set to an S3 backend that cannot actually read or write. All subsequent uploads would silently fail since the code hasn't been integrated yet, but once it is, uploads would break with cryptic S3 auth errors.

**Fix:** 
1. In `switchStorageBackend`, validate that required env vars are non-empty before creating the backend
2. If init fails, revert to the previous backend instead of leaving the app in a broken state
3. Return an error from `updateGallerySettings` if the backend switch fails

**Confidence:** HIGH

---

### C6R2-S02: `settings-client.tsx` exposes storage backend option without credential verification (MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:289-294`

The amber warning box tells the admin to "configure environment variables" but doesn't verify they are set. An admin could switch to S3/MinIO without ever configuring credentials. There's no pre-flight check, no "Test Connection" button, and no visual indication of whether the current backend is actually functional.

**Fix:** Add a "Test Connection" action that calls a new server action to verify the selected backend can init and perform a read/write test. Show connection status next to the selector.

**Confidence:** MEDIUM

---

### C6R2-S03: `selectFields` compile-time guard can be bypassed with spread (MEDIUM)

**File:** `apps/web/src/lib/data.ts:92-139`

The compile-time privacy guard at lines 131-139 checks that `selectFields` doesn't contain sensitive keys. However, the guard only validates the *current* content of `selectFields`. If a developer adds a sensitive column to a query using spread (`{ ...selectFields, latitude: images.latitude }`), the guard doesn't catch it because `selectFields` itself is unchanged. This is the same finding as C6-F01 — the type-level guard was added but doesn't prevent per-query override.

The queries at lines 416-418 (`getImageByShareKey`) and 475-477 (`getSharedGroup`) both use `{ ...selectFields }` which is safe, but nothing prevents someone from changing it to `{ ...selectFields, latitude: images.latitude }`.

**Fix:** Create a `publicSelectFields` constant (a separate frozen object) and use it explicitly in public queries, with a comment that public queries MUST use `publicSelectFields` not `selectFields`. This makes the intent explicit and easier to enforce in code review.

**Confidence:** MEDIUM (same as C6-F01 but elevated because the compile-time guard doesn't fully solve the problem)

---

### C6R2-S04: `serve-upload.ts` still reads directly from filesystem, bypassing storage abstraction (MEDIUM)

**File:** `apps/web/src/lib/serve-upload.ts:27-98`

When the storage backend is switched to S3, `serve-upload.ts` will continue serving files from local disk. This means:
1. New uploads would go to S3 (once integrated) but old local files would still be served
2. If S3 files need to be served, this route cannot do it
3. The route becomes a mix of local+S3 that is incoherent

This is a sub-aspect of C6R2-F01 but has specific security implications: the `ALLOWED_UPLOAD_DIRS` whitelist currently excludes `original/`, which is correct for local. But if S3 is the backend, all files are served via presigned URLs, making this route irrelevant. If someone adds `original` to `ALLOWED_UPLOAD_DIRS` for S3, it would also expose originals when running locally.

**Fix:** When integrating StorageBackend into serve-upload, ensure the directory whitelist is only applied for the local backend. For S3/MinIO, use `storage.getUrl()` or `storage.createReadStream()`.

**Confidence:** HIGH

---

### Previously Confirmed Security Findings

- All prior HIGH/CRITICAL security findings from previous cycles remain resolved
- C6-F01/C6R2-S03: selectFields privacy — partially addressed with compile-time guard, needs `publicSelectFields`
