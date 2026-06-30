# Architect Review - Cycle 20

Review role: architect  
Repository: `/Users/hletrd/flash-shared/gallery`  
HEAD reviewed: `24c82c71` on `master`  
Implementation files edited: none

## Summary

- Confirmed issues: 2
- Likely issues: 1
- Risks needing validation: 1
- Severity mix: 0 critical, 0 high, 4 medium, 0 low

## Inventory Reviewed

Read first: `AGENTS.md` and `CLAUDE.md`.

Architecture-relevant inventory reviewed:

- Routing and boundary layer: 76 files under `apps/web/src/app`, including public pages, admin actions, API routes, localized routing, and server action boundaries.
- Domain/service layer: 97 files under `apps/web/src/lib`, including ingest, image processing, queueing, upload limits, settings, privacy, analytics, auth, rate limiting, and data access.
- UI layer and navigation behavior: 57 files under `apps/web/src/components`.
- Schema and migration contracts: `apps/web/src/db/schema.ts`, `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`.
- Build/runtime/deploy contracts: `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/.env.local.example`, `apps/web/nginx/default.conf`.
- Verification assets: 278 test/e2e files under `apps/web/src/__tests__` and `apps/web/e2e`.

Validation evidence:

- Static inventory and grep sweeps covered route/action/config env reads, ingest/queue ownership, render-time analytics writes, process-local state, migration/reconcile logic, privacy select guards, API auth/rate-limit wrappers, storage/topology notes, and TODO/FIXME markers.
- `npm test --workspace=apps/web -- migration-journal.test.ts migration-journal-monotonicity.test.ts migrate-reconcile-coverage.test.ts privacy-fields.test.ts search-route-privacy.test.ts deploy-script-contract.test.ts next-config.test.ts`: 7 files, 95 tests passed.
- Full lint/typecheck/build/e2e were not run because this was a read-only architecture review artifact, not an implementation change.

## Confirmed Issues

### ARCH20-01 - One upload contract has multiple implementation owners

Severity: Medium  
Confidence: High  
Category: Confirmed architecture/layering issue
Status: Open

Evidence:

- Browser upload owns the primary ingest lifecycle in `apps/web/src/app/actions/images.ts:114-190`, `apps/web/src/app/actions/images.ts:244-292`, `apps/web/src/app/actions/images.ts:350-461`, and `apps/web/src/app/actions/images.ts:499-531`.
- The Lightroom upload route declares it reuses browser upload infrastructure in `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`, but independently implements the same lifecycle in `apps/web/src/app/api/admin/lr/upload/route.ts:225-275`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-452`, and `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`.
- Retry processing constructs another queue job manually in `apps/web/src/app/actions/images.ts:1227-1280`.
- `ProcessingSettingsSnapshot` is centralized in `apps/web/src/lib/image-queue.ts:92-120`, but each adapter still has to remember which fields to forward.
- Tests record previous contract drift in this exact area: upload settings wiring in `apps/web/src/__tests__/image-queue-settings-wiring.test.ts:1-21`, and Lightroom source-contract parity for HDR/GPS in `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:1-15` and `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts:69-76`.

Architectural impact:

The upload boundary looks layered, but the domain operation is owned by route/action adapters. The result is a "parallel controller implementation" architecture: every new ingest invariant must be patched into browser upload, Lightroom upload, retry, and tests. The repo history already shows this causes parity fixes to arrive as source-contract tests rather than as one shared behavior.

Concrete failure scenario:

An admin-only processing setting is added to `GalleryConfig` and used by the queue worker. The browser action forwards it, but the Lightroom route misses it. External client uploads then keep stale/default processing behavior while browser uploads honor the new setting. Because both paths persist normal rows and enqueue normal jobs, the difference appears only after photographers compare output or after a later backfill rewrites derivatives differently.

Suggested fix:

Create a single ingest application service with stable DTOs for `UploadActor`, `UploadSource`, `UploadFile`, `UploadMetadata`, and `UploadPolicySnapshot`. It should return a domain result consumed by browser and API adapters. Route/action files should not construct `images` insert objects or `ImageProcessingJob` objects directly. Add an exhaustiveness test that fails when `ProcessingSettingsSnapshot` or the image insert contract changes without updating the single ingest builder.

### ARCH20-02 - Docker deploy can build with different environment than the runtime container

Severity: Medium  
Confidence: High  
Category: Confirmed deploy architecture issue
Status: Open

Evidence:

- Compose build args are read from Compose interpolation environment only: `BASE_URL`, `IMAGE_BASE_URL`, and `UPLOAD_MAX_TOTAL_BYTES` in `apps/web/docker-compose.yml:4-10`.
- The runtime container separately receives `apps/web/.env.local` through `env_file` in `apps/web/docker-compose.yml:17-21`.
- The deploy script validates that `apps/web/.env.local` exists, then runs `docker compose -f apps/web/docker-compose.yml up -d --build` without `--env-file` and without sourcing that file in `apps/web/deploy.sh:15-31`.
- The Docker build context deliberately excludes env files with `**/.env*` in `.dockerignore:14`, so `apps/web/.env.local` is not available to the image build via `COPY . .`.
- The Docker build stage only promotes `BASE_URL`, `IMAGE_BASE_URL`, and `UPLOAD_MAX_TOTAL_BYTES` into the build environment in `apps/web/Dockerfile:64-70`.
- Build-time Next config reads `IMAGE_BASE_URL` for remote image patterns and CSP input in `apps/web/next.config.ts:28` and `apps/web/next.config.ts:51-105`.
- Build-time server-action body size comes from `NEXT_UPLOAD_BODY_MAX_BYTES` through `apps/web/src/lib/upload-limits.ts:19-33`, but `NEXT_UPLOAD_BODY_MAX_BYTES` is documented only in `.env.local` in `apps/web/.env.local.example:41-47` and is not a Docker build arg.

Architectural impact:

There are two authoritative environment surfaces: the deploy/runtime `.env.local` contract and the Compose shell interpolation/build-arg contract. Operators are told to configure `.env.local`, but several settings that shape the built Next.js app are not reliably loaded from that file at image build time.

Concrete failure scenario:

An operator sets `IMAGE_BASE_URL=https://cdn.example.com` and `NEXT_UPLOAD_BODY_MAX_BYTES=536870912` in `apps/web/.env.local`, then runs the documented deploy. The container starts with those runtime values, but the image may have been built without the CDN host in `images.remotePatterns` and without the larger server-action body limit. Result: CDN-hosted uploaded images fail Next image validation or large restores/uploads fail at the framework parser despite runtime config suggesting they should pass.

Suggested fix:

Make one deploy environment source authoritative. Options:

- Run Compose with `--env-file apps/web/.env.local` and document that build-time-public settings must be there.
- Add every build-time setting used by `next.config.ts`, including `NEXT_UPLOAD_BODY_MAX_BYTES`, to `docker-compose.yml` build args and `Dockerfile` `ARG`/`ENV`.
- Add a deploy contract test or script check that compares `.env.local` keys consumed at build time with Compose/Docker build args, failing when a new build-time env is documented but not wired.

## Likely Issues

### ARCH20-03 - Analytics side effects are coupled to page rendering instead of committed views

Severity: Medium  
Confidence: Medium  
Category: Likely issue needing runtime validation
Status: Open

Evidence:

- Photo page rendering records a photo view in `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156`.
- Topic page rendering records a topic view in `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`.
- Shared-group rendering records a group view in `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132`.
- The durable insert functions consume the per-IP view-record limiter and write analytics rows in `apps/web/src/app/actions/public.ts:335-348`, `apps/web/src/app/actions/public.ts:371-391`, `apps/web/src/app/actions/public.ts:398-421`, and `apps/web/src/app/actions/public.ts:429-456`.
- The photo UI actively prefetches adjacent photo pages through idle `router.prefetch(...)` in `apps/web/src/components/photo-viewer.tsx:238-264`.
- Navigation hover also prefetches photo pages in `apps/web/src/components/photo-navigation.tsx:220-242`.
- Hidden adjacent-photo links with `prefetch={true}` are rendered in `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:284-292`.

Architectural impact:

Analytics is a domain side effect, but it is currently attached to render evaluation. That boundary is fragile in App Router because render evaluation can happen for navigation preparation, cache fill, RSC payload generation, or bot/access probes that are not equivalent to a user-visible view.

Concrete failure scenario:

Opening one photo causes adjacent routes to be prefetched. If the current Next.js runtime evaluates those server components, rows are inserted for photos the user never opened. The same path spends the in-memory view-record budget, so aggressive prefetching can also suppress later real view records from the same IP for up to a minute.

Suggested fix:

Move view recording to a client-side committed-view boundary or to a tiny public analytics route called from a visibility-aware client effect. If server-side recording remains, make prefetch detection an explicit guard before rate-limit increments and DB writes, backed by a regression that proves prefetching a route does not mutate analytics tables.

## Risks Needing Validation

### ARCH20-RISK-01 - Single-process topology is documented but not runtime-enforced

Severity: Medium  
Confidence: High that the coupling exists; validation needed before changing topology  
Category: Architecture risk
Status: Open

Evidence:

- The shipped Compose file runs one `gallerykit-web` container with host networking in `apps/web/docker-compose.yml:3-21`, but the code has several process-local coordination points.
- Restore maintenance is a `globalThis` flag in `apps/web/src/lib/restore-maintenance.ts:1-56`.
- Upload quota and active-upload checks are a `globalThis` `Map` in `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78`; settings changes consult this local state in `apps/web/src/app/actions/settings.ts:68-79`.
- Admin backfill status is a `globalThis` singleton in `apps/web/src/lib/admin-backfill-runner.ts:144-250`.
- Public share/search/OG and view record limiters include in-memory maps in `apps/web/src/lib/rate-limit.ts:77-121` and `apps/web/src/app/actions/public.ts:46-63`, `apps/web/src/app/actions/public.ts:330-348`.
- Shared-group view count buffering is module-local in `apps/web/src/lib/data.ts:13-41`.
- Queue bootstrap and shutdown draining are process-local lifecycle hooks in `apps/web/src/instrumentation.ts:1-89`.

Why this is a risk, not a confirmed production bug:

The documented deployment appears to run a single web process/container, so these local coordination mechanisms are consistent with the current topology. The risk is that nothing in startup appears to assert that topology. A future scale-out, PM2 cluster, Docker replica, or second app process would silently split restore flags, upload claims, rate-limit budgets, queue ownership, backfill status, and buffered counters across processes.

Concrete failure scenario:

Two app processes are started behind the same reverse proxy. Process A begins a DB restore and sets its local restore-maintenance flag. Process B does not know that flag is active and accepts an upload or runs queue work during the restore window. Similar split-brain behavior can let settings changes pass because `hasActiveUploadClaims()` only sees claims in one process.

Suggested fix:

Choose and enforce one architecture:

- If single-process remains the product contract, add a startup guard such as a DB advisory lease or deployment assertion that fails fast when a second writer process starts. Document the invariant near `instrumentation.ts` and deploy scripts.
- If multi-process support is desired, move these process-local coordination points to shared durable storage or DB advisory locks, and make the queue/backfill workers explicitly lease-owned.

## Non-Findings And Architecture Guardrails Checked

- Migration journal, hash, and reconcile-baseline tests passed, giving evidence that schema migration contracts are not currently drifting.
- Privacy-sensitive read guards are covered by both type and fixture tests.
- Source sweeps of admin API routes, public mutating routes, and server-action files did not surface an obvious wrapper/rate-limit ownership gap; the dedicated lint gates were not run in this turn.
- The current Docker deploy preserves bind-mounted persistence and post-up prune ordering; this review did not find a data-loss issue in the prune policy.

## Missed-Issues Sweep

Final sweep covered routing boundaries, server actions, public API routes, auth/rate-limit source surfaces, ingest/queue/settings contracts, analytics side effects, schema/migration/reconcile, privacy redaction, image processing contracts, and deploy/runtime configuration. I did not intentionally skip any relevant files for the requested code quality, maintainability, layering, architecture, or cross-file contract review angles. Implementation files were not edited.
