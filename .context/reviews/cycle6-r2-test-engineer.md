# Test Engineer Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: test-engineer
## Scope: Full repository, focus on test coverage for new features

---

### C6R2-T01: Zero tests for StorageBackend abstraction (HIGH)

**Files:** `apps/web/src/lib/storage/*.ts`

The entire storage abstraction layer (4 files, ~580 lines) has zero test coverage. Key untested paths:

1. **LocalStorageBackend:**
   - Path traversal prevention in `resolve()`
   - `writeStream` with web ReadableStream conversion
   - `copy` fallback from hardlink to copyFile
   - Singleton `dirsPromise` reset on failure

2. **S3StorageBackend:**
   - `init()` bucket creation (HeadBucket -> CreateBucket flow)
   - `stat()` NotFound detection (both `err.name === 'NotFound'` and `httpStatusCode === 404` paths)
   - Stream conversion in `writeStream` and `createReadStream`
   - `getUrl()` with and without `publicUrl` configured

3. **MinIOStorageBackend:**
   - Config fallback from `MINIO_*` to `S3_*` env vars
   - `forcePathStyle: true` always set

4. **`index.ts` (singleton):**
   - `getStorage()` lazy init
   - `switchStorageBackend()` dispose + re-init
   - Concurrent init promise handling

**Fix:** Add unit tests for all backends. Use mocks for S3 client. Test the singleton state machine.

**Confidence:** HIGH

---

### C6R2-T02: Zero tests for settings server actions (MEDIUM)

**Files:** `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/seo.ts`

The gallery settings and SEO settings CRUD operations have no test coverage. Key untested paths:

1. `updateGallerySettings` — key validation, value validation, empty string deletion
2. `updateSeoSettings` — field length validation, URL format validation
3. `switchStorageBackend` integration with settings
4. `isValidSettingValue` in `gallery-config-shared.ts`

**Fix:** Add unit tests for the shared validators (no DB needed) and integration tests for the server actions.

**Confidence:** HIGH

---

### C6R2-T03: No E2E tests for upload-to-processing pipeline (carry-forward from C6-F03) (LOW)

This is a carry-forward finding. The upload pipeline is the most critical user flow but has no E2E coverage.

**Confidence:** HIGH (same as C6-F03)

---

### Previously Confirmed Test Findings

- C6-F03: Missing E2E tests — deferred as per existing policy
