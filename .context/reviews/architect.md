# Cycle 8 - Architect Lane

Date: 2026-07-07
Reviewer: architect
HEAD reviewed: `eca55414677676462ae54a5579d9c35bfdf16d3c`
Mode: read-only architectural/design review except this artifact. I did not implement fixes, commit, push, deploy, stop services, remove source files, or touch the temporary MySQL container named `gallerykit-e2e-mysql-cycle7-47691` on `127.0.0.1:33307`.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then inventoried the repository surface before reviewing individual boundaries.

- Docs and operating contracts: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, `.context/plans/`, `.context/reviews/`, deploy/nginx notes, migration runbook, and prior cycle architect output.
- Application surface: 600 TypeScript/TSX source files under `apps/web/src`, including 80 App Router files and 111 `lib/` files.
- Tests and gates: 346 unit/source-contract tests in `src/__tests__`, 12 Playwright e2e files, lint scripts for admin API auth, action origin, public route rate limits, JS scripts, migration journal, privacy fields, touch targets, and many source-contract tests.
- Data/deploy topology: 30 SQL migrations plus Drizzle journal, `scripts/migrate.js`, `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `nginx/default.conf`, service worker templates, runtime instrumentation, and operational sidecar scripts.
- Architecture areas inspected: app/data/lib boundaries, server actions vs API routes, auth/origin/rate-limit gates, public/admin select contracts, storage abstraction status, upload/image queueing, color/HDR processing, semantic search activation, migration/reconcile behavior, deploy/nginx/cache topology, i18n routing, restore fences, and process-local operational constraints.

Validation performed: static architecture review only. I did not run quality gates because this lane was scoped to read-only inspection plus this report artifact.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 4
- Low: 2

## Findings

### ARCH-C8-01 - Public data-contract guards can be bypassed by aliasing sensitive columns

Severity: Medium
Confidence: High
Status: Risk, confirmed guard-shape gap

Evidence:

- The canonical public field set explicitly omits sensitive keys from `adminSelectFields` and relies on object keys plus a `PrivacySensitiveKeys` union for compile-time protection (`apps/web/src/lib/data.ts:368-407`, `apps/web/src/lib/data.ts:458-475`).
- Public mirrors use the same key-name pattern. `searchEnrichmentSelectFields` selects direct `images` columns, then checks `Extract<keyof typeof searchEnrichmentSelectFields, PrivacySensitiveKeys>` (`apps/web/src/lib/search-enrichment-fields.ts:29-47`).
- Timeline mirrors the public field shape manually and guards only selected object keys (`apps/web/src/lib/data-timeline.ts:35-67`).
- Text search does the same inside `searchImages`: `searchFields` is hand-built, then guarded by `Extract<keyof typeof searchFields, _PrivacySensitiveKeys>` (`apps/web/src/lib/data.ts:1599-1617`).

Failure scenario:

A future public route can accidentally select `gpsLat: images.latitude`, `originalName: images.user_filename`, or another sensitive column under a safe-looking alias. The current type guard inspects the result object key, not the underlying Drizzle column, so the code typechecks and the leak reaches unauthenticated responses despite the privacy guard comments.

Suggested fix:

Move public response selects behind a column-level allowlist rather than key-name deny checks. Prefer deriving public route-specific selects from `publicSelectFields`, or introduce a small helper/type that only accepts approved public schema columns. Add an AST lint/source-contract test that rejects direct use of `images.latitude`, `images.longitude`, `images.filename_original`, `images.user_filename`, and other `PrivacySensitiveKeys` columns in public select modules even when aliased.

### ARCH-C8-02 - Derivative setting changes invalidate app data, but not the dominant static image serving path

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- Existing derivatives under `public/uploads` are served by Next static handling, and `next.config.ts` gives them `Cache-Control: public, max-age=3600, must-revalidate` (`apps/web/next.config.ts:56-73`).
- `serve-upload.ts` includes `IMAGE_PIPELINE_VERSION`, mtime, size, and settings hash in the route-handler ETag, but its own comment says existing static derivatives still require re-encode to change bytes and mtime (`apps/web/src/lib/serve-upload.ts:240-258`).
- `settings-hash.ts` also documents that the hash only helps route-handler fallback and that existing files normally resolve through Next's static server (`apps/web/src/lib/settings-hash.ts:14-19`).
- `updateGallerySettings()` detects byte-impacting changes and returns `requiresBackfill`, but still commits settings and only revalidates the app tree (`apps/web/src/app/actions/settings.ts:168-199`, `apps/web/src/app/actions/settings.ts:224-239`); `revalidateAllAppData()` only calls `revalidatePath('/', 'layout')` (`apps/web/src/lib/revalidation.ts:59-64`).

Failure scenario:

An admin changes `force_srgb_derivatives`, JPEG/AVIF quality, chroma, or `wide_gamut_max_source_pixels`. Pages and metadata can revalidate immediately, but already-uploaded images continue serving old static bytes until a manual re-encode rewrites the files. The UI can show new settings while visitors inspect old derivatives, which is especially confusing for color/HDR correctness work.

Suggested fix:

Choose one image invalidation model and make it enforceable. The strongest fix is to move generated derivatives out of `public/` so all `/uploads/*` traffic goes through the route handler with the settings-aware ETag. A scalable alternative is content-addressed or versioned derivative filenames keyed by pipeline/settings hash. If static serving stays, make byte-impacting setting changes a guided workflow that blocks or clearly queues a backfill before presenting the setting as applied to existing assets.

### ARCH-C8-03 - Semantic embedding storage cannot retain multiple model versions

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- The schema says `model_version` tags the encoder, but `imageEmbeddings.imageId` is the primary key and `modelVersion` is only indexed for scans (`apps/web/src/db/schema.ts:271-300`).
- The physical migration also creates `PRIMARY KEY (image_id)` and a separate `model_version` column (`apps/web/drizzle/0012_image_embeddings.sql:5-11`); migration 0022 only adds `(model_version, updated_at)` for route scans (`apps/web/drizzle/0022_image_embeddings_model_version_idx.sql:1-9`).
- Queue writes upsert on the single image row and overwrite both `embedding` and `modelVersion` (`apps/web/src/lib/image-queue.ts:512-523`).
- The admin action and sidecar backfill use the same overwrite behavior (`apps/web/src/app/actions/embeddings.ts:175-186`, `apps/web/scripts/backfill-clip-embeddings.ts:212-223`).
- Public search routes filter by active `modelVersion`, so rows from the other mode are ignored (`apps/web/src/app/api/search/semantic/route.ts:263-279`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-190`).

Failure scenario:

After production CLIP embeddings are generated, any intentional or accidental switch to stub mode can overwrite production rows with `stub-sha256-v1` rows. Switching back to production then leaves the route with missing production rows until another full production backfill completes. The `model_version` filter prevents mixing stub and production results, but the schema does not preserve both versions for reversible rollout.

Suggested fix:

If mode/version rollback is a supported operator behavior, change the key to `(image_id, model_version)` and update all upserts, scans, and cleanup paths to target a specific version. If only one active version is intended, make that explicit: block stub writes once production is active, surface a destructive-mode warning before any downgrade, and document that changing encoder mode requires a full re-embed.

### ARCH-C8-04 - Single-writer safety is documented but not enforceable

Severity: Medium
Confidence: High
Status: Confirmed operational risk

Evidence:

- `single-writer-guard.ts` states two live web processes sharing one DB break restore fences, upload quota tracking, and rate-limit fast paths, but the guard is "WARN-ONLY" and "cannot enforce single-instance operation" (`apps/web/src/lib/single-writer-guard.ts:6-16`).
- The loud contention path explicitly says startup is continuing (`apps/web/src/lib/single-writer-guard.ts:218-235`).
- Startup runs the guard fire-and-forget and treats initialization failure as non-fatal (`apps/web/src/instrumentation.ts:22-31`).
- Upload quota state is process-global in memory (`apps/web/src/lib/upload-tracker-state.ts:7-20`), queue state is process-global (`apps/web/src/lib/image-queue.ts:373-455`), and semantic rate limits are in-memory maps (`apps/web/src/lib/rate-limit.ts:393-415`).

Failure scenario:

A Docker, systemd, or reverse-proxy misconfiguration starts two `gallerykit-web` instances against the same database. Both continue serving. Upload limits split per process, image queue/bootstrap behavior duplicates work, process-local semantic/OG/share fast-path limiters weaken, and restore/readiness fences depend on which process sees the marker. Operators may miss the log-only warning during an outage.

Suggested fix:

Add an enforceable production option, for example `GALLERYKIT_ENFORCE_SINGLE_WRITER=true`, that makes persistent advisory-lock contention fail readiness or exit before serving traffic. Longer term, move every correctness-relevant process-local state to DB-backed/advisory-lock-backed coordination and leave only best-effort analytics as local buffers.

### ARCH-C8-05 - Shared-group reads still own a view-count write side effect

Severity: Low
Confidence: High
Status: Confirmed design/coupling risk

Evidence:

- `getSharedGroup()` is a data retrieval helper, but it buffers a denormalized view-count increment after loading the group and images (`apps/web/src/lib/data.ts:1322-1407`).
- The same helper is exported through React `cache()` with a warning not to call the cached wrapper with different count semantics in one render path (`apps/web/src/lib/data.ts:1796-1800`).
- The public shared-group page separately records durable analytics after resolving the selected-photo decision (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`).

Failure scenario:

A future metadata, preview, layout, or admin-inspection path calls `getSharedGroupCached()` for read-only data and accidentally increments the denormalized counter. Another caller in the same render tree can then be affected by React-cache argument semantics. The durable analytics owner and denormalized counter owner are split across route and data layers.

Suggested fix:

Make shared-group reads pure. Move denormalized counter buffering into an explicit `recordSharedGroupView` service next to durable analytics, and have the route decide once whether a request counts. Cache only the pure read helper.

### ARCH-C8-06 - The experimental storage abstraction does not yet preserve live pipeline file invariants

Severity: Low
Confidence: Medium
Status: Likely future-integration risk

Evidence:

- The storage singleton and interface both state that production upload, processing, and serving paths still use direct filesystem helpers and that the abstraction is not wired end-to-end (`apps/web/src/lib/storage/index.ts:1-12`, `apps/web/src/lib/storage/types.ts:1-16`).
- The local backend writes buffers directly to the final path with `fs.writeFile` (`apps/web/src/lib/storage/local.ts:98-108`) and copies with `link`/`copyFile` directly to the destination path (`apps/web/src/lib/storage/local.ts:142-156`).
- The live image pipeline uses temp paths plus `rename()` and rollback tracking around final derivative writes (`apps/web/src/lib/process-image.ts:1164-1224`), and the serving/caching docs rely on atomic rename behavior.

Failure scenario:

A future "wire the storage backend" change could replace the live pipeline's atomic write/rollback guarantees with direct final-path writes from `LocalStorageBackend`. During a failed encode, deploy interruption, or backfill replacement, readers could observe partial files or stale/new byte mismatches, breaking the cache and fd-stat assumptions that current serving code is built around.

Suggested fix:

Either keep the abstraction quarantined and label it test/experimental-only, or upgrade the `StorageBackend` contract before integration: atomic replace, temp-file cleanup, symlink-safe open/write behavior, rollback semantics, and explicit parity tests against `process-image.ts` and `serve-upload.ts` invariants.

## Final Sweep

I found no Critical or High architectural findings in this pass. The strongest current risks are medium-severity design boundaries: public privacy guard shape, image-cache invalidation split, semantic embedding version ownership, and enforceability of the single-instance topology.

Areas checked with no new finding: admin API routes are behind `withAdminAuth`; mutating server actions are covered by `requireSameOriginAdmin` linting; Lightroom upload mirrors browser upload settings and GPS/HDR gates; smart-collection topic deletion now blocks referenced topics; migration journal and reconcile scripts have loud drift/DML guards; i18n uses a small explicit locale set (`en`, `ko`) with `localePrefix: 'always'`; color/HDR metadata remains admin-only where delivery bytes do not yet support public HDR claims; semantic production activation is deliberately operator-only with sidecar seed/backfill runbooks.

Residual risk: this was static review. I did not validate live host nginx state, production env values, real CLIP model weights, deployed DB rows, or the temporary MySQL container.
