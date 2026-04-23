# Tracer Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: tracer
## Scope: Causal tracing of suspicious flows

---

### C6R2-TR01: Storage backend switch flow — state left in limbo on failure (HIGH)

**Trace:**
1. Admin selects "s3" in settings UI
2. `updateGallerySettings()` called with `storage_backend: 's3'`
3. Settings saved to DB successfully (line 57-66)
4. `switchStorageBackend('s3')` called (line 75)
5. Old `LocalStorageBackend.dispose()` called — succeeds
6. New `S3StorageBackend` created with empty credentials (no S3 env vars set)
7. `S3StorageBackend.init()` tries `HeadBucket` — fails with auth error
8. Error propagates up, but `catch` in settings.ts:75 swallows it
9. `updateGallerySettings` returns `{ success: true }` — admin sees green toast
10. Meanwhile, `storage/index.ts` state has `initialized: false` for S3 backend

**Competing hypotheses:**
- H1: The admin will never notice because storage isn't integrated yet → likely true NOW, but not after integration
- H2: The admin might see S3 errors in server logs → true but they'd have to check

**Root cause:** `switchStorageBackend` doesn't validate credentials before switching, and the error is swallowed at the call site.

**Confidence:** HIGH

---

### C6R2-TR02: Gallery config values flow — never reach consumers (HIGH)

**Trace:**
1. Admin changes `image_quality_webp` from 90 to 75 in settings
2. `updateGallerySettings()` saves to `admin_settings` table
3. `getGalleryConfig()` reads it back correctly, returns `imageQualityWebp: 75`
4. `processImageFormats()` is called for a new upload
5. `processImageFormats()` uses hard-coded `webp({ quality: 90 })` at line 369
6. Image is processed at quality 90, not 75

**Root cause:** `processImageFormats` doesn't accept quality parameters and doesn't call `getGalleryConfig()`.

**Confidence:** HIGH

---

### C6R2-TR03: Upload disk check flow — stale for non-local backends (MEDIUM)

**Trace:**
1. Admin switches to S3 backend
2. `uploadImages()` is called
3. `statfs(UPLOAD_DIR_ORIGINAL)` checks local disk (line 91)
4. Local disk has <1GB free → upload rejected
5. But S3 bucket has unlimited capacity — upload should be allowed

**Root cause:** `statfs` always checks local disk regardless of storage backend.

**Confidence:** MEDIUM (latent — will manifest after integration)
