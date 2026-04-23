# Debugger Review — Cycle 6 Round 2 (2026-04-19)

## Reviewer: debugger
## Scope: Full repository, focus on latent bugs, failure modes, and regressions

---

### C6R2-D01: `switchStorageBackend` leaves app in broken state on init failure (HIGH)

**File:** `apps/web/src/lib/storage/index.ts:78-119`

When `switchStorageBackend` is called:
1. Line 86-89: Old backend is disposed (catching errors)
2. Line 110-113: State is reset (`initialized: false`, `initPromise: null`)
3. Line 116: `getStorage()` is called which calls `init()` on the new backend

If `init()` fails (e.g., S3 credentials are invalid), the error propagates up. But at this point:
- The old backend has been disposed
- The new backend is stored in `state.backend` but `state.initialized` is `false`
- `state.initPromise` is set to `null` in the catch at line 54

Any subsequent call to `getStorage()` will try to init the same broken backend again (since `initialized` is false and `initPromise` is null). Each call will fail. The app is now in a permanently broken state — uploads will fail, but since the storage layer isn't actually integrated yet, this is latent.

Once integration happens, this becomes a real bug: switching to an invalid S3 config permanently breaks all storage operations until the server restarts.

**Failure scenario:** Admin switches from local to S3. S3 credentials are wrong. `init()` throws. App is now in broken state. Admin switches back to local. But `switchStorageBackend('local')` creates a new `LocalStorageBackend` and calls `getStorage()` which calls `init()` — this succeeds. So the recovery path works, but only if the admin realizes the switch failed and manually switches back.

**Fix:** On init failure, revert to the previous backend:

```
const oldBackend = state.backend;
const oldType = state.type;
try {
    await getStorage();
} catch (err) {
    state.backend = oldBackend;
    state.type = oldType;
    state.initialized = true; // old backend was already initialized
    throw err;
}
```

**Confidence:** HIGH

---

### C6R2-D02: `statfs` in `uploadImages` fails silently on non-local storage (MEDIUM)

**File:** `apps/web/src/app/actions/images.ts:91-98`

`statfs(UPLOAD_DIR_ORIGINAL)` checks disk space before accepting uploads. This is a local-filesystem-only operation. When the storage backend is S3/MinIO (once integrated), `UPLOAD_DIR_ORIGINAL` may not exist locally, and `statfs` will throw. The `catch` block silently ignores this, which means the disk space check is silently skipped for S3 backends.

This is actually correct behavior (S3 doesn't have "disk space") but should be explicitly handled rather than silently caught.

**Fix:** Only run `statfs` when the storage backend is `local`. Import `getStorageBackendType` and conditionally check.

**Confidence:** MEDIUM

---

### C6R2-D03: `processImageFormats` verification reads from local disk regardless of backend (MEDIUM)

**File:** `apps/web/src/lib/process-image.ts:400-413`

After generating images, the verification step uses `fs.stat(path.join(UPLOAD_DIR_WEBP, filenameWebp))` etc. When the storage backend is S3, Sharp writes to local temp paths, and the generated files would need to be uploaded to S3. The verification then checks the local temp paths, which is correct for the processing step, but the uploaded-to-S3 files are not verified.

This is a latent issue that will manifest when the storage integration is done.

**Fix:** After uploading to S3, verify via `storage.stat(key)` that the uploaded objects exist and have non-zero size.

**Confidence:** MEDIUM

---

### Previously Confirmed Findings

- All prior latent bug findings remain resolved or deferred
