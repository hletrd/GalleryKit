# Architect Review - Cycle 19

Repo: `/Users/hletrd/flash-shared/gallery`
Scope: repository-wide architectural/design risk review: module boundaries, coupling, layering, deployment/runtime topology, data model evolution, migration/reconcile contracts, cache/queue/backfill designs, and frontend architecture.
Mode: read-only source review except for writing this report artifact. No source files modified.

## Inventory Reviewed

- Governing docs and prior context: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.context/plans/archive/129-cycle19-fixes.md`, `.context/plans/archive/378-deferred-cycle19.md`, current `.context/reviews/*` inventory.
- Deployment/runtime topology: `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `apps/web/src/instrumentation.ts`, `apps/web/src/db/index.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/lib/restore-maintenance.ts`.
- Data model and migrations: `apps/web/src/db/schema.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`, `apps/web/src/__tests__/migration-journal*.test.ts`.
- Data/cache/revalidation: `apps/web/src/lib/data.ts`, `apps/web/src/lib/revalidation.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/settings-hash.ts`, public/admin pages under `apps/web/src/app/[locale]/`.
- Upload, queue, backfill, and storage boundaries: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/scripts/backfill-color-pipeline.ts`, `apps/web/scripts/backfill-clip-embeddings.ts`, `apps/web/src/lib/storage/*`, `apps/web/src/__tests__/storage-quarantine.test.ts`.
- Frontend architecture and client/server boundaries: `apps/web/src/components/**`, route pages/layouts under `apps/web/src/app/[locale]/`, `apps/web/src/__tests__/client-server-only-boundary.test.ts`, touch target and i18n guard tests.
- Security/layering guardrails relevant to architecture: admin API auth lint, action-origin lint, public route rate-limit lint, privacy field guard tests, search enrichment guards, storage quarantine guard.

## Summary

Findings: 3 total.

- High: 1
- Medium: 2
- Low: 0

The strongest architectural guardrails remain migration/reconcile tripwires, privacy field separation, client/server import scanning, storage quarantine, public route rate-limit linting, and dynamic-public-page freshness policy. The remaining risks are concentrated in ownership boundaries that are still prose-or-convention enforced: two upload adapters own the same ingest transaction, build-time and runtime environment sources can diverge, and several correctness preconditions depend on a single Node process without a runtime invariant.

## Findings

### 1. Browser upload and Lightroom upload still duplicate one ingest contract

Severity: High
Confidence: High

Files/regions:

- `apps/web/src/app/actions/images.ts:114-190` validates browser-upload auth/input, acquires the upload contract lock, and snapshots gallery processing settings.
- `apps/web/src/app/actions/images.ts:244-292` performs browser-upload disk and topic preconditions after the quota claim.
- `apps/web/src/app/actions/images.ts:350-461` saves the original, applies HDR/GPS/restore gates, extracts EXIF/color fields, and builds the `images` insert value.
- `apps/web/src/app/actions/images.ts:499-531` builds the browser queue job.
- `apps/web/src/app/api/admin/lr/upload/route.ts:15-18` says the Lightroom route reuses upload infrastructure.
- `apps/web/src/app/api/admin/lr/upload/route.ts:225-275` independently verifies topic, acquires the same lock, and snapshots settings.
- `apps/web/src/app/api/admin/lr/upload/route.ts:307-452` independently saves the original, applies HDR/GPS/restore gates, extracts EXIF/color fields, and builds the `images` insert value.
- `apps/web/src/app/api/admin/lr/upload/route.ts:479-516` independently builds the Lightroom queue job.

Problem:

The route-level comment says the Lightroom endpoint reuses upload infrastructure, but the actual orchestration has two owners. Lower-level helpers are shared, yet the state transition itself is duplicated: upload quota settlement, filename policy, disk precheck, topic validation, settings snapshot, HDR rejection, GPS stripping, restore-maintenance cleanup, `images` insert shape, processing-settings persistence, queue job shape, audit, and revalidation.

The code comments show repeated drift repairs in the Lightroom path: filename parity, upload lock, disk precheck, RAW message parity, HDR gate, GPS original stripping, color/HDR column persistence, caption inputs, and the six non-quality processing settings. That is a strong signal that this is not healthy adapter-specific variation; it is one ingest contract with two hand-maintained implementations.

Failure scenario:

A future pipeline change adds a new upload-time field, for example `source_profile_hash`, `rendering_intent`, or another byte-impacting processing setting. The implementer updates `uploadImages()` and its browser tests, but misses `/api/admin/lr/upload` because it is a separate API route with its own cleanup and response flow. Browser uploads then persist complete metadata and enqueue correct derivatives, while Lightroom publishes silently omit the field or enqueue stale settings. The defect only appears after external uploads: color audit rows differ by ingest client, fresh LR uploads require backfill repair, or a new privacy/processing invariant is bypassed on the integration path.

Fix:

Extract a server-only ingest service, for example `apps/web/src/lib/upload-ingest.ts`, that owns the shared transaction:

- Input: actor id, file-like object, topic, optional title/description/tags, sanitized user filename, gallery config snapshot, and adapter-specific response hooks.
- Responsibilities: save original, enforce HDR/GPS/restore gates, extract EXIF/color fields, build the `images` insert value, persist `processing_settings_json`, construct the queue job, coordinate quota settlement, and clean up on pre-insert failure.
- Browser action and Lightroom route should become thin adapters that validate transport-specific input and map shared results to UI/API responses.
- Add source/fixture tests that assert both adapters call the shared insert builder and shared queue-job builder, so future columns/settings fail in one place.

### 2. Docker deployment can split build-time Next config from runtime `.env.local`

Severity: Medium
Confidence: High

Files/regions:

- `apps/web/docker-compose.yml:7-10` forwards build args only from the shell/Compose environment.
- `apps/web/docker-compose.yml:17-21` loads `.env.local` only as runtime container env.
- `apps/web/deploy.sh:15-31` checks that `.env.local` exists, then runs `docker compose -f apps/web/docker-compose.yml up -d --build` without `--env-file` or sourcing the file.
- `apps/web/Dockerfile:65-70` turns only `BASE_URL`, `IMAGE_BASE_URL`, and `UPLOAD_MAX_TOTAL_BYTES` build args into build-time env.
- `apps/web/next.config.ts:28` reads `IMAGE_BASE_URL` while loading Next config.
- `apps/web/next.config.ts:92-105` bakes server-action body and image remote-pattern config into the build.
- `apps/web/src/lib/upload-limits.ts:19-33` reads `UPLOAD_MAX_TOTAL_BYTES` and `NEXT_UPLOAD_BODY_MAX_BYTES`; the latter affects `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT`, which `next.config.ts` imports.
- `apps/web/.env.local.example:9-16` presents `BASE_URL` and `IMAGE_BASE_URL` as `.env.local` settings and notes `IMAGE_BASE_URL` must be set before build.
- `apps/web/.env.local.example:41-47` documents `UPLOAD_MAX_TOTAL_BYTES` and `NEXT_UPLOAD_BODY_MAX_BYTES` in `.env.local`.
- `README.md:148-149` says build-time values must be exported before `docker compose ... --build` and that compose forwards them when present in the shell.

Problem:

The operational path has two environment channels: `.env.local` for runtime and shell variables for Docker build args. The deploy helper validates `.env.local`, but does not pass it to Compose as the build env source. An operator can follow the checked-in example file, set public URL/CDN/upload values in `.env.local`, and still build with empty or default build-time values unless those variables were also exported in the shell that invoked deploy.

This is a build/runtime split-brain. Runtime server code sees `.env.local`, while `next.config.ts` and build guards see only Docker build args. `NEXT_UPLOAD_BODY_MAX_BYTES` is also documented as a build-affecting `.env.local` value but is not forwarded as a Docker build arg at all.

Failure scenario:

An operator sets `IMAGE_BASE_URL=https://cdn.example.com/gallery` only in `apps/web/.env.local`, which the service already consumes at runtime. Runtime URL helpers can emit CDN URLs, but the Docker build ran with `IMAGE_BASE_URL=''`, so `next.config.ts` creates no remote image pattern. Any path that uses Next image optimization or future image config derived from that value can reject or mishandle production CDN URLs even though the runtime env appears correct.

A second variant: the operator raises `NEXT_UPLOAD_BODY_MAX_BYTES` in `.env.local` to match a customized reverse proxy/restore size. Runtime checks see the env, but the Next server-action body limit was baked at the default during build because Dockerfile never forwards that variable. Large restore or upload requests then fail at the framework parser before the app-level checks and localized errors run.

Fix:

Make build and runtime use one authoritative env source:

- Prefer `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`, or source a whitelisted subset from `.env.local` before invoking Compose.
- Add a Docker build arg and builder `ENV` for `NEXT_UPLOAD_BODY_MAX_BYTES`, or make it explicitly runtime-only by removing it from build-time Next config.
- Add a deploy-contract test that scans `next.config.ts`, `scripts/ensure-site-config.mjs`, and `src/lib/upload-limits.ts` for build-time env reads and asserts each one is forwarded from the same env source.
- Update README/CLAUDE wording so operators do not need a second shell-export step outside the shipped deploy command.

### 3. Single-process coordination is documented but not enforced by a runtime invariant

Severity: Medium
Confidence: High

Files/regions:

- `CLAUDE.md:227-230` documents the shipped single web-instance/single-writer topology and process-local restore flags, upload quotas, queue state, backfill status, rate-limit fast paths, and shared-group view buffer.
- `CLAUDE.md:390-397` documents advisory locks for restore, upload-processing contract changes, per-image processing, backfill, and their MySQL-server-wide lock namespace.
- `apps/web/src/lib/restore-maintenance.ts:1-22` stores restore-maintenance state in `globalThis`.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota claims in a `globalThis` Map.
- `apps/web/src/lib/upload-tracker-state.ts:70-78` decides whether active upload claims exist by scanning only that local Map.
- `apps/web/src/app/actions/settings.ts:68-79` uses that local active-upload check before acquiring the upload-processing contract lock.
- `apps/web/src/lib/image-queue.ts:76-90` defines process-local queue/bootstrap state and `QUEUE_CONCURRENCY`.
- `apps/web/src/lib/admin-backfill-runner.ts:144-250` stores admin backfill status in `globalThis`.
- `apps/web/src/lib/rate-limit.ts:77-121` defines in-memory OG/share/search/admin-token/login fast-path buckets.
- `apps/web/src/app/actions/public.ts:46-63` and `apps/web/src/app/actions/public.ts:335-348` define additional process-local public load-more and view-record limiter buckets.
- `apps/web/src/lib/data.ts:1-38` defines the process-local shared-group view-count buffer and retry map.
- `apps/web/src/instrumentation.ts:1-7` bootstraps the image queue once per Node process, and `apps/web/src/instrumentation.ts:18-65` drains process-local queue/buffer state on process signal.

Problem:

The docs correctly state that the product is single-process, and the current Compose service shape makes ordinary `docker compose up` single-instance. But the invariant is not encoded in the app. Several correctness checks assume "the process that checks is the process that owns the state." Advisory locks protect some critical sections, but they do not make the surrounding preconditions shared.

The upload settings path is the sharpest example. `updateGallerySettings()` checks `hasActiveUploadClaims()` before changing `image_sizes` or `strip_gps_on_upload`, then acquires the DB advisory lock. In a second web process, an upload claim held by process A is invisible to process B. The advisory lock serializes writers that acquire it, but it cannot see the local upload-tracker precondition that was already evaluated in another process.

Failure scenario:

A maintainer starts a second GalleryKit web process during a blue/green test, an emergency manual `node server.js`, or a future container/orchestrator change. A large upload enters process A and claims quota in A's `globalThis` upload tracker. An admin settings request lands on process B; B sees no active local claims, acquires the upload-processing lock, and changes `strip_gps_on_upload` or `image_sizes` while process A is mid-upload. The first committed image can then race the setting that was meant to be locked, public rate-limit budgets are multiplied per process, and in-app backfill status becomes misleading because only the process that started it reports `running`.

Fix:

Choose and enforce one topology direction:

- If single-process remains the product contract, add a startup DB lease/instance guard keyed by DB name and app identity. A second live web process for the same DB should fail loudly before queue bootstrap and request handling. Keep the current `container_name`/host-network shape as deployment friction, but do not rely on Compose shape as the only invariant.
- If multi-process is a roadmap goal, move upload claims, restore maintenance, rate-limit buckets, queue ownership, shared-group view buffers, and admin backfill status into durable/shared storage. The existing MySQL advisory locks can remain, but their preconditions need shared state.
- Add a topology contract test/startup assertion so accidental scale-out fails before traffic reaches these process-local assumptions.

## Non-Finding Coverage Notes

- Migration/reconcile contracts are unusually well guarded. `CLAUDE.md:416-438` documents the non-monotonic Drizzle journal hazard and the runbook; `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:76-103` checks table/column mirror coverage, `:124-173` checks index mirrors, and `:190-244` pins known DROP/definition convergence cases. I did not find a current architecture issue beyond the normal "source tripwire, not full information_schema diff" limitation the test itself documents.
- Privacy field layering is guarded in both code and tests. `apps/web/src/lib/data.ts:251-327` defines the admin field set, `:368-408` derives public fields by omission, `:459-489` carries compile-time sensitive-key guards, and `apps/web/src/__tests__/privacy-fields.test.ts:47-93` asserts the symmetric public/admin contract.
- Storage abstraction remains quarantined as intended. `CLAUDE.md:142` says local filesystem is the only supported product storage; `apps/web/src/__tests__/storage-quarantine.test.ts:111-143` fails source imports outside `lib/storage`. I did not count the dormant storage module as a finding because there is now a CI guard against accidental wiring.
- Client/server frontend boundaries are actively scanned. Client components use shared/client-safe config imports or type-only data imports, while server components own DB-backed data fetches. `apps/web/src/__tests__/client-server-only-boundary.test.ts:12-47` documents the closure scan and `mysql2` server-only detection. Spot checks of component/page imports found no value import of `@/lib/data` or `@/db` from `'use client'` modules.
- Public freshness/caching is intentional. `CLAUDE.md:401-414` documents React `cache()` use, `revalidate = 0` for dynamic gallery/photo/share surfaces, and the service-worker offline-only HTML exception. `apps/web/src/lib/revalidation.ts:59-65` centralizes full-tree invalidation through layout revalidation.
- Search and public API boundaries have dedicated lint/test surfaces. The grep sweep confirmed mutating public routes/actions are either rate-limited or explicitly exempted, and admin API routes use `withAdminAuth`.

## Final Missed-Issue Sweep

Final sweep covered:

- Module boundaries: server/client import graph, `@/lib/storage` quarantine, data-layer privacy field sets, search enrichment select sharing.
- Coupling/layering: upload adapters, data access, gallery config, revalidation, route/action ownership.
- Deployment/runtime topology: Compose, Dockerfile, deploy helper, build args, env files, instrumentation startup/shutdown, process-local state.
- Data model evolution: Drizzle schema, migration journal, reconcile mirror tests, privacy/admin-only-column checklist.
- Cache/queue/backfill: React `cache()`, static derivative cache policy, service-worker notes, image PQueue bootstrap, admin backfill runner, sidecar backfill contracts, shared view-count buffer.
- Frontend architecture: route dynamic policy, client-safe shared config imports, client/server closure tests, admin/public route split.

No additional reportable architectural/design issues were found beyond the three findings above. No source files were modified.
