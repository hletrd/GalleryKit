# Document-Specialist Review — Cycle 9

## Scope and review inventory

I reviewed the repo’s maintained documentation/code surface end-to-end, then cross-checked the claims against source:

- Root docs: `README.md`, `CLAUDE.md`, `.env.deploy.example`
- App docs/examples: `apps/web/README.md`, `apps/web/.env.local.example`, `apps/web/src/site-config.example.json`, `apps/web/src/site-config.json`
- Deployment/config: `package.json`, `apps/web/package.json`, `scripts/deploy-remote.sh`, `apps/web/deploy.sh`, `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/nginx/default.conf`, `apps/web/next.config.ts`, `apps/web/playwright.config.ts`
- Source verification points: `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/[locale]/admin/(protected)/settings/page.tsx`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/storage/index.ts`, `apps/web/src/lib/storage/types.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/instrumentation.ts`, `apps/web/scripts/migrate.js`, `apps/web/scripts/init-db.ts`, `apps/web/src/db/index.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/lib/upload-limits.ts`

I also ran repo-wide searches for storage/backend/settings/env-variable references to make sure I was not sampling.

## Findings

### 1) Storage backend comments describe an admin-controlled feature that does not exist in the current UI or settings model

**Status:** Confirmed  
**Confidence:** High  
**Impact:** HIGH

**Locations**
- `apps/web/src/lib/storage/index.ts:1-18, 112-184`
- `apps/web/src/lib/storage/types.ts:1-12`
- `apps/web/src/lib/gallery-config-shared.ts:8-21`
- `apps/web/src/app/actions/settings.ts:15-29, 36-49`
- `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:22-174`

**What is mismatched**
- `storage/index.ts` says the singleton is based on a `storage_backend` admin setting and that the admin settings page allows switching backends.
- The actual settings model only exposes `image_quality_webp`, `image_quality_avif`, `image_quality_jpeg`, `image_sizes`, and `strip_gps_on_upload`.
- The settings UI only renders image-processing and privacy controls; there is no storage-backend section, no persistence path, and no call site for `switchStorageBackend()`.

**Concrete failure scenario**
- An operator reading the code/comments would expect to switch the app from local filesystem storage to MinIO/S3 through the admin UI.
- In reality, there is no setting to change and no UI to trigger the switch, so uploads continue writing to local disk.
- In a containerized deployment, that can turn into silent data loss when the container filesystem is ephemeral.

**Why this is confirmed**
- The settings whitelist in `gallery-config-shared.ts` has no `storage_backend` key.
- The admin settings page never renders a storage section.
- `switchStorageBackend()` has no callers outside the storage module.

---

### 2) The storage abstraction is documented as the production path, but the upload/serve pipeline still bypasses it with direct filesystem operations

**Status:** Confirmed  
**Confidence:** High  
**Impact:** HIGH

**Locations**
- `apps/web/src/lib/storage/types.ts:1-12, 41-103`
- `apps/web/src/lib/process-image.ts:1-10, 44-59, 207-236`
- `apps/web/src/lib/serve-upload.ts:1-115`
- `apps/web/src/lib/upload-paths.ts:1-86`

**What is mismatched**
- `storage/types.ts` says all gallery storage goes through the interface so backends can be swapped without changing business logic.
- The current production code does not use that abstraction on the hot path:
  - uploads are written directly in `process-image.ts` with `fs`, `pipeline`, and `UPLOAD_DIR_*`
  - public serving is handled directly in `serve-upload.ts` with `lstat()`, `realpath()`, and `createReadStream()`
- `getStorage()` is not used in those paths, so the abstraction is present but not operationally wired.

**Concrete failure scenario**
- A maintainer assumes S3/MinIO support is already plumbed through because the interface and backends exist.
- They change or extend the storage backend code, but uploads and serving still hit local disk.
- Result: the deployment behaves as local-only storage even though the docs/comments imply otherwise.

**Why this is confirmed**
- The upload code writes originals directly to disk in `saveOriginalAndGetMetadata()`.
- The serving route reads from disk directly in `serveUploadFile()`.
- No source outside `apps/web/src/lib/storage/*` calls `getStorage()`, `getStorageSync()`, or `switchStorageBackend()`.

## What I checked and did not find broken

These claims matched the code after verification:
- upload limits in `README.md`, `CLAUDE.md`, and `apps/web/README.md`
- host-network / localhost binding in `apps/web/docker-compose.yml` and `apps/web/deploy.sh`
- reverse-proxy body caps in `apps/web/nginx/default.conf`
- `IMAGE_BASE_URL` / `BASE_URL` handling in `apps/web/next.config.ts`
- `TRUST_PROXY=true` guidance in `.env.local.example` and `apps/web/src/lib/rate-limit.ts`
- `apps/web/scripts/init-db.ts` invoking `migrate.js`, which seeds the admin user
- site-config field names across `README.md`, `apps/web/src/site-config.example.json`, and the rendering code

## Missed-issues sweep

I re-ran a targeted repo-wide sweep for:
- `storage_backend`
- `switchStorageBackend`
- `getStorage(` / `getStorageSync(`
- `S3_` / `MINIO_`
- upload-limit constants and deployment paths

No additional confirmed documentation/code mismatches surfaced outside the dormant storage subsystem.

## Final assessment

- **Confirmed mismatches:** 2
- **Likely mismatches:** 0
- **Manual-validation risks:** 1 latent risk area — the storage subsystem comments should be rewritten or clearly marked experimental until the UI and upload/serve pipeline actually route through it

If you want, the next cleanup pass should focus on either:
1. rewriting the storage comments/docs to match the current local-only behavior, or
2. wiring the storage abstraction end-to-end and then updating the docs to advertise it.
