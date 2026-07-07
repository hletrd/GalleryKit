# Cycle 16 - Architect Review

Date: 2026-07-08
Role: architect
Repository: `/Users/hletrd/flash-shared/gallery`

## Scope And Method

This is a whole-repository architecture/design-risk review for GalleryKit. I built the inventory first from tracked repository files, then reviewed architecture-relevant docs, runtime configuration, App Router routes/actions, data-access modules, migration scripts, deployment scripts, queue/processing code, storage code, semantic-search code, and the tests that lock those boundaries. I did not use prior review conclusions as proof; code, tests, and docs were cross-checked directly.

Generated/build outputs, package caches, binary image fixtures, and historical review artifacts were excluded from architectural source analysis. No source/config/docs surface in the inventory below was intentionally skipped.

## Architecture Inventory Reviewed

- Operating instructions and design docs: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`, `.context/reviews/prompts/**`.
- Root/package/build config: root `package.json`, `package-lock.json`, `tsconfig.json`, `.github/workflows/**`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig*.json`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`.
- Next.js App Router and boundaries: all tracked files under `apps/web/src/app/**`, including public pages, admin pages, API routes, server actions, upload routes, layouts, metadata/OG routes, and `apps/web/src/proxy.ts` / `apps/web/src/instrumentation.ts`.
- Core source modules: all tracked files under `apps/web/src/lib/**`, `apps/web/src/db/**`, `apps/web/src/components/**`, `apps/web/src/auth.ts`, `apps/web/src/env.ts`, `apps/web/src/server-only.ts`, and shared test fixtures/helpers.
- Schema and migrations: `apps/web/drizzle/**`, `apps/web/drizzle.config.ts`, `apps/web/scripts/migrate.js`, migration journal tests, and schema-drift tripwire tests.
- Runtime/deploy topology: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, root deploy scripts, `apps/web/nginx/default.conf`, health/live endpoints, and deployment documentation.
- Storage/media/search surfaces: upload paths, image queue, Sharp processing, topic resources, derivative serving, storage abstraction quarantine, CLIP model/embedding/search/backfill modules.
- Quality gates and boundary tests: `apps/web/src/__tests__/**`, `apps/web/e2e/**`, lint scripts for admin API auth/action origin/public route rate limiting, privacy-field tests, migration journal tests, and storage quarantine tests.

Final sweep emphasis: I explicitly rechecked commonly missed seams: startup side effects, App Router route/action auth wrappers, public select shapes, migration baseline logic, host-nginx deploy drift, storage abstraction quarantine, topic-resource paths, CLIP model gates, static derivative cache behavior, and single-writer assumptions.

## Findings Summary

Confirmed issues:

1. Production single-writer enforcement is warn-only while process-local correctness mechanisms continue running.
2. Byte-impacting settings become global truth before existing static derivatives match the new policy.

Likely issues:

1. The quarantined storage abstraction's `resources/*` contract conflicts with the live topic-resource path/URL contract.
2. The CLIP embedding table supports only one vector per image, so mode/model transitions destructively replace prior embeddings.

Manual-validation risks:

1. Host nginx configuration is architecture-critical but is not applied or drift-checked by deploy.
2. Migration safety still depends on hand-maintained `reconcileLegacySchema` matching committed migrations; no database structural diff proves equivalence.

## Confirmed Issues

### A16-ARCH-01 - Single-writer invariant is warning-only

Severity: High
Confidence: High
Status: Confirmed issue

Code regions:

- `apps/web/src/lib/single-writer-guard.ts:6-16` documents that two live web processes break restore mutation fences, upload quota tracking, and rate-limit fast paths, but the guard must never block startup.
- `apps/web/src/lib/single-writer-guard.ts:218-235` emits the second-instance warning and explicitly says startup continues.
- `apps/web/src/lib/single-writer-guard.ts:277-302` starts with a zero-timeout advisory lock probe and only schedules a background re-probe on contention.
- `apps/web/src/instrumentation.ts:1-10` starts restore sync, maintenance scheduling, and image-queue bootstrap during process registration.
- `apps/web/src/instrumentation.ts:22-31` starts the single-writer guard fire-and-forget after those startup side effects, and failure is non-fatal.
- `apps/web/src/lib/maintenance-scheduler.ts:83-91` starts an in-process hourly sweep in every web process.
- `apps/web/src/lib/advisory-locks.ts:10-18` warns that most advisory lock names are MySQL-server scoped and assume one GalleryKit per MySQL server unless names are prefixed.

Why this is a problem:

The repository states a single-web-instance / single-writer topology, and multiple correctness mechanisms remain process-local. The only topology guard is intentionally observational, asynchronous, and non-blocking. A second process can continue accepting traffic, starting queue/bootstrap work, running maintenance, and using process-local fast paths even after the guard knows another instance owns the singleton lock.

Concrete failure scenario:

A deploy, manual sidecar, or duplicated Docker service leaves two `gallerykit-web` processes pointed at the same database for longer than the 25-second grace window. The second process logs the loud warning but keeps serving. During that window both processes can run queue/bootstrap and maintenance code, while restore fences, upload quotas, buffered/shared view-count writes, and rate-limit fast paths are not globally coordinated. The system is now outside its documented consistency model, but readiness/health still appears green.

Suggested fix:

Choose one explicit topology contract and enforce it. If GalleryKit remains single-writer, make persistent singleton-lock contention a production startup/readiness failure after the rolling-deploy grace period, before accepting public/admin traffic. If multi-instance operation is desired, move the process-local fences, quota/rate-limit fast paths, queue ownership, and buffered analytics state into database/distributed coordination before allowing multiple live instances. A transitional compromise is to keep boot non-blocking in development but fail health/readiness in production when contention persists.

### A16-ARCH-02 - Byte-impacting settings commit before derivative bytes converge

Severity: Medium
Confidence: High
Status: Confirmed issue

Code regions:

- `apps/web/src/app/actions/settings.ts:168-201` explicitly allows byte-impacting settings, other than hard-fenced upload-contract keys, to change with only a soft `requiresBackfill` signal.
- `apps/web/src/app/actions/settings.ts:207-239` persists those settings, revalidates app data, invalidates detached config cache, and returns success before existing derivatives are re-encoded.
- `apps/web/src/lib/settings-hash.ts:14-26` states that the route-handler ETag hash only helps fallback route-handler traffic; existing static derivatives still need re-encoding before bytes change.
- `apps/web/next.config.ts:60-77` confirms existing derivatives live under `public/uploads` and are normally served as static files with one-hour `must-revalidate` caching.
- `apps/web/src/lib/process-image.ts:1187-1204` only rewrites final derivative paths when processing/backfill actually runs.
- `apps/web/src/db/schema.ts:82-83` tracks `pipeline_version`, while `apps/web/src/db/schema.ts:115-117` stores a pending-row processing snapshot that is cleared after successful processing; there is no durable per-image active settings-generation state for already-processed derivatives.

Why this is a problem:

The configuration layer can say a new color/quality policy is active while the dominant served artifact, static files in `public/uploads`, still contains old bytes. The system has warnings and operational docs, but no durable "media generation pending" state tying a settings commit to corpus convergence. That makes the media pipeline split-brain: new uploads and future backfills use the new settings, while old static derivatives keep old color/quality behavior under unchanged filenames.

Concrete failure scenario:

An admin changes `force_srgb_derivatives`, wide-gamut settings, AVIF/JPEG/WebP quality, or sharpening to correct delivery quality. The settings action succeeds and pages revalidate. New uploads follow the new encoder policy, but existing images continue serving old static derivatives until a separate backfill is run and completes. Public galleries show mixed color/quality behavior, and operators can no longer infer delivered bytes from current settings.

Suggested fix:

Make byte-impacting settings a durable generation transition. Store an active derivative-generation/settings hash per image or per derivative, mark the gallery as "backfill required" transactionally with the settings update, and surface completion state in admin/ops diagnostics. Stronger designs are settings-versioned derivative paths or routing all derivative reads through a generation-aware resolver. At minimum, enqueue/track the required backfill in the same transaction as the settings write and do not present the new policy as fully applied until the corpus converges.

## Likely Issues

### A16-ARCH-03 - Storage abstraction resource paths conflict with live topic-resource paths

Severity: Medium
Confidence: Medium
Status: Likely issue

Code regions:

- `apps/web/src/lib/storage/types.ts:4-16` says the storage layer is experimental, not wired end-to-end, and maps derivative/resource keys to `UPLOAD_ROOT/<key>`.
- `apps/web/src/lib/storage/local.ts:21` includes `resources` in `REQUIRED_PUBLIC_DIRS`.
- `apps/web/src/lib/storage/local.ts:55-67` resolves non-original keys under `UPLOAD_ROOT`.
- `apps/web/src/lib/storage/local.ts:159-166` returns public URLs as `/uploads/<key>`.
- `apps/web/src/lib/process-topic-image.ts:11-28` resolves live topic resources under `public/resources` or `TOPIC_RESOURCES_ROOT`.
- `apps/web/src/lib/process-topic-image.ts:95-126` writes and deletes topic cover files directly in that resources directory.
- `apps/web/src/lib/serve-upload.ts:15` and `apps/web/src/lib/serve-upload.ts:172-175` only serve `/uploads/{jpeg,webp,avif}` and reject other top-level upload directories.
- `apps/web/src/__tests__/storage-quarantine.test.ts:1-27` acknowledges the abstraction is quarantined because importing it would create a second unaudited write path.

Why this is a problem:

The quarantine currently prevents active damage, but the abstraction's documented `resources/*` namespace does not match the live product namespace. Live topic covers are stored under `public/resources` and served as `/resources/...`; the storage backend would put `resources/foo.webp` under `public/uploads/resources/foo.webp` and return `/uploads/resources/foo.webp`, which the upload-serving handler rejects. This is exactly the kind of boundary drift that becomes a bug when a future integration removes or relaxes the quarantine test.

Concrete failure scenario:

A future refactor intentionally wires topic-image handling through `getStorage()` and writes `resources/<uuid>.webp`. The write succeeds and tests that only assert file existence may pass, but the admin/public UI still asks for `/resources/<filename>` or the storage URL returns `/uploads/resources/<filename>`, which the upload route 404s. The deploy also persists `public/resources` separately from `public/uploads`, so backups and cleanup scripts can miss or orphan the new files.

Suggested fix:

Before unquarantining `@/lib/storage`, remove `resources` from the local backend unless it is actually supported, or add an explicit namespace mapper: `resources/*` must resolve to `TOPIC_RESOURCES_ROOT` and public URLs must be `/resources/*`. Add focused tests that cover topic-cover write/read/delete URL behavior through the abstraction. Keep the quarantine test until upload, derivative serving, originals, topic resources, cleanup, backup, and restore all use the same storage contract.

### A16-ARCH-04 - Semantic embeddings destructively replace prior model rows

Severity: Medium
Confidence: Medium
Status: Likely issue

Code regions:

- `apps/web/src/db/schema.ts:277-304` defines `image_embeddings` with `image_id` as the primary key and `model_version` as an attribute, not part of the key.
- `apps/web/src/lib/image-queue.ts:486-524` writes embeddings with `onDuplicateKeyUpdate`, replacing both the vector and `modelVersion` for the image.
- `apps/web/src/app/api/search/semantic/route.ts:263-279` scans only rows matching the active model version.
- `apps/web/src/app/api/search/similar/[id]/route.ts:137-190` requires production model rows for both the target image and candidates.
- `CLAUDE.md:169` documents that one active row exists per image and running a different mode/model destructively replaces the prior vector.
- `apps/web/src/lib/gallery-config-shared.ts:223-229` heals stored production mode to disabled unless the production env gate is set, so mode changes can happen through config/environment transitions.

Why this is a problem:

The schema is intentionally an "active embedding" store, not a model-history store. That is simple, but it couples operator mode changes, backfills, and future model upgrades to destructive replacement. The search routes are correctly model-gated, so any accidental overwrite with stub rows or a future model's rows can make production search appear empty or partially unavailable until a full production backfill runs again.

Concrete failure scenario:

An operator enables production CLIP and backfills all images. Later, during troubleshooting or a demo, stub mode is enabled and upload/bootstrap/backfill writes rows for the same images. The single primary key causes production vectors to be overwritten with `stub-sha256-v1`. Production semantic and similar search then filter for the production model and either return `semantic_no_embeddings` or only a partial corpus until the full production backfill is repeated.

Suggested fix:

If model switching or upgrades are expected, change the schema to retain multiple vectors per image with a composite key such as `(image_id, model_version)` plus an active-model setting or view. If the one-row design is intentional, make transitions that overwrite a different `model_version` explicit operator actions with row-count previews and confirmation, and expose current row counts by model in admin/ops diagnostics.

## Manual-Validation Risks

### A16-ARCH-05 - Host nginx template is not applied or drift-checked by deploy

Severity: Medium
Confidence: High
Status: Manual-validation risk

Code/doc regions:

- `CLAUDE.md:509-521` states that deploys do not touch host nginx and that changes to `apps/web/nginx/default.conf` are inert until an operator applies them manually.
- `apps/web/deploy.sh:51-56` only runs Docker Compose rebuild/start for the application.
- `apps/web/deploy.sh:57-77` health-checks the app container/live endpoint, not the live host nginx configuration.
- `apps/web/deploy.sh:79-108` prunes Docker artifacts and reports disk state, but performs no nginx hash check, `nginx -t`, or reload.

Why this is a problem:

The nginx layer owns architecture-significant behavior: body-size limits, rate limiting, real-client-IP forwarding, static upload/resource handling, TLS/HSTS headers, and routing to Next.js. The repository can ship a correct `nginx/default.conf` while production continues running an older manual host config. The docs call this out, but the deploy path cannot prove the running edge matches the committed architecture.

Concrete failure scenario:

A fix adds or changes a limiter/body-size cap in `apps/web/nginx/default.conf`, tests and code review pass, and `npm run deploy` succeeds. The host still runs the previous nginx file because no operator applied it. Public flood protection, Lightroom upload body limits, or `_next/image` rate limits remain stale in production even though the repo says the issue is fixed.

Suggested fix:

Add a deploy-time drift check that compares the committed nginx template hash to the configured host nginx file and fails or loudly warns when they differ. A stronger fix is to manage nginx as deployment-owned infrastructure: copy the template, run `nginx -t`, reload, and verify a bounded live smoke test behind an explicit production-change gate. If nginx must remain manual, persist the applied template hash/date in an ops ledger and have deploy print the drift status.

### A16-ARCH-06 - Migration reconcile path lacks an automated structural equivalence proof

Severity: Medium
Confidence: Medium
Status: Manual-validation risk

Code regions:

- `apps/web/drizzle/meta/_journal.json:48-58` shows the historical non-monotonic migration jump from idx 6 to idx 7.
- `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-28` documents the Drizzle MAX-created-at footgun and pins monotonicity/post-condition behavior.
- `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:44-54` allowlists the known historical inversion.
- `apps/web/src/__tests__/migration-journal.test.ts:63-105` enforces monotonic behavior from the safe tail and global max from idx 18 onward.
- `apps/web/scripts/migrate.js:348-370` starts `reconcileLegacySchema`, the maintained idempotent schema bootstrap path.
- `apps/web/scripts/migrate.js:684-730` mirrors `image_embeddings` and related indexes/FKs manually in reconcile.
- `apps/web/scripts/migrate.js:758-782` explains that Drizzle MySQL relies on a MAX timestamp cursor rather than per-entry hash checks.
- `apps/web/scripts/migrate.js:858-878` routes fresh databases through reconcile plus per-entry baseline.
- `apps/web/scripts/migrate.js:949-973` enforces the post-condition that every journal hash must be recorded.

Why this is a problem:

The migration discipline is much stronger than a naive Drizzle setup, but it still depends on authors manually keeping `reconcileLegacySchema` equivalent to the current committed migration state. The tests pin monotonic journal behavior and hash-recording guarantees; they do not prove that a fresh reconcile-baselined database and a database that applied all SQL migrations have identical column types, defaults, indexes, foreign keys, collations, or intentionally mirrored DML outcomes.

Concrete failure scenario:

A future migration adds a column with a non-default collation, an index prefix, or a DML backfill. The `.sql` file is correct and the journal tests pass, but `reconcileLegacySchema` mirrors only the column name or misses the exact default/index/DML semantics. A brand-new or legacy-baselined deployment boots with a schema that differs from a normally migrated deployment. The mismatch surfaces later as a query-plan regression, strict-mode insert failure, or semantic inconsistency that the post-condition hash check cannot detect because the hash was baselined.

Suggested fix:

Add an integration test that spins two disposable MySQL databases: one applying committed migrations through the normal Drizzle path and one applying reconcile+baseline. Compare `INFORMATION_SCHEMA` for tables, columns, indexes, foreign keys, nullability, defaults, collations, and generated/extra attributes. Include explicit fixtures for mirrored DML migrations or require DML-bearing migrations to provide a verifier query. Keep the current journal/hash tests as fast tripwires, but add the structural diff as the architecture proof.

## No Finding After Review

- Module boundaries and data layering: `apps/web/src/lib/data.ts:251-327` separates admin select fields, `apps/web/src/lib/data.ts:368-407` derives public fields by omission, and `apps/web/src/lib/data.ts:458-476` compile-guards sensitive fields. I did not find a confirmed admin/public leak in the reviewed public surfaces.
- Semantic-search enrichment: `apps/web/src/lib/search-enrichment-fields.ts:1-47` centralizes public search result fields with a compile-time `PrivacySensitiveKeys` guard. The CLIP risks above are model-retention/ops risks, not public-data separation issues.
- App Router/admin boundaries: `apps/web/src/lib/api-auth.ts:58-144` centralizes admin API auth, token-scope bypass rules, and no-store/nosniff response defaults; `apps/web/src/lib/action-guards.ts:37-43` centralizes same-origin admin checks for mutating server actions. I did not find a new confirmed boundary bypass in this architecture pass.
- Migration discipline: despite A16-ARCH-06, the repo has substantial protections against the known Drizzle skip failure: journal monotonicity tests, DML-baseline guards, per-entry baselining, and a post-condition hash assertion.
- Image processing pipeline coupling: the pipeline is tightly coupled by design to local files, Sharp/libvips, static derivative paths, and admin settings. I did not find a new confirmed corruption issue beyond the settings-generation gap in A16-ARCH-02 and the storage-abstraction mismatch in A16-ARCH-03.

## Final Sweep

Commonly missed issue classes checked:

- Startup/background side effects before readiness.
- Multiple web-process / single database assumptions.
- Public API and server-action auth boundaries.
- Public select shapes and search enrichment fields.
- Static `public/uploads` precedence over route-handler derivative serving.
- Storage abstraction vs direct filesystem upload/topic-resource paths.
- CLIP production/stub gates, row model-version filters, and embedding overwrite behavior.
- Migration journal monotonicity, reconcile/baseline behavior, and hash post-condition.
- Docker/compose/deploy/nginx runtime topology and docs-code drift.

Skipped as non-architecture implementation surface: generated output, dependency caches, uploaded/binary media fixtures, and old review artifacts not needed as evidence. No relevant tracked source/config/doc file category from the inventory was skipped.
