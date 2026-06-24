# Architect Review - review-plan-fix cycle 1 / prompt 1

HEAD reviewed: `1d5545cb`

Scope: architectural/design risk review only. I did not modify source code, run deploys, commit, or push. The only write is this review artifact.

## Inventory

Primary documents read:
- `AGENTS.md` from the prompt, including the no-commit/no-deploy override for this review task.
- `CLAUDE.md`, especially architecture, storage, runtime topology, migration, color/HDR pipeline, privacy projection, deployment, and operational sections.

Source areas examined:
- Data/schema/projections: `apps/web/src/db/schema.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`.
- Migrations/deploy coupling: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, recent migrations `0020` through `0023`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`.
- Upload/storage/serving: `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/storage/{index,types,local}.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/next.config.ts`, upload route handlers.
- Image processing/color pipeline: `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/src/lib/gallery-config*.ts`, `apps/web/src/lib/settings-hash.ts`, color UI components.
- Admin/public boundary and server/client boundary: public photo page, `PhotoViewer`, `ColorDetailsSection`, admin LR upload route, admin image actions, privacy tests, client/server boundary tests.

## Findings

### ARCH-01 - Permanent image-processing failures are not durable across process restarts

Severity: High
Confidence: High
Type: Confirmed issue

Evidence:
- `apps/web/src/lib/image-queue.ts:157-160` defines `permanentlyFailedIds` as an in-memory `Set`.
- `apps/web/src/lib/image-queue.ts:174-186` initializes that set empty on process/global state creation.
- `apps/web/src/lib/image-queue.ts:517-550` adds a permanently failed job to the in-memory set and persists `processing_error` / `failed_at` to the database.
- `apps/web/src/lib/image-queue.ts:640-648` excludes only the in-memory `permanentlyFailedIds` from bootstrap scans.
- `apps/web/src/lib/image-queue.ts:652-672` bootstraps every `processed = false` row matching those process-local conditions.
- `apps/web/src/app/actions/images.ts:1118-1128` treats `processed = false AND processing_error IS NOT NULL` as the explicit admin retry surface and clears the error before enqueueing.
- `apps/web/src/__tests__/image-queue-permanent-failure.test.ts:44-53` locks the in-memory `notInArray` behavior but does not lock a durable `processing_error IS NULL` bootstrap predicate.

Why this is a problem:
The database records a terminal failed state, but queue bootstrap does not use it as the source of truth. After a container restart, `permanentlyFailedIds` is empty, so rows already marked with `processing_error` become bootstrap candidates again. The admin retry action is no longer the only path that retries failed rows.

Concrete failure scenario:
A corrupt original or missing source file exceeds `MAX_RETRIES`. The row is shown in the failed-image admin panel with `processing_error`. The host restarts during a deploy or crash recovery. On boot, bootstrap re-enqueues that same row because `processed = false` still matches and the process-local permanent-failure set is empty. A batch of failed rows can repeatedly consume Sharp/libvips workers on every restart, generate noisy logs, and update failure timestamps without an admin choosing retry.

Suggested fix:
Make the database failure state authoritative for bootstrap:
- Add `isNull(images.processing_error)` to the bootstrap pending conditions in `bootstrapImageProcessingQueue`.
- Keep `retryFailedImage` as the only path that clears `processing_error` / `failed_at` and re-enqueues.
- Add a test in `image-queue-bootstrap.test.ts` that asserts the bootstrap query includes the durable failed-state exclusion, not just `notInArray(state.permanentlyFailedIds)`.

### ARCH-02 - Storage backend can place private originals under the public upload root

Severity: High when the storage abstraction is adopted; latent in the current app because the main upload path is not wired through it
Confidence: High
Type: Risk needing manual validation before storage abstraction use

Evidence:
- `apps/web/src/lib/upload-paths.ts:11-22` defines `UPLOAD_ROOT` under `apps/web/public/uploads` by default.
- `apps/web/src/lib/upload-paths.ts:24-40` separately defines legacy public originals under `UPLOAD_ROOT/original` and the intended private original root under `UPLOAD_ORIGINAL_ROOT`.
- `apps/web/src/lib/storage/local.ts:20` creates an `original` directory as a required public-storage subdirectory.
- `apps/web/src/lib/storage/local.ts:40-47` resolves every storage key under `UPLOAD_ROOT`.
- `apps/web/src/lib/storage/local.ts:62-84` writes any normalized key, including `original/...`, under that public root.
- `apps/web/src/lib/storage/local.ts:130-135` only prevents `getUrl('original/...')`; it does not prevent the file write.
- `apps/web/src/lib/serve-upload.ts:137-140` refuses non-`jpeg|webp|avif` directories in the route handler, but `apps/web/next.config.ts:56-67` documents that files under `public/uploads` are served by Next static handling before the route handler for existing files.

Why this is a problem:
The repository has a strong contract that originals are private and may contain sensitive EXIF/GPS data. The live upload path uses `UPLOAD_ORIGINAL_ROOT`, but the local storage abstraction's keyspace contradicts that contract by treating `original/` as a public-root directory. The URL helper refuses to produce an original URL, but URL generation is not the security boundary when the file is already under `public/uploads`.

Concrete failure scenario:
A future refactor or alternate upload path starts using `getStorage().writeStream('original/<file>')` for original retention. The file lands at `apps/web/public/uploads/original/<file>`. A direct request to `/uploads/original/<file>` can be handled by Next's static public-file serving path before the route handler's allowlist gets a chance to return 404. Private originals become web-addressable even though `getUrl()` throws.

Suggested fix:
- Either reject `original/*` writes in `LocalStorageBackend` until original storage is explicitly designed, or map `original/*` to `UPLOAD_ORIGINAL_ROOT` rather than `UPLOAD_ROOT`.
- Stop creating `UPLOAD_ROOT/original` as a required local storage directory.
- Add a route/static-serving regression test that proves `/uploads/original/*` is not served even when a file exists there, or remove that possible on-disk location entirely.

### ARCH-03 - The public photo page enables admin color UI while fetching only the public projection

Severity: Medium
Confidence: High
Type: Confirmed issue

Evidence:
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:142-149` fetches `getImageCached(imageId)` and `isAdmin()` in parallel.
- `apps/web/src/lib/data.ts:954-965` implements `getImage()` with `publicSelectFields` plus `blur_data_url` and `topic_label`.
- `apps/web/src/lib/data.ts:323-355` omits admin-only color/audit fields from `publicSelectFields`, including `color_pipeline_decision`, `transfer_function`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, `bit_depth`, `color_space`, and `icc_profile_name`.
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:276-291` passes `isAdmin={isAdminUser}` into `PhotoViewer`.
- `apps/web/src/components/photo-viewer.tsx:767` passes that flag into `ColorDetailsSection`.
- `apps/web/src/components/color-details-section.tsx:170-212` uses admin-only fields to decide HDR/non-trivial color behavior.
- `apps/web/src/components/color-details-section.tsx:244-266` offers copyable audit metadata from admin-only fields.
- `apps/web/src/components/color-details-section.tsx:375-430` conditionally renders admin-only pipeline, matrix, and EXIF color-space rows.
- `apps/web/src/lib/image-types.ts:23-35` explicitly marks these fields optional because public page consumers may not have them.

Why this is a problem:
The UI receives an admin authorization flag without the admin data it needs to honor that mode. This is not a privacy leak, because the public projection is doing its job. It is a server/data boundary mismatch: admin-only UI branches render against a public-shaped image record.

Concrete failure scenario:
An authenticated photographer opens `/p/123` after uploading a Display P3 or HDR image to audit the color pipeline. `isAdmin` is true, but `transfer_function`, `icc_profile_name`, `color_pipeline_decision`, `matrix_coefficients`, `is_hdr`, `has_gain_map`, and `bit_depth` are absent. The Color Details accordion can fail to auto-open for HDR, the audit rows disappear, and "copy color metadata" emits mostly `null` values even though the database contains the data. That undermines the documented photographer-facing color/HDR contract.

Suggested fix:
- Split the accessor: keep `getImageCached` public, and add an authenticated viewer accessor or admin-only side fragment that includes the audit fields after `isAdmin()` is known.
- Keep SEO/JSON-LD generation on an explicit public-safe shape so adding admin fields for the viewer cannot accidentally flow into public metadata.
- Add a focused test that renders or inspects the authenticated `/p/[id]` data path and proves admin color fields are present only for admins.

### ARCH-04 - Sidecar color backfill does not share the per-image processing lock

Severity: Medium
Confidence: High
Type: Risk needing manual validation

Evidence:
- `apps/web/scripts/backfill-color-pipeline.ts:36-43` documents the known gap: the sidecar script does not claim the per-image `gallerykit:image-processing:{id}` lock and operators must not trigger admin retry while it runs.
- `apps/web/scripts/backfill-color-pipeline.ts:192-265` re-encodes and re-detects a row without acquiring the per-image lock.
- `apps/web/scripts/backfill-color-pipeline.ts:397-460` batches database updates after encode/detect work, so the DB update window is decoupled from the row processing window.
- `apps/web/src/lib/admin-backfill-runner.ts:335-343` explains the exact race this lock is meant to prevent.
- `apps/web/src/lib/admin-backfill-runner.ts:469-613` holds the per-image claim across re-encode, detection, and DB update in the in-app runner.

Why this is a problem:
The sidecar and in-app runner serialize with the global color-backfill lock, but the live failed-image retry path uses the image-processing queue, not the global backfill lock. The in-app runner has a per-image claim to avoid racing that path; the sidecar does not. This leaves a manual operational rule as the only protection for a cross-process write race on derivative filenames and color metadata.

Concrete failure scenario:
The sidecar starts re-encoding row 123 with one settings snapshot and writes derivative files. While its DB update is still queued in `flushBatch`, an admin clicks retry for that image, causing the live queue worker to acquire the per-image processing lock and re-encode the same filenames. Depending on timing, the final files can come from one process while `pipeline_version`, `color_pipeline_decision`, `was_downscaled`, or `avif_10bit` come from the other. A deleted-mid-reencode path is handled, but live retry interleaving is still manual.

Suggested fix:
- Restructure the sidecar to reuse the same per-image advisory lock window as `admin-backfill-runner.ts`, holding it through encode, detection, and the row update.
- If batching must remain, batch only work that does not affect the per-image correctness contract, or flush each row while its per-image lock is held.
- As a shorter-term guard, block/disable failed-image retry while the sidecar global backfill lock is held, and expose that state in the admin UI or retry action.

## Missed-issues sweep

I re-scanned these risk areas after the findings above:
- Migration/journal coupling: `apps/web/scripts/migrate.js:145-151`, `267-401`, `582-594`, `637-710`, and `719-730` cover journal loading, legacy reconciliation, `image_embeddings`, non-monotonic journal baselining, and post-condition assertions. I did not find a new migration coupling defect.
- Privacy projections: `apps/web/src/lib/data.ts:316-430`, `apps/web/src/lib/data-timeline.ts:14-72`, and `apps/web/src/__tests__/privacy-fields.test.ts:3-108` maintain compile-time and fixture guards for public/admin field boundaries. I did not find a public data leak.
- Client/server boundaries: `apps/web/src/__tests__/client-server-only-boundary.test.ts:5-20`, `257-331`, and `371-474` scan `'use client'` import graphs for native/server-only imports. I did not find a confirmed client bundle boundary defect in the reviewed paths.
- Single-instance assumptions: process-local state exists in `apps/web/src/lib/data.ts:17-197`, `apps/web/src/lib/image-queue.ts:150-190`, and `apps/web/src/lib/admin-backfill-runner.ts:144-250`; the deployed topology is a single web service in `apps/web/docker-compose.yml:1-26`. This matches the documented single-instance contract, so I am not filing it as a defect, but scale-out would require redesigning these process-local queues, buffers, and status maps.
- Image/color pipeline contracts: I traced upload processing, queue processing, in-app backfill, sidecar backfill, serving cache headers, settings hash, and color UI consumers. The two reportable issues from that pass are ARCH-03 and ARCH-04.

## Residual risks

- The app remains intentionally single-instance. Before adding a second web process, move queue ownership, view-count flushing, admin backfill status, rate-limit/quota maps, and restore/upload maintenance state out of per-process memory or protect them with durable coordination.
- The storage abstraction is local-only and not wired through the main upload path. Treat it as unsafe for original-object retention until ARCH-02 is fixed.
- The sidecar color backfill has a documented manual concurrency rule. Treat it as an operational hazard until ARCH-04 is fixed.

No tests were run; this was a read-only architecture review plus this review artifact.
