# Architect Review — Cycle 18

Repo: `/Users/hletrd/flash-shared/gallery`
Scope: architecture/design risk, coupling, layering, boundary drift, data model evolution, deployment/runtime topology, module ownership, long-term maintainability.
Mode: read-only review; no implementation, no commit, no push.

## Inventory Reviewed

- Project rules and architecture docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`.
- Deployment/runtime: `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/next.config.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/content-security-policy.ts`, `apps/web/src/lib/constants.ts`, `apps/web/src/lib/image-url.ts`.
- Data/model/migrations: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, migration SQL files, `apps/web/src/lib/data.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/lib/smart-collections.ts`.
- Upload/processing/runtime coordination: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/admin-backfill-runner.ts`.
- Public/admin routes and actions: `apps/web/src/app/actions/*.ts`, public pages under `apps/web/src/app/[locale]/(public)/`, admin pages under `apps/web/src/app/[locale]/admin/`, API routes under `apps/web/src/app/api/`.
- Boundary tests and guard tests: client/server boundary, storage quarantine, migration, privacy, route auth/rate-limit, deploy-script, image queue, smart collection, semantic search, upload-tracker, and related fixture-style tests under `apps/web/src/__tests__/`.

## Summary

Findings: 3 total.

- High: 1
- Medium: 2
- Low: 0

The repo has unusually strong tripwire coverage for many historical drift classes: privacy field selection, storage quarantine, client/server imports, migration journal monotonicity, smart collection AST validation, upload settings snapshots, and public route auth/rate-limit linting. The remaining architectural risk is concentrated in duplicated ingest ownership and runtime/deployment assumptions that are documented but not enforced by a single code boundary.

## Findings

### 1. Browser upload and Lightroom upload still duplicate the ingest transaction

Severity: High
Confidence: High
Files/regions:

- `apps/web/src/app/actions/images.ts:350-460` saves the original, gates HDR/GPS/restore maintenance, extracts EXIF, builds the DB insert, and snapshots processing settings for browser uploads.
- `apps/web/src/app/actions/images.ts:499-531` builds the queue job for browser uploads.
- `apps/web/src/app/api/admin/lr/upload/route.ts:243-275` independently acquires the upload contract lock and loads the same upload settings snapshot for Lightroom uploads.
- `apps/web/src/app/api/admin/lr/upload/route.ts:307-452` independently saves the original, gates HDR/GPS/restore maintenance, extracts EXIF, builds the DB insert, and writes processing settings.
- `apps/web/src/app/api/admin/lr/upload/route.ts:479-516` independently builds the queue job for Lightroom uploads.

Problem:

The route comment says the Lightroom endpoint "re-uses the existing upload infrastructure" (`apps/web/src/app/api/admin/lr/upload/route.ts:15-18`), but the actual ownership is two large parallel implementations. They share helpers for lower-level pieces, yet the orchestration contract is still hand-copied: filename sanitation, disk-space precheck, upload tracker settlement, HDR rejection, GPS stripping, restore-maintenance cleanup, `images` insert shape, processing settings snapshot, queue job shape, color/HDR metadata forwarding, audit, and revalidation.

The code history embedded in comments shows this has already produced drift: the Lightroom path had to be patched to mirror browser behavior for filename validation, upload lock, disk-space precheck, RAW messages, HDR gate, GPS stripping, color/HDR columns, caption inputs, and the six non-quality processing settings. Those are not independent features; they are one ingest contract with two owners.

Concrete failure scenario:

A future schema or pipeline change adds a new upload-time column such as `source_profile_hash`, `rendering_intent`, or a new byte-impacting processing setting. The implementer updates `uploadImages()` and its tests, but misses `POST /api/admin/lr/upload` because the second path is an API route with its own response and cleanup flow. Browser uploads then persist complete metadata and queue correct derivatives, while Lightroom uploads silently omit the column or enqueue stale settings. The failure is photographer-visible only after external publishes: color audit rows differ by ingest client, backfills become required to repair fresh uploads, and one path may leak metadata or bypass a new processing invariant.

Suggested fix:

Extract one server-only ingest service that owns the shared state transition, for example `lib/upload-ingest.ts`:

- Input: authenticated actor, file-like object, topic slug, optional title/description, sanitized user filename, config snapshot, response-mode callbacks.
- Responsibilities: save original, HDR/GPS/restore gates, EXIF/color metadata, `images` insert value construction, processing snapshot serialization, queue job construction, quota settlement hooks, cleanup-on-failure.
- Browser action and Lightroom route should become thin adapters that validate their transport-specific inputs and map shared result variants to UI/API responses.
- Add a fixture test that calls the shared builder once and asserts both adapters pass through the same insert keys and queue-job keys, so future columns/settings fail in one place.

### 2. Docker deploy separates runtime `.env.local` from build-time Next configuration

Severity: Medium
Confidence: High
Files/regions:

- `apps/web/docker-compose.yml:7-10` forwards only shell/Compose environment values as build args.
- `apps/web/docker-compose.yml:17-21` loads `.env.local` only as container runtime env.
- `apps/web/deploy.sh:15-31` checks that `.env.local` exists, then runs `docker compose ... up -d --build` without sourcing `.env.local` or passing it as Compose's env file.
- `apps/web/Dockerfile:65-70` turns build args into build-time env for `next build`.
- `apps/web/next.config.ts:28` reads `IMAGE_BASE_URL` at config load, and `apps/web/next.config.ts:98-105` bakes server action body and image remote-pattern configuration into Next config.
- `README.md:148-149` tells operators that `BASE_URL`, `IMAGE_BASE_URL`, and `UPLOAD_MAX_TOTAL_BYTES` must be present before build and that compose forwards them when present in the shell.
- `apps/web/.env.local.example:9-16` presents `BASE_URL` / `IMAGE_BASE_URL` as `.env.local` settings.

Problem:

The operational model has two different environment channels: `.env.local` for runtime and shell variables for Docker build args. The deploy script validates `.env.local` but does not feed it into the build environment. That means an operator can follow the example file, set public URL or CDN values in `apps/web/.env.local`, and still build with empty build args unless those values were also exported in the shell running deploy.

This creates a hidden split-brain boundary: runtime server code reads `.env.local`, while `next.config.ts` and build validation read only build-time env. Documentation mentions the need to export values, but the default deploy helper does not enforce it.

Concrete failure scenario:

An operator enables a CDN by setting `IMAGE_BASE_URL=https://cdn.example.com/gallery` only in `apps/web/.env.local`, which is the file the compose service already consumes. Runtime HTML stamps that value into `data-image-base` via `apps/web/src/app/[locale]/layout.tsx:103-110`, and client image URLs point at the CDN via `apps/web/src/lib/image-url.ts:25-36`. But the Docker build ran with `IMAGE_BASE_URL=''`, so Next's build-time image remote configuration was created without that origin (`apps/web/next.config.ts:28, 105`). If any current or future path uses Next image optimization or another build-time config derived from that value, the production image rejects or mishandles URLs even though the runtime env looks correct. Similarly, invalid public URL values in `.env.local` can evade `ensure-site-config` at build and fail later at request time.

Suggested fix:

Make the deployment path use one authoritative env source for build and runtime:

- Prefer `docker compose --env-file apps/web/.env.local -f apps/web/docker-compose.yml up -d --build`, or explicitly source a whitelisted subset from `.env.local` before the compose build.
- Add missing build args for every build-time env consumed by `next.config.ts` / build guards, including `NEXT_UPLOAD_BODY_MAX_BYTES` if it remains configurable.
- Add a deploy-contract test that asserts every build-time env read by `next.config.ts`, `scripts/ensure-site-config.mjs`, and `src/lib/upload-limits.ts` is either forwarded from the same env file or intentionally runtime-only.
- Update README/CLAUDE wording so operators do not have to remember a second shell export step outside the shipped deploy command.

### 3. Single-process coordination is documented but not enforced at runtime

Severity: Medium
Confidence: High
Files/regions:

- `CLAUDE.md:227-230` documents that the shipped topology is single web-instance / single-writer and that restore flags, upload quota tracking, image queue state, admin backfill status, and several rate-limit buckets are process-local.
- `apps/web/src/lib/restore-maintenance.ts:1-22` stores restore maintenance state in `globalThis`.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` stores upload quota claims in a process-local `globalThis` Map; `apps/web/src/lib/upload-tracker-state.ts:70-78` uses only that local Map to decide whether active uploads exist.
- `apps/web/src/app/actions/settings.ts:68-79` relies on `hasActiveUploadClaims()` plus an advisory lock before changing upload-processing contract settings.
- `apps/web/src/lib/image-queue.ts:76-90` constructs process-local queue/bootstrap state from `globalThis` and `QUEUE_CONCURRENCY`.
- `apps/web/src/app/actions/public.ts:46-49` and `apps/web/src/app/actions/public.ts:335-338` define process-local public action/view-record limiters.
- `apps/web/src/lib/rate-limit.ts:77-100` and `apps/web/src/lib/rate-limit.ts:112-121` define additional process-local fast-path rate-limit buckets.
- `apps/web/src/lib/data.ts:11-38` stores shared-group view count buffering and retry counters in process memory.
- `apps/web/src/lib/admin-backfill-runner.ts:144-230` stores admin backfill status in a process-local `globalThis` object.

Problem:

The architecture is intentionally single-instance, but that is enforced mainly by documentation and the current compose shape, not by a runtime invariant. Several correctness decisions depend on "the process that checks is the process that owns the state." The advisory locks protect some cross-process critical sections, but they do not make all local state shared.

The most important boundary is upload settings: `updateGallerySettings()` checks the local upload tracker before changing `image_sizes` or `strip_gps_on_upload`. In a second web process, an active upload claim held by process A is invisible to process B. Process B can acquire the DB advisory lock after its local tracker says no upload is active and change the upload-processing contract while process A is mid-upload.

Concrete failure scenario:

A maintainer runs a second GalleryKit web process during a blue/green test, an emergency manual `node server.js`, or a future container orchestration change. A large upload enters process A and claims quota in A's `globalThis` map. An admin settings request lands on process B; B's `hasActiveUploadClaims()` sees no claims and allows a `strip_gps_on_upload` or `image_sizes` change. The upload in A finishes under a config snapshot that no longer matches the setting-lock guarantee. Depending on timing, the first committed image can race the setting that was intended to be locked before any photos existed, or public rate limits are effectively multiplied per process.

Suggested fix:

Choose one of two directions and encode it in code, not only docs:

- If single-process remains the product contract, add a startup/deploy guard that fails loudly when `WEB_CONCURRENCY`, cluster mode, or multiple app instances are detected for the same DB. A lightweight DB lease row keyed by instance identity can make this explicit.
- If multi-process is a future goal, move upload claims, restore maintenance, rate-limit buckets, queue ownership, shared-group view buffers, and backfill status to durable/shared storage. The existing MySQL advisory locks can stay, but they need shared state for the precondition checks they currently surround.
- Add a topology contract test or startup assertion that makes accidental scale-out fail before traffic reaches these process-local assumptions.

## Missed-Issues Sweep

Final sweep checked for additional architectural drift in:

- Schema/list drift: previous run-9 cycle-8 architect sweep plus current spot checks show schema ↔ migration reconcile, privacy fields, backup table list, advisory lock names, and color-impacting settings are guarded.
- Client/server layering: `client-server-only-boundary.test.ts` walks client import closures and treats `mysql2` as server-only; no unguarded client imports of DB/data modules were found in source grep.
- Storage abstraction: `storage-quarantine.test.ts` explicitly prevents `@/lib/storage` imports outside the quarantined module; not counted as a current finding.
- Smart collections: AST parse/compile is allowlisted, bounded, and topic rename remaps exact topic references; not counted beyond the general JSON-AST model tradeoff.
- Public search privacy: semantic and similar routes share `searchEnrichmentSelectFields` with a compile-time `PrivacySensitiveKeys` guard; not counted.
- Deployment safety: prune-after-up and bind-mount assumptions are covered by `deploy-script-contract.test.ts`; the remaining uncovered issue is the build/runtime env split above.

No implementation changes were made beyond writing this review file.
