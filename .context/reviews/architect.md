# Cycle 9 - Architect Lane

Date: 2026-07-07
Reviewer: architect
HEAD reviewed: `e2d32e1d360907e5eaca85efdea263a80458d662`
Mode: read-only architecture/design/coupling/layering/system-invariants review except this report artifact. I did not modify application code, deploy, stop services, remove files, change schemas, or touch production data.

## Inventory

I read `AGENTS.md` and `CLAUDE.md` first, then built the review inventory before inspecting boundaries and invariants.

- Operating and design docs: `AGENTS.md`, `CLAUDE.md`, root `README.md`, `apps/web/README.md`, `.context/plans/`, `.context/reviews/`, deploy notes, migration runbook, semantic-search runbooks, color/HDR notes, and prior architect/review aggregates.
- Source surface: 602 TypeScript/TSX files under `apps/web/src`, including 80 App Router files, 111 `src/lib` files, 61 component files, 342 source/unit test files, 10 Playwright e2e files, scripts, Docker/deploy assets, Next config, and lint tooling.
- Data and runtime topology: Drizzle schema, 33 migration/journal files, `scripts/migrate.js`, `docker-compose.yml`, `Dockerfile`, `deploy.sh`, nginx config, instrumentation, restore/readiness fences, sidecar/backfill scripts, upload queues, storage wrappers, semantic search, shared links, auth/origin/rate-limit gates, cache/revalidation, i18n routing, and image processing/serving.
- Final sweep: repository-wide searches for privacy-field selectors, direct filesystem storage, migration drift, process-local state, cache revalidation, TODO/FIXME/HACK/deferred markers, destructive SQL, route/auth boundaries, and docs/code contract mismatches.

Generated and runtime artifacts were not treated as review authority: `node_modules`, `.next`, coverage/build output, uploaded media/resources, local DB/data files, and vendored package code. They were excluded from source inventory except where project scripts or docs explicitly reference their paths.

Validation performed: static architecture review only. I did not run lint/typecheck/tests/build because the requested lane was review-only and no application behavior was changed.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 4
- Low: 3

## Findings

### ARCH-C9-01 - Embedding version ownership is internally inconsistent

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- The schema models `image_embeddings.model_version`, but makes `image_id` the only primary key (`apps/web/src/db/schema.ts:286-300`).
- The physical migration has the same invariant: `PRIMARY KEY (image_id)` with `model_version` as a normal column (`apps/web/drizzle/0012_image_embeddings.sql:5-11`).
- Legacy reconciliation creates the same one-row-per-image table shape (`apps/web/scripts/migrate.js:684-697`).
- All writers overwrite the single row for an image while changing `modelVersion`: admin action (`apps/web/src/app/actions/embeddings.ts:175-186`), upload queue (`apps/web/src/lib/image-queue.ts:512-523`), and sidecar backfill (`apps/web/scripts/backfill-clip-embeddings.ts:212-223`).
- The docs say the opposite. `apps/web/README.md:70-82` says embedding writes store/upsert one row per `(image_id, model_version)`, and `CLAUDE.md:160` says the same.

Why this matters:

The data ownership contract is split between two architectures. The database and writers implement one active embedding per image. The docs and `model_version` query model describe retaining versioned embeddings. That makes future migrations, rollback plans, and operator runbooks unsafe because different maintainers can reasonably assume different invariants.

Concrete failure scenario:

Production CLIP rows exist for `clip-vit-b32-2026-06`. An operator runs the stub backfill in a local/diagnostic mode against the same database, or a rollout temporarily changes the active model key. The upsert overwrites production vectors with `stub-sha256-v1`. Public semantic routes filter by active `modelVersion`, so switching back to production leaves many images missing from semantic search until a full production re-embed finishes.

Suggested fix:

Pick one invariant and encode it everywhere. If model rollback or side-by-side evaluation is supported, migrate to a composite key such as `(image_id, model_version)` and update writers, scans, cleanup, and tests accordingly. If only one active embedding is intended, update docs/runbooks to say version changes are destructive, block stub writes after production activation, and require an explicit destructive re-embed workflow for model downgrades or replacements.

### ARCH-C9-02 - Public privacy guards are key-name based and alias-bypassable

Severity: Medium
Confidence: High
Status: Risk, confirmed guard-shape gap

Evidence:

- `publicSelectFields` is derived by omitting sensitive keys from `adminSelectFields` (`apps/web/src/lib/data.ts:368-407`).
- The compile-time guard checks `Extract<keyof typeof publicSelectFields, PrivacySensitiveKeys>`, which protects result object names, not the underlying Drizzle columns (`apps/web/src/lib/data.ts:472-475`).
- Public side selects repeat the same pattern: `searchEnrichmentSelectFields` checks result keys only (`apps/web/src/lib/search-enrichment-fields.ts:29-47`), timeline fields check result keys only (`apps/web/src/lib/data-timeline.ts:35-67`), and `searchImages` builds a hand-maintained `searchFields` object guarded by selected object keys (`apps/web/src/lib/data.ts:1599-1617`).
- The privacy test fixture asserts sensitive key names and public result keys (`apps/web/src/__tests__/privacy-fields.test.ts:19-57`, `apps/web/src/__tests__/privacy-fields.test.ts:103-160`), but it does not inspect selected source columns for aliases.

Why this matters:

The project has a strong public/admin data boundary, especially around original filenames, GPS, dimensions, capture metadata, moderation state, and admin-only fields. That boundary currently depends on developers not selecting sensitive columns under harmless public names.

Concrete failure scenario:

A future public search or share-page optimization adds `gpsLat: images.latitude`, `originalName: images.userFilename`, or `cameraRaw: images.filenameOriginal` to avoid another query. The key-name guard passes because `gpsLat`, `originalName`, or `cameraRaw` are not in `PrivacySensitiveKeys`, and the field can leak through unauthenticated JSON or page props.

Suggested fix:

Move public selects to a column-level allowlist. Prefer helper builders that only expose approved public image columns, and make route-specific public selects derive from those helpers. Add a source-contract test or AST lint that rejects direct references to sensitive `images` columns in public modules even when they are aliased.

### ARCH-C9-03 - Byte-impacting settings commit before static derivatives are invalidated

Severity: Medium
Confidence: High
Status: Confirmed

Evidence:

- Existing derivative files under `public/uploads` are served by Next static handling with `Cache-Control: public, max-age=3600, must-revalidate` (`apps/web/next.config.ts:56-73`).
- The route handler includes settings hash and pipeline version in its ETag, but the implementation notes state that existing static derivatives bypass that route and still require re-encode to change bytes (`apps/web/src/lib/serve-upload.ts:240-258`).
- `settings-hash.ts` repeats that the hash mainly helps fallback route handling because existing public files are normally served statically (`apps/web/src/lib/settings-hash.ts:14-19`).
- `updateGallerySettings()` detects byte-impacting changes and returns `requiresBackfill`, but it commits the settings, invalidates config cache, and only calls app-tree revalidation (`apps/web/src/app/actions/settings.ts:168-239`).
- `revalidateAllAppData()` only calls `revalidatePath('/', 'layout')`; it does not invalidate static derivative bytes (`apps/web/src/lib/revalidation.ts:59-64`).
- `CLAUDE.md:317` documents the operational gap: flipping byte settings does not invalidate static derivatives until files are re-encoded.

Why this matters:

The architecture has two competing freshness domains: app data/settings and static image bytes. Color/HDR and derivative-quality settings are photographer-facing correctness controls, but static image files remain authoritative for most requests after settings change.

Concrete failure scenario:

An admin changes `force_srgb_derivatives`, JPEG/AVIF quality, chroma subsampling, or wide-gamut source-pixel limits. Pages, metadata, and UI state update immediately, but existing visitors keep receiving old derivative bytes from `public/uploads` until a manual re-encode rewrites those files. A photographer can believe the delivery pipeline is now preserving a new color/HDR policy while public image bytes still reflect the old one.

Suggested fix:

Choose one invalidation model. The cleanest boundary is to move generated derivatives out of `public/` so all derivative requests pass through a settings/version-aware handler. A scalable static alternative is content-addressed or versioned derivative paths keyed by pipeline/settings hash. If the current static path remains, make byte-impacting settings a queued migration workflow: record a pending derivative generation version, enqueue backfill, and present the setting as not fully applied until current-version derivatives exist.

### ARCH-C9-04 - Single-writer topology is a logged invariant, not an enforced invariant

Severity: Medium
Confidence: High
Status: Confirmed operational risk

Evidence:

- `single-writer-guard.ts` states the app assumes one live web process per writable DB and that multiple instances break restore fences, upload quota tracking, and in-memory rate-limit fast paths, but the file explicitly says the guard is "WARN-ONLY" and cannot enforce single-instance operation (`apps/web/src/lib/single-writer-guard.ts:6-16`).
- On persistent lock contention, the code logs that startup is continuing (`apps/web/src/lib/single-writer-guard.ts:218-235`).
- Startup launches the guard fire-and-forget and treats failures as non-fatal (`apps/web/src/instrumentation.ts:22-31`).
- Correctness-relevant state is process-local: upload claims and pending bytes (`apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/upload-tracker-state.ts:70-78`), image queue/bootstrap state (`apps/web/src/lib/image-queue.ts:330-365`, `apps/web/src/lib/image-queue.ts:373-455`), and semantic limiter maps (`apps/web/src/lib/rate-limit.ts:393-415`).
- `CLAUDE.md:236-237` documents single-instance operation and the warn-only guard.

Why this matters:

The system has a real runtime-topology invariant, but it is enforced socially through logs and docs. That is fragile in deploy systems, during container restarts, and when a future scaling or blue/green deploy path is introduced.

Concrete failure scenario:

Two `gallerykit-web` containers point at the same writable MySQL database. Both continue serving traffic. Upload quota checks split across processes, restore/readiness markers may only affect one process, image queue work duplicates or races, and process-local rate-limit maps weaken public expensive-route protection. Operators may not notice the warning until after inconsistent behavior appears.

Suggested fix:

Add an enforceable production mode, for example `GALLERYKIT_ENFORCE_SINGLE_WRITER=true`, that fails readiness or exits after persistent advisory-lock contention. Longer term, move correctness-relevant state to DB-backed or advisory-lock-backed coordination and leave only lossy analytics buffers in process memory.

### ARCH-C9-05 - Shared-group reads own a view-count write side effect

Severity: Low
Confidence: High
Status: Confirmed

Evidence:

- `getSharedGroup()` is the data retrieval helper for shared groups, but it also buffers a denormalized view-count increment after loading group/images/tags (`apps/web/src/lib/data.ts:1322-1407`).
- The same helper is exported through React `cache()` with a warning that callers must avoid changing count semantics inside one render path (`apps/web/src/lib/data.ts:1796-1800`).
- The public shared-group page separately records durable analytics after resolving selected-photo behavior (`apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`).

Why this matters:

This couples data access, analytics, and denormalized counters. It makes a read helper unsafe to reuse from metadata, admin inspection, previews, tests, or future cached data loaders without understanding counter behavior.

Concrete failure scenario:

A future metadata route or admin preview calls `getSharedGroupCached()` to inspect a share. The denormalized `view_count` increments even though no public view occurred. Another route in the same render tree can also inherit cached results with a different `incrementViewCount` intent, so the counter semantics become call-order dependent.

Suggested fix:

Make shared-group reads pure. Move denormalized counter buffering into an explicit `recordSharedGroupView` service beside durable analytics, and have the public route decide once whether a request counts. Cache only the pure read helper.

### ARCH-C9-06 - Storage abstraction does not preserve live file-pipeline invariants

Severity: Low
Confidence: Medium
Status: Likely future-integration risk

Evidence:

- The storage singleton says production upload, processing, and serving still use direct filesystem helpers and the abstraction is not wired end-to-end (`apps/web/src/lib/storage/index.ts:1-12`).
- The interface defines generic `writeStream`, `writeBuffer`, and `copy`, but no atomic replace, rollback, symlink-safe write, or partial-write visibility contract (`apps/web/src/lib/storage/types.ts:44-100`).
- The local implementation writes buffers directly to the final path with `fs.writeFile` and copies directly to destination paths (`apps/web/src/lib/storage/local.ts:76-108`, `apps/web/src/lib/storage/local.ts:142-156`).
- The live image pipeline uses temp files, backup files, final `rename()`, and rollback tracking around derivative replacement (`apps/web/src/lib/process-image.ts:1164-1224`, `apps/web/src/lib/process-image.ts:1433-1477`).

Why this matters:

The current image pipeline has stronger invariants than the abstraction that appears intended to replace it. If the abstraction is wired in without upgrading its contract, the architecture regresses from atomic final-file replacement to direct writes.

Concrete failure scenario:

A future storage migration replaces `process-image.ts` final writes with `LocalStorageBackend.writeBuffer()`. During an encode failure, deploy interruption, or backfill replacement, readers can observe a partial derivative file. The static serving/cache path then records mtime/size and serves bytes that the existing pipeline design would have rolled back.

Suggested fix:

Either keep the abstraction explicitly quarantined as experimental/test-only, or upgrade `StorageBackend` before integration with operations such as `atomicReplace`, temp cleanup, rollback semantics, and symlink-safe open/write behavior. Add parity tests against `process-image.ts` and `serve-upload.ts` assumptions before routing production writes through it.

### ARCH-C9-07 - Drizzle tooling TLS config drifts from runtime DB config

Severity: Low
Confidence: High
Status: Confirmed

Evidence:

- Runtime DB setup requires `DB_SSL_CA` for non-local MySQL and reads the CA into the `ssl.ca` option (`apps/web/src/db/index.ts:12-18`).
- Script/backup/restore DB setup uses the same fail-closed CA behavior (`apps/web/scripts/mysql-connection-options.js:13-29`).
- `drizzle.config.ts` treats non-local DB as TLS-enabled, but only sets `ssl = { rejectUnauthorized: true }`; it does not read `DB_SSL_CA` (`apps/web/drizzle.config.ts:6-22`).
- `apps/web/README.md:170` documents the runtime/backup/restore fail-closed CA requirement, while project docs elsewhere discourage `db:push` for production. The tooling file still allows a different TLS path if someone points it at a non-local private-CA DB.

Why this matters:

Configuration invariants should be centralized for database access. Here runtime and operational scripts fail closed with the configured CA, but Drizzle Kit has a separate TLS shape. That creates a subtle split in how developers and operators experience the same `DATABASE_URL`.

Concrete failure scenario:

An operator runs a Drizzle Kit command against a non-local MySQL endpoint using a private CA. Runtime and backup scripts work because `DB_SSL_CA` is configured, but Drizzle Kit fails certificate verification or tempts the operator to disable TLS verification locally. If pointed at the wrong database, this path also bypasses the stronger runtime guardrails.

Suggested fix:

Reuse a shared CA loader in `drizzle.config.ts`, or make Drizzle Kit explicitly local-only by failing when `DATABASE_URL` is non-local unless a supported CA path is loaded. Document that `db:push` is for throwaway local databases only and keep production migrations on the committed migration runner.

## Final Sweep

I found no Critical or High architecture issues in this pass. The medium risks are concentrated around contracts that are documented or tested at the wrong layer: embedding version ownership, public privacy selection, image-byte invalidation, and single-writer runtime topology.

Commonly missed areas checked:

- Auth/origin/rate-limit architecture: admin API wrappers, server-action origin guards, public expensive-route limits, restore/readiness fences, and route handler shapes. No new architect-level issue beyond the process-local/single-writer finding.
- Migrations and reconciliation: Drizzle journal, `scripts/migrate.js`, privacy-sensitive schema additions, destructive SQL searches, semantic-search migrations, and legacy reconcile coverage. The main architecture issue is the `image_embeddings` key/docs mismatch.
- Config and deployment: Docker standalone output, deploy helper, nginx/static headers, env validation, MySQL TLS, PostCSS override, Node/Next/React versions, and service-worker assets. The main new config issue is Drizzle TLS drift.
- Data ownership: public/admin selects, shared links, collections/smart collections, tags, analytics, upload tracker, restore fences, and semantic embeddings. No additional high-severity data ownership break was found.
- Storage and media pipeline: upload paths, derivative processing, color/HDR metadata, static serving, fallback route serving, and experimental storage backend. The main issue is the static-byte invalidation split plus future storage-contract risk.
- Docs/code drift: `CLAUDE.md`, `apps/web/README.md`, prior reviews, migration docs, semantic activation notes, and comments in storage/serve-upload/image-queue. The clearest drift is embedding version cardinality.

Skipped as non-authoritative/generated: dependencies, build output, runtime media files, local database/data directories, and coverage artifacts. I did not inspect live production host state, real production env values, deployed DB rows, real CLIP model files, or CDN/browser caches.
