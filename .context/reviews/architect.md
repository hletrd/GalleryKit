# Architect Review - Cycle 7/100

Review target: current `HEAD` only, `17124135999a3d7cb4f5262e8b2b5917503088ae`.

I read `AGENTS.md`, `CLAUDE.md`, and the relevant `.context/` plan/review conventions before inspecting code. Other review lanes have modified their own files in `.context/reviews/`; this report only replaces the architect lane file.

## Inventory Built Before Findings

Review-relevant inventory at current `HEAD`:

- Repo and operating docs: `AGENTS.md`, `CLAUDE.md`, root/package workspace files, deploy policy, migration runbook, semantic-search docs under `docs/superpowers/**`, and current `.context/plans/**` conventions.
- Executable app surface: 75 files under `apps/web/src/app`, including public pages, admin pages, server actions, and API route handlers.
- Data/domain layer: 94 files under `apps/web/src/lib`, plus `apps/web/src/db/schema.ts` and `apps/web/src/db/index.ts`.
- UI/client boundary: 55 component files under `apps/web/src/components`, with focus on state ownership where client components call server actions or consume public selectors.
- Schema/deploy/ops: all `apps/web/drizzle/0000` through `0024` migrations, `drizzle/meta/_journal.json`, `scripts/migrate.js`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `next.config.ts`, and config/typecheck/lint scripts.
- Tests/contracts: relevant `src/__tests__` coverage around migration/reconcile, privacy fields, upload/restore locks, image queue failures, semantic search, Lightroom upload parity, public route rate limiting, action-origin, and client/server boundaries.

I excluded generated `.next/` output, binary fixtures/screenshots, and historical archive plans unless they documented a current invariant. The review was cross-file, not sampled: I used the inventory plus targeted reads across upload -> queue -> DB -> backfill -> public serving, restore/maintenance boundaries, semantic-search indexing, analytics retention, and schema/index alignment. Final missed-issues sweeps used `rg` over auth/origin/rate-limit hooks, process-local state, config fallbacks, migration/reconcile terms, and embedding/processing state.

## Confirmed Issues

### ARCH-C7-01 - Upload write paths use fail-open gallery config defaults for privacy and processing settings

Severity: High
Confidence: High
Status: Confirmed
Area: configuration ownership, privacy boundary, ingest pipeline

Evidence:

- `apps/web/src/lib/gallery-config.ts:103-183` wraps the whole admin-settings read in a broad `try/catch`; on any read failure it logs and returns hardcoded defaults at `apps/web/src/lib/gallery-config.ts:185-212`.
- The default for `strip_gps_on_upload` is `false` at `apps/web/src/lib/gallery-config-shared.ts:91-97`.
- Browser uploads read this fallback-capable config once at `apps/web/src/app/actions/images.ts:175-177`, then only strip persisted GPS when `uploadConfig.stripGpsOnUpload` is true at `apps/web/src/app/actions/images.ts:336-342`.
- Lightroom uploads have the same shape: config is read at `apps/web/src/app/api/admin/lr/upload/route.ts:234-238`, then GPS is stripped only when `config.stripGpsOnUpload` is true at `apps/web/src/app/api/admin/lr/upload/route.ts:326-340`.

Why this is a problem:

`getGalleryConfig()` is reasonable for read/render fallbacks, but it is also the authority for write-time privacy and byte-output decisions. If the `admin_settings` read fails transiently or returns through the fallback path while later upload DB operations succeed, the ingest path silently behaves as a fresh install. For a gallery where the admin explicitly enabled GPS stripping, that means the original file can be retained with GPS metadata because the fallback default is `false`.

Concrete failure scenario:

The operator has `strip_gps_on_upload=true`. During an upload, the settings query times out or fails on a pooled connection, so `getGalleryConfig()` returns defaults. The later topic lookup and image insert use healthy connections and succeed. The code skips `stripGpsFromOriginal(...)`, inserts `latitude`/`longitude` according to the extracted metadata unless separately nulled by the fallback, and retains the original on disk with location metadata. The admin sees a successful upload, not a privacy-setting failure.

Suggested fix:

Split config access by use case. Keep fallback behavior for non-mutating renders, but add a strict ingest/config snapshot reader for upload and processing contract settings. If settings cannot be read, fail the upload with a retryable error. At minimum, make privacy-sensitive fallback fail closed for write paths (`stripGpsOnUpload=true` when the stored setting is unreadable) and add tests for both browser and Lightroom uploads where `getSettingsMap()` throws.

### ARCH-C7-02 - Upload-time processing settings are not durably owned after process restart

Severity: Medium
Confidence: High
Status: Confirmed
Area: queue architecture, config snapshot ownership, processing determinism

Evidence:

- Browser upload reads a `GalleryConfig` snapshot at `apps/web/src/app/actions/images.ts:175-177` and passes processing settings into the in-memory queue job at `apps/web/src/app/actions/images.ts:467-502`.
- Lightroom upload mirrors this in-memory enqueue at `apps/web/src/app/api/admin/lr/upload/route.ts:436-477`.
- The queue explicitly prefers upload-time snapshots so an accepted upload cannot straddle later admin config changes at `apps/web/src/lib/image-queue.ts:385-405`.
- Bootstrap jobs after restart are reconstructed only from image row fields at `apps/web/src/lib/image-queue.ts:744-784`; they do not include the original quality, sizes, chroma, `forceSrgbDerivatives`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`, or `semanticSearchMode` snapshot.
- For bootstrap/legacy jobs, the queue falls back to reading current config at `apps/web/src/lib/image-queue.ts:410-428`.

Why this is a problem:

The architecture says upload-time settings are the owner of processing behavior, but that ownership exists only in process memory. A row inserted with `processed=false` survives restarts; the queue job snapshot does not. After a deploy, crash, or restart, bootstrap reconstructs a weaker job and applies current config, or defaults if config read fails.

Concrete failure scenario:

An admin uploads a batch while `force_srgb_derivatives=false` and custom JPEG/AVIF qualities are active. The DB insert commits, but the process restarts before the queue drains. Before bootstrap processes the pending rows, settings are changed, or `getGalleryConfig()` falls back. Those already accepted images are encoded with different settings than the upload action accepted. The row is then marked `processed=true` and `pipeline_version=7`, so the drift is not obvious from the public surface.

Suggested fix:

Persist processing ownership with the row or a small durable job table. Options: add an `image_processing_jobs` table with the exact settings snapshot, or store a compact `processing_settings_json` / `settings_hash` on `images` while `processed=false`. Bootstrap should rehydrate from that durable snapshot. If no snapshot exists for legacy rows, choose an explicit migration/backfill policy and log it.

### ARCH-C7-03 - Permanently failed image state is split between DB and process memory, so deploys retry failed rows without admin intent

Severity: Medium
Confidence: High
Status: Confirmed
Area: failure-state ownership, queue bootstrap, operational topology

Evidence:

- Permanent suppression is stored in `ProcessingQueueState.permanentlyFailedIds`, an in-memory `Set`, at `apps/web/src/lib/image-queue.ts:163-169` and initialized at `apps/web/src/lib/image-queue.ts:217-222`.
- When max retries are exceeded, the queue adds the id to that Set at `apps/web/src/lib/image-queue.ts:605-613` and persists `processing_error` / `failed_at` to the DB at `apps/web/src/lib/image-queue.ts:626-641`.
- Bootstrap only excludes ids currently in the in-memory Set at `apps/web/src/lib/image-queue.ts:732-740`; it does not exclude rows with persisted `processing_error IS NOT NULL`.
- The admin retry action is built around the persisted failed state: it selects `processed=false AND processing_error IS NOT NULL` at `apps/web/src/app/actions/images.ts:1147-1168`, clears the failure columns at `apps/web/src/app/actions/images.ts:1174-1177`, then removes the id from memory at `apps/web/src/app/actions/images.ts:1179-1185`.

Why this is a problem:

The admin UI treats `processing_error` as the durable "failed until retry" state, but queue bootstrap treats only the process-local Set as authoritative. The Set disappears on process restart, while the DB row remains. This makes failure handling depend on whether the web process has restarted since the failure.

Concrete failure scenario:

A corrupt original exceeds `MAX_RETRIES`, gets `processing_error` persisted, and appears in the failed-images panel. The operator does not click retry. The next deploy restarts the container, recreating an empty `permanentlyFailedIds` Set. Bootstrap sees `processed=false`, re-enqueues the row, and runs the same expensive failing Sharp pipeline three more times. With per-cycle deploys, the same known-failed image can repeatedly consume CPU and log noise without admin intent.

Suggested fix:

Make the DB the source of truth for permanent failure suppression. Bootstrap should exclude `processed=false` rows with `processing_error IS NOT NULL` unless an explicit retry has cleared those columns. Keep `permanentlyFailedIds` only as a per-process fast path, or replace it with a `processing_status` enum / retry-after timestamp. Add a restart/bootstrap test that seeds a failed DB row and asserts it is not re-enqueued until `retryFailedImage()` clears the failure.

### ARCH-C7-04 - View-event retention deletes do not have matching leftmost indexes on two analytics tables

Severity: Medium
Confidence: Medium
Status: Confirmed
Area: schema/index design, retention operations, anonymous-write bounding

Evidence:

- Retention deletes every analytics table with only a `viewed_at < cutoff` predicate at `apps/web/src/lib/view-retention.ts:64-81`.
- `image_views` has indexes beginning with `bot, viewed_at` and `image_id, viewed_at` at `apps/web/src/db/schema.ts:228-232`.
- `topic_views` only has `(topic, viewed_at)` at `apps/web/src/db/schema.ts:241-243`.
- `shared_group_views` only has `(group_id, viewed_at)` at `apps/web/src/db/schema.ts:245-253`.
- The retention module comment says the delete uses the composite indexes for the range scan at `apps/web/src/lib/view-retention.ts:56-59`, but the `topic_views` and `shared_group_views` indexes cannot serve a `viewed_at`-only range as a leftmost prefix.

Why this is a problem:

Retention is the architectural safety valve for anonymous public analytics writes. On `topic_views` and `shared_group_views`, the purge query shape does not match the existing indexes, so as those tables grow the hourly job risks table scans and chunked deletes that still walk large portions of the table. That shifts load onto the same single MySQL writer the retention sweep is supposed to protect.

Concrete failure scenario:

A long-running deployment accumulates hundreds of thousands or millions of topic/share view rows within the retention horizon. When old rows age out, the hourly sweep executes `DELETE ... WHERE viewed_at < cutoff LIMIT 5000` on tables whose only indexes start with `topic` or `group_id`. MySQL cannot seek by `viewed_at` alone through those indexes, so each chunk can scan broadly, contend with live analytics inserts, and stretch the maintenance job beyond its intended low-impact budget.

Suggested fix:

Add explicit `viewed_at`-leading indexes for retention, e.g. `idx_topic_views_viewed_at` and `idx_shared_group_views_viewed_at`, or change purge shape to iterate leftmost keys deliberately. Because this is schema work, add migrations, update `reconcileLegacySchema`, and cover the new indexes in the existing migration/reconcile tests.

## Likely Issues

None beyond the confirmed issues above.

## Risks Needing Manual Validation

- TLS edge, trusted proxy hop count, and single-instance topology remain deployment-sensitive. They are documented in `CLAUDE.md` and were also covered by the security lane as manual-validation risks, so I did not re-file them as new architect findings.
- Semantic embedding gaps after a one-off embedding failure are partly deliberate: `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md:76-80` says missing embeddings are excluded and embedding hooks are fire-and-forget. I did not file that as a defect without a product requirement for automatic embedding repair.

## Missed-Issues Sweep

Final sweep performed:

- Re-checked public/admin selector ownership and `_PrivacySensitiveKeys` coverage.
- Re-checked upload parity between browser and Lightroom ingestion.
- Re-checked queue bootstrap, retry, restore quiesce/resume, side effects, and permanent failure state.
- Re-checked migration journal monotonicity and reconcile/run-migration postconditions.
- Re-checked analytics write and retention topology.
- Re-checked semantic search production/stub model-version separation, backfill entry points, and route gates.
- Re-checked deployment persistence assumptions: bind mounts, host MySQL, one web instance, and Docker prune safety.

No fixes were implemented in this architect lane.
