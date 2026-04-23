# Debugger Review — Cycle 9 (R2)

## DBG-9R2-01: `switchStorageBackend` rollback restores a disposed backend — subsequent operations will fail [MEDIUM] [HIGH confidence]

- **File:** `apps/web/src/lib/storage/index.ts` lines 132-173
- **Description:** Same root cause as SEC-9R2-01 but focused on the failure mode. The dispose call on line 132-136 runs BEFORE the new backend initialization. If `getStorage()` on line 163 fails (e.g., S3 bucket creation fails), the catch block on line 165-173 restores `state.backend = oldBackend`. But the old S3Client has been destroyed via `dispose()` which calls `client.destroy()`. Any subsequent call to `getStorage()` will return the destroyed client, causing `ECONNREFUSED` or "client has been destroyed" errors for all future storage operations until the server restarts.
- **Concrete failure scenario:** Admin switches from local to S3. S3 credentials are invalid. Backend creation succeeds but `init()` fails. The local backend's `dispose()` is a no-op (no `dispose` method), so for local→S3 this is actually safe. But for S3→local or MinIO→S3, the old S3/MinIO client is destroyed, and the rollback sets the destroyed client back. Then any future storage call fails.
- **Fix:** Do not dispose the old backend until the new one is confirmed working.

## DBG-9R2-02: `image_sizes` config is read but never used — admin changes have no effect [LOW] [HIGH confidence]

- **File:** `apps/web/src/lib/process-image.ts` line 152, `apps/web/src/lib/gallery-config.ts` line 93
- **Description:** `OUTPUT_SIZES` is a hardcoded constant. `getGalleryConfig().imageSizes` reads the admin setting but is never consumed by any code. The processing pipeline always uses `[640, 1536, 2048, 4096]`. The lightbox, photo-viewer, and home-client also hardcode these sizes in their srcSet attributes. An admin changing this setting gets a success toast but sees zero change.
- **Fix:** Either wire the config into the pipeline or document the limitation clearly in the UI.
