# Cycle 15 - Architect Review

Date: 2026-07-07
Role: architect
Repository: `/Users/hletrd/flash-shared/gallery`

## Scope And Method

I followed the required review prompts in `AGENTS.md`, the relevant architecture/security/performance/testing/deploy sections of `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, and `.context/reviews/prompts/architect.md`.

This is a whole-repository architecture/design review focused on boundaries between routes, actions, lib/db, components, scripts, storage, and the documented operational model. I built the inventory first from tracked repository files, then used repo-wide scans plus targeted line-level reads for each architectural surface and every finding below. Tests, comments, and docs were treated as claims to validate from code, not as proof.

## Review Inventory

Inventory basis: `git ls-files`, filtered for architecture-relevant tracked files. Generated build output, binary media/upload fixtures, `node_modules`, and old archived review artifacts were not part of the implementation surface. Prior review summaries were read only as historical context and not treated as evidence.

- Required instructions and docs: `AGENTS.md`, `CLAUDE.md`, `.context/reviews/prompts/common_review_scope.md`, `.context/reviews/prompts/architect.md`.
- Application routes and actions: all tracked TypeScript/TSX under `apps/web/src/app/**`, including public pages, admin pages, API routes, server actions, `proxy.ts`, `instrumentation.ts`, layouts, and metadata/image routes.
- Core library and database layer: all tracked TypeScript under `apps/web/src/lib/**`, `apps/web/src/db/**`, `apps/web/src/auth.ts`, `apps/web/src/env.ts`, and `apps/web/src/server-only.ts`.
- Components: all tracked TypeScript/TSX under `apps/web/src/components/**`, with emphasis on server/client boundaries, action calls, upload/admin flows, and route coupling.
- Scripts and operational code: all tracked JavaScript/TypeScript/shell under `apps/web/scripts/**`, root `scripts/**`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, compose files, nginx config, and topology/deploy helpers.
- Schema and migrations: `apps/web/drizzle/**`, `apps/web/drizzle.config.ts`, and migration reconciliation logic in `apps/web/scripts/migrate.js`.
- Test and quality-contract surface: `apps/web/src/__tests__/**`, `apps/web/e2e/**`, `apps/web/vitest.config.ts`, `apps/web/playwright.config.ts`, `.github/workflows/**`, lint scripts, and package/config files.

Final sweep status: no relevant file in this inventory was intentionally skipped. I examined the full specialty surface through complete inventory scans and targeted reads for routes/actions/lib/db/components/scripts/config interactions.

## Findings Summary

Confirmed Issues:

1. Byte-impacting settings are committed before existing static derivatives match the new policy.
2. The production single-writer invariant is warn-only while multiple correctness mechanisms are process-local.
3. Background image queue and backfill paths independently reserve database capacity and can overrun the documented single-instance resource model.
4. Shared-group read helpers still contain view-count write side effects, crossing the read/write boundary and duplicating the explicit public analytics action.

Likely Issues:

- None. I did not find a strong likely issue that was not already supported enough to classify as confirmed or that did not require live operational validation.

Risks Requiring Manual Validation:

1. Public dynamic route flood protection depends on active host nginx state that the deploy path does not apply or prove.
2. The normal quality workflow does not build the Docker production image even though production native dependency materialization is manually pinned in the Dockerfile.

## Confirmed Issues

### 1. Byte-impacting settings commit ahead of existing derivative bytes

Code regions:

- `apps/web/src/app/actions/settings.ts:168-179` documents that byte-impacting keys other than `image_sizes` have no admission fence and only return a soft signal.
- `apps/web/src/app/actions/settings.ts:193-239` computes `requiresBackfill`, persists the new settings, revalidates caches, and returns success before existing derivatives are regenerated.
- `apps/web/src/lib/settings-hash.ts:1-20` states that the image settings hash is route-handler metadata only and that existing static derivatives must be re-encoded before bytes change.
- `apps/web/src/lib/settings-hash.ts:44-48` defines color-impacting keys such as `force_srgb`, `display_p3`, `jpeg_quality`, `jpeg_chroma_subsampling`, `avif_quality`, and `sharpen_derivatives`.
- `apps/web/src/lib/serve-upload.ts:240-258` attaches the settings hash to route-handler ETags but also notes that static derivative bytes need explicit re-encoding.
- `apps/web/next.config.ts:60-72` gives `public/uploads` static files precedence over the route handler and sets cache headers for those files.
- `apps/web/src/lib/process-image.ts:1187-1198` only replaces derivative files when processing/backfill actually rewrites them.

Why this is a problem:

The admin settings action makes a byte-impacting policy look applied at the application/configuration layer before the static derivative corpus has been regenerated. The route handler can emit settings-aware ETags, but the documented operational model says most existing upload derivatives are static files under `public/uploads`, and `next.config.ts` routes those before `app/uploads`. That creates a split-brain media pipeline: new settings are true in DB/UI/cache invalidation, while old derivative bytes remain the dominant served artifact until a separate backfill finishes.

Concrete failure scenario:

An operator changes `force_srgb`, `display_p3`, `jpeg_quality`, or sharpening to fix delivery quality. The action succeeds and public pages revalidate. New uploads follow the new policy, but existing public derivatives continue to be served from static files encoded with the old policy. Visitors see mixed color/quality behavior across the same gallery, and cache validators do not force static files through the settings-aware route path.

Suggested fix:

Make byte-impacting settings a durable generation transition instead of an immediate global truth. Viable designs:

- Store an active derivative generation/version and do not mark a byte-impacting policy active for existing assets until the generation is complete.
- Write settings-versioned derivative filenames/paths so old and new bytes cannot be confused.
- Route derivative reads through a settings/generation-aware layer until the corpus is re-encoded.
- At minimum, enqueue and track a required backfill job transactionally with the settings update and surface "pending media regeneration" as a first-class state on admin/public diagnostics.

Confidence: High.

### 2. Single-writer production invariant is warn-only while correctness state is process-local

Code regions:

- `apps/web/src/lib/single-writer-guard.ts:6-16` says the guard is intentionally warn-only and cannot be treated as an admission lock.
- `apps/web/src/lib/single-writer-guard.ts:218-235` logs a critical multi-writer topology warning but explicitly continues startup.
- `apps/web/src/instrumentation.ts:22-31` starts the guard with a non-fatal dynamic import and catch handler.
- `apps/web/src/lib/admin-mutation-barrier.ts:11-29`, `apps/web/src/lib/admin-mutation-barrier.ts:41-58`, and `apps/web/src/lib/admin-mutation-barrier.ts:76-91` maintain restore/admin mutation barrier state in process globals.
- `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-78` maintain upload quota/tracker state in process memory.
- `apps/web/src/lib/image-queue.ts:313-340` and `apps/web/src/lib/image-queue.ts:350-357` maintain queue, processing, retry, and embedding cursor state in process memory.
- `apps/web/src/lib/rate-limit.ts:78-110` keeps public route limiter maps in process memory for several important fast paths.

Why this is a problem:

`CLAUDE.md` correctly documents a single web instance / single writer operational model, but the code only warns when that model is violated. Several mechanisms that affect correctness and abuse resistance are process-local. If a second web process/container runs, each process has its own restore barrier, upload tracker, image queue state, and memory-backed rate limits. The database is shared, but the admission and coordination state is not.

Concrete failure scenario:

A deploy, manual recovery, or accidental compose change leaves two `gallerykit-web` instances serving traffic. Both continue after the warn-only guard. One process may enter restore mode while the other still accepts admin mutations. Upload quotas and public rate limits are split by process. Image queue coordination relies on DB locks for per-image processing, but process-local concurrency and embedding cursor state still diverge. The result is a production topology the docs explicitly prohibit, without a hard readiness failure.

Suggested fix:

Choose one architecture and enforce it:

- If single-writer remains the contract, make production startup/readiness fail after persistent lock contention, and include the single-writer state in health/deploy checks.
- If multi-instance should be supported, move correctness-bearing state to shared durable storage: restore/admin barriers, upload quotas, rate-limit buckets, queue cursors, and maintenance locks.
- Keep warn-only behavior only for local development or explicitly documented diagnostic mode.

Confidence: High.

### 3. Background queue and backfill paths independently reserve DB capacity

Code regions:

- `apps/web/src/db/index.ts:21-31` and `apps/web/src/db/index.ts:33-41` set `connectionLimit` and `queueLimit`, with comments tying queue limits to expected backfill usage.
- `apps/web/src/lib/image-queue.ts:121-135` reserves about half the pool for live traffic and computes image-queue concurrency independently.
- `apps/web/src/lib/image-queue.ts:137-153` parses and clamps `QUEUE_CONCURRENCY` inside the image queue only.
- `apps/web/src/lib/admin-backfill-runner.ts:97-128` separately reserves about half the pool for live traffic for backfill.
- `apps/web/src/lib/admin-backfill-runner.ts:130-143` computes the backfill cap independently.
- `apps/web/src/lib/admin-backfill-runner.ts:720-728` starts a backfill `PQueue` from that independent cap.
- `apps/web/src/lib/admin-backfill-runner.ts:324-343` and `apps/web/src/lib/admin-backfill-runner.ts:363-379` use backfill locks that do not coordinate shared background capacity with the upload/image queue.
- `apps/web/src/lib/image-queue.ts:777-785` and `apps/web/src/lib/image-queue.ts:798-835` show image-queue workers doing lock, DB, and processing work concurrently with backfill.
- `apps/web/scripts/backfill-color-pipeline.ts:383-387` allows a sidecar `BACKFILL_CONCURRENCY` default of 2 and max of 8 without sharing the web process pool-budget helper.
- `apps/web/scripts/backfill-color-pipeline.ts:523-570` runs sidecar backfill jobs independently of the in-app queue/backfill resource budget.

Why this is a problem:

Both the image queue and in-app admin backfill reserve capacity as if they are the only background workload. The sidecar backfill has another independent budget. The documented production model is a disk-constrained, single-instance host with a small MySQL pool. Independent "reserve half for live traffic" formulas do not compose when upload processing, admin backfill, and sidecar backfill overlap.

Concrete failure scenario:

An operator starts an admin derivative backfill while uploads are still processing, or runs the sidecar color pipeline during normal traffic. With a pool limit of 10, the image queue can use its own workers, admin backfill can use its own workers, and the sidecar can add another DB client pool. Live SSR/admin requests then queue behind long image-processing transactions or lock polling. The app remains "up" but latency and admin actions degrade sharply, and recovery is operational rather than enforced by architecture.

Suggested fix:

Create one shared background capacity model:

- Centralize background concurrency in a shared helper/semaphore that covers upload image processing, in-app backfill, and any in-process maintenance work.
- Add a DB-visible maintenance/backfill lease so sidecar and web jobs can detect and coordinate heavy work.
- Make aggressive sidecar concurrency require an explicit maintenance-mode flag, and document that it is not safe during normal live traffic.
- Expose background capacity and active maintenance jobs in health/admin diagnostics.

Confidence: High.

### 4. Shared-group reads still have view-count write side effects

Code regions:

- `apps/web/src/lib/data.ts:13-18` and `apps/web/src/lib/data.ts:49-63` define module-level buffered shared-group view increments.
- `apps/web/src/lib/data.ts:1318-1325` exposes `getSharedGroup` with an `incrementViewCount` option that defaults to count behavior.
- `apps/web/src/lib/data.ts:1392-1407` calls `bufferGroupViewCount(group.id)` during the read helper when photos are visible and no selected photo is present.
- `apps/web/src/lib/data.ts:1828-1834` wraps `getSharedGroup` in React `cache()` and warns that the cached helper may also buffer the side effect.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-117` calls `getSharedGroupCached` as part of page rendering.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142` separately calls the public analytics action `recordSharedGroupView`.
- `apps/web/src/app/actions/public.ts:517-558` implements `recordSharedGroupView` as an explicit durable shared-group view action.

Why this is a problem:

The read model for shared groups crosses into write behavior by incrementing denormalized view counts during data access. The route also has a separate explicit analytics action. That splits one user-facing event across two different architectural paths: one hidden inside a cached read helper and one explicit action. It makes read reuse unsafe because callers must know whether a "read" can mutate state.

Concrete failure scenario:

A future metadata route, admin preview, background renderer, or cache-warming path calls `getSharedGroup` without passing `incrementViewCount: false`. It increments `groups.view_count` even though no real public view occurred. Conversely, changing cache behavior or calling the cached helper with different options can alter whether denormalized counters move. The durable `shared_group_views` analytics table and the denormalized counter can drift in ways that are hard to reason about.

Suggested fix:

Make shared-group reads pure. Move denormalized counter updates into the same explicit view-recording service path as `recordSharedGroupView`, or create a single shared function that records both durable analytics and denormalized counters with clear idempotency rules. Keep `getSharedGroupCached` side-effect free.

Confidence: High.

## Likely Issues

None.

## Risks Requiring Manual Validation

### 1. Public dynamic route flood protection depends on active host nginx state not proven by deploy

Code regions:

- Public dynamic pages set `revalidate = 0`, including `apps/web/src/app/[locale]/(public)/page.tsx:19`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:42`, `apps/web/src/app/[locale]/(public)/map/page.tsx:14`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:24`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`, `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:19`, `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:20`, and `apps/web/src/app/[locale]/(public)/topics/[topic]/page.tsx:20`.
- `apps/web/nginx/default.conf:1-10` defines the public route rate-limit zone and related maps.
- `apps/web/nginx/default.conf:274-295` applies the limiter at `location /` and explicitly notes that the template is config-only and deploys do not touch nginx.
- `apps/web/deploy.sh:51-77` builds/starts the Docker app and runs a health check but does not apply or reload nginx.
- `apps/web/deploy.sh:79-104` performs Docker pruning only after app startup.
- `scripts/deploy-remote.sh:31-52` and `scripts/deploy-remote.sh:87-93` execute the remote deploy helper, which defaults to `bash apps/web/deploy.sh`.
- `scripts/check-proxy-topology.mjs:7-16` says it cannot prove the actual client IP bucket used by the edge limiter.
- `scripts/check-proxy-topology.mjs:131-134` reports forwarded-host/proto spoof resistance but labels XFF/client-IP bucket correctness as not verified.

Why this is a risk:

The app intentionally keeps public pages dynamic to reflect processing/admin changes, and `CLAUDE.md` says public flood protection is handled at the nginx edge. The repository includes the nginx template, but the deploy path does not apply it or validate that the live host is using the expected limiter and real-IP behavior. Therefore the architecture depends on external mutable host state that normal deploy verification does not prove.

Concrete failure scenario:

A host is rebuilt, nginx is edited manually, or traffic is routed through a different proxy layer. The Next app deploy succeeds and health checks pass, but public dynamic pages are now reachable without the intended edge rate limit or with all clients collapsed into one proxy bucket. A crawl or burst of map/photo/timeline requests reaches Next/MySQL directly, causing avoidable load on the single-instance host.

Suggested fix:

Close the gap with one of these designs:

- Make deploy responsible for applying/testing the nginx template when the operator opts into managed edge config.
- Add a deploy or health validation step that proves the active limiter and real-client-IP bucket behavior.
- Add a conservative app-layer fallback limiter for expensive public dynamic routes, so correctness does not depend entirely on external nginx state.
- Keep `check-proxy-topology` as a diagnostic, but do not treat it as proof of rate-limit enforcement unless it validates live limiter behavior.

Confidence: Medium for live production impact, High for the repo/deploy validation gap.

### 2. Quality workflow does not build the Docker production image despite manual native dependency pins

Code regions:

- `.github/workflows/quality.yml:54-83` runs install, lint, typecheck, security lint gates, audit, tests, DB init, E2E tests, and `npm run build`, but no Docker build.
- `apps/web/Dockerfile:50-62` manually installs platform-native build dependencies by exact package/version, including `@img/sharp-libvips-linux-${npm_arch}@1.2.4`, `@img/sharp-linux-${npm_arch}@0.34.5`, `@parcel/watcher-linux-${npm_arch}-glibc@2.5.6`, `@swc/core-linux-${npm_arch}-gnu@1.15.43`, `@next/swc-linux-${npm_arch}-gnu@16.2.10`, and `lightningcss-linux-${npm_arch}-gnu@1.32.0`.
- `apps/web/Dockerfile:76-85` repeats production native installs and smoke-tests `require('sharp')`.
- `apps/web/package.json:58-68` and `apps/web/package.json:79-83` declare the source package versions that the Dockerfile pins must continue to match.
- `apps/web/deploy.sh:51-62` runs `docker compose ... up -d --build` on the deploy host, so the Dockerfile is part of the production path even though CI does not exercise it.

Why this is a risk:

The Dockerfile uses an explicit native dependency materialization path that can drift from package updates. The standard quality workflow validates the Next build on the CI runner, but not the actual production image build. Production-only failures are therefore deferred to deploy time on the host.

Concrete failure scenario:

Dependabot or a manual package update changes Next, Sharp, SWC, Lightning CSS, or related optional native dependency versions. CI passes because the workspace build succeeds outside Docker. The deploy host then fails during Docker build or starts an image with mismatched native packages. Because deploy is the first Docker build gate, this becomes an operational outage or rollback event instead of a pre-merge failure.

Suggested fix:

Add a non-publishing Docker image build smoke check to CI for `apps/web/Dockerfile`, including the existing `require('sharp')` runtime smoke. If CI cost is a concern, add a source-contract test that derives the Dockerfile native pins from `package-lock.json` and fails when they drift, then run a scheduled or required Docker build for release branches.

Confidence: Medium for immediate breakage, High for architectural test coverage gap.

## Final Sweep

I performed final architecture-focused checks for commonly missed issue classes:

- Route/action boundary: scanned admin APIs, public APIs, server actions, and origin/auth/rate-limit contracts. No additional unguarded admin mutation route was identified beyond the findings above.
- Server/client boundary: scanned client components for database/server-only imports and server modules for boundary leaks. No new direct DB-to-client import leak was identified.
- Storage/media boundary: scanned storage imports, upload serving, derivative generation, image processing, and quarantine paths. The major architectural gap is the derivative-generation/settings transition captured in Confirmed Issue 1.
- Privacy/public data boundary: scanned public select fields, search enrichment fields, GPS/map allowances, and privacy fixture guards. No additional confirmed public data exposure issue was identified in this architecture pass.
- Operational model: scanned single-writer guard, restore/admin barrier, upload tracker, queue/backfill runners, deploy scripts, nginx, Dockerfile, and CI. The major mismatches are captured in Confirmed Issues 2 and 3 plus the two manual-validation risks.
- Migration/schema boundary: scanned migration files, journal metadata, migration runner, and reconcile paths. I did not find a new confirmed architecture issue beyond the need to keep the documented migration/journal contract enforced.
- Component cohesion: scanned admin/public components for direct operational coupling. No additional cross-layer component issue rose to confirmed or likely status.

No app code, tests, deploy scripts, or configuration files were modified by this review. Only `.context/reviews/architect.md` was written.
