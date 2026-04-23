# Architect Review — Cycle 9 (R2)

## ARCH-9R2-01: Storage abstraction is declared but not integrated — dead code in production [MEDIUM] [HIGH confidence]

- **Files:** `apps/web/src/lib/storage/` (index.ts, local.ts, minio.ts, s3.ts, types.ts), `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- **Description:** The storage backend abstraction is fully implemented with admin UI to switch backends, but the actual image processing pipeline (`process-image.ts`) and file serving (`serve-upload.ts`) still use direct `fs` operations. The index.ts file itself notes: "The storage backend is not yet integrated into the image processing pipeline." This means:
  1. An admin can switch the storage backend to MinIO/S3 in the settings UI, the switch succeeds (the singleton updates), but no files are actually written to or read from S3/MinIO.
  2. The setting change is misleading — it appears to work but has zero effect.
  3. The entire `storage/` directory is dead code in production.
- **Fix:** Either (a) integrate the storage backend into process-image.ts and serve-upload.ts, or (b) disable the MinIO/S3 options in the settings UI with a "Coming Soon" badge, or (c) add a clear disclaimer in the UI that storage backend switching is not yet functional.

## ARCH-9R2-02: Configurable settings that have no runtime effect create user confusion [LOW] [HIGH confidence]

- **Files:** `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`
- **Description:** The settings UI exposes `image_quality_webp/avif/jpeg`, `image_sizes`, and `queue_concurrency` as configurable. But none of these have any runtime effect (see C9R2-02, C9R2-03, C9R2-04). This is an architectural gap: the config layer exists but nothing consumes it. The admin changes values, clicks Save, sees "Settings saved" — but nothing actually changes.
- **Fix:** Either wire these settings into the runtime code or remove them from the UI and mark them as "planned" in the settings page.

## ARCH-9R2-03: Duplicated `ensureDirs` singleton pattern in local.ts and process-image.ts [LOW] [LOW confidence]

- **Files:** `apps/web/src/lib/storage/local.ts` lines 34-44, `apps/web/src/lib/process-image.ts` lines 44-58
- **Description:** Both files implement the same singleton-promise pattern for ensuring directories exist. The `LocalStorageBackend.init()` and `ensureDirs()` in process-image.ts do the same thing. If the storage backend were integrated, `ensureDirs()` in process-image.ts should delegate to the storage backend.
- **Fix:** Not urgent, but when storage integration happens, consolidate to a single entry point.
