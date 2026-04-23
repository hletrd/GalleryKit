# Security Review — Cycle 9 (R2)

## SEC-9R2-01: Storage backend switch disposes old backend before verifying new one works [MEDIUM] [HIGH confidence]

- **File:** `apps/web/src/lib/storage/index.ts` lines 132-173
- **Description:** `switchStorageBackend()` disposes the old backend (line 132-136) before initializing the new one. If the new backend fails to init, it rolls back to the old backend object — but that object has already been disposed (connections destroyed). The rollback sets `state.backend = oldBackend`, but the old S3Client has been destroyed via `client.destroy()`. Any subsequent `getStorage()` call will try to use the destroyed client.
- **Fix:** Do NOT dispose the old backend until the new one is confirmed working. Move the dispose call to after the successful init, or create the new backend and init it first, then dispose the old one.

## SEC-9R2-02: `updateSeoSettings` error message includes raw error content [LOW] [MEDIUM confidence]

- **File:** `apps/web/src/app/actions/settings.ts` lines 80-83
- **Description:** When `switchStorageBackend` fails, the error message is: `${t('failedToSwitchStorageBackend')}: ${message}` where `message` comes from `switchErr instanceof Error ? switchErr.message : String(switchErr)`. This leaks internal error details (e.g., S3 endpoint, bucket name) to the admin UI. While admin-only, it's still a disclosure risk if the admin screen is screenshotted or logged.
- **Fix:** Log the full error server-side and return a generic user-facing message without the internal details.

## SEC-9R2-03: `LocalStorageBackend.resolve()` path traversal bypass with trailing separator edge case [LOW] [LOW confidence]

- **File:** `apps/web/src/lib/storage/local.ts` lines 25-31
- **Description:** The path traversal check uses `resolved.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)`. On Windows, `path.sep` is `\`, and `path.resolve` normalizes to backslashes. But the `key` parameter could be crafted with forward slashes that `path.resolve` would normalize. Since this is a server-side gallery (Docker/Linux), this is very low risk. However, the check `resolved !== path.resolve(UPLOAD_ROOT)` allows reading the root directory itself, which is acceptable.
- **Fix:** No action needed for Linux deployments. If Windows support is ever needed, use `path.normalize` consistently.
