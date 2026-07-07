# Cycle 13 - Architect Review

Date: 2026-07-07
Reviewer: architect

Scope: read-only architecture/design review across layering, coupling, server/client boundaries, DB schema and migration design, caching, auth boundaries, deployment/ops architecture, and long-term maintainability. I edited only this review artifact. I did not modify source code, plans, migrations, runtime config, services, production data, commits, or deploy state.

## Inventory

I first read the workspace instructions (`AGENTS.md` from the prompt plus repository `AGENTS.md`) and `CLAUDE.md`, then built an architecture inventory before tracing cross-file contracts.

Reviewed inventory:

- Project contract/docs: `AGENTS.md`, `CLAUDE.md`, `apps/web/README.md`, root and app `package.json`, prior `.context/reviews/*` architecture history.
- App Router boundaries: public dynamic pages under `apps/web/src/app/[locale]/(public)`, admin pages/actions under `apps/web/src/app/[locale]/admin`, public/admin API route surfaces under `apps/web/src/app/api`, `proxy.ts`, metadata/OG/feed/share routes.
- Auth and request guards: `app/actions/auth.ts`, `lib/api-auth.ts`, `lib/action-guards.ts`, `lib/request-origin.ts`, `lib/auth-rate-limit.ts`, `lib/rate-limit.ts`, guard lint scripts, client/server-only boundary tests, privacy tests.
- Data/schema/migrations: `src/db/schema.ts`, `src/db/index.ts`, `drizzle.config.ts`, `drizzle/*.sql`, `drizzle/meta/_journal.json`, `scripts/migrate.js`, migration/reconcile/source-contract tests, restore scan tests.
- Media/caching/storage: upload actions, Lightroom upload route, `lib/process-image.ts`, `lib/image-queue.ts`, `lib/serve-upload.ts`, `lib/settings-hash.ts`, `lib/revalidation.ts`, `next.config.ts`, upload path helpers, service-worker/cache-related contracts, experimental `lib/storage/*`.
- Runtime/ops: `Dockerfile`, `docker-compose.yml`, `deploy.sh`, `nginx/default.conf`, `instrumentation.ts`, single-writer guard, restore maintenance durable marker, admin mutation barrier, background DB writes, maintenance scheduler, queue shutdown, CLIP preflight/ops contracts.

Final sweep performed: searched for architecture-risk markers (`TODO`, `FIXME`, `defer`, `experimental`, `manual`, `warn-only`, `process-local`, `single`, `operator`), public `revalidate = 0` pages, direct filesystem writes, cache/ETag contracts, migration journal/reconcile contracts, public/admin guard lint surfaces, and prior architect findings. No architecture-relevant file from the inventory above was intentionally skipped; leaf UI components were inspected only where they participated in server/client, privacy, cache, or auth boundaries.

Validation performed: static architecture review with source/doc cross-checks. I did not run lint, typecheck, unit tests, build, e2e, production probes, deploy, commit, or push because this lane is review-only and no application behavior was changed.

## Findings Summary

- Critical: 0
- High: 0
- Medium: 3
- Low: 2

## Findings

### ARCH-C13-01 - Byte-impacting settings still commit ahead of derivative generation

Severity: Medium
Confidence: High

File/line region:
- `apps/web/src/app/actions/settings.ts:168-226`
- `apps/web/src/app/actions/settings.ts:236-239`
- `apps/web/src/lib/settings-hash.ts:14-19`
- `apps/web/src/lib/serve-upload.ts:252-258`
- `apps/web/next.config.ts:56-72`
- `apps/web/src/lib/process-image.ts:1187-1198`

Issue:
Settings that change derivative bytes are written to `admin_settings` immediately. The action returns only a soft `requiresBackfill` signal and revalidates app data, while existing derivatives under `public/uploads` continue to be served by Next static file handling with unchanged filenames and old bytes until a separate re-encode rewrites them. The settings hash protects the route-handler fallback ETag, but the code itself documents that existing static derivatives still need a re-encode.

Concrete failure scenario:
An admin changes `force_srgb_derivatives`, JPEG/AVIF quality, chroma, AVIF effort, or another byte-impacting setting after photos exist. Public pages, admin settings, and future uploads now reflect the new policy, but visitors mostly receive derivatives encoded under the old policy from static `/uploads` paths. A photographer-facing color or quality fix can look applied in configuration while delivered image bytes remain stale until an operator notices and completes backfill.

Suggested fix:
Make derivative generation versioned and durable. Prefer content-addressed or settings-versioned derivative filenames, or route all derivatives through a settings-version-aware serving layer. At minimum, persist a `derivative_generation_version`/pending-backfill state and have the settings action enqueue or require completion before presenting the new byte policy as fully applied.

### ARCH-C13-02 - Single-writer correctness remains warn-only while state is process-local

Severity: Medium
Confidence: High

File/line region:
- `apps/web/src/lib/single-writer-guard.ts:7-16`
- `apps/web/src/lib/single-writer-guard.ts:218-235`
- `apps/web/src/instrumentation.ts:22-31`
- `apps/web/src/lib/admin-mutation-barrier.ts:11-29`
- `apps/web/src/lib/upload-tracker-state.ts:15-20`
- `apps/web/src/lib/upload-tracker-state.ts:70-78`
- `apps/web/src/lib/image-queue.ts:312-333`
- `apps/web/src/lib/image-queue.ts:349-365`
- `apps/web/src/lib/rate-limit.ts:78-99`
- `apps/web/src/lib/rate-limit.ts:393-415`

Issue:
The application documents and detects a single-web-instance topology, but detection is non-fatal. Startup continues after advisory-lock contention, and the guard is fire-and-forget. Multiple correctness-relevant mechanisms remain process-local: restore mutation barrier, upload quota tracking, image queue state/cursors, permanently failed processing IDs, and several rate-limit fast paths.

Concrete failure scenario:
A manual Docker command, blue/green rollout, or recovery attempt starts two `gallerykit-web` processes against the same writable database. Both continue serving. Upload quotas split by process, in-memory public limiter budgets multiply, queue retry/permanent-failure state diverges, and restore/admin mutation fences only protect each process's own in-flight work. Operators get a log warning, but the misconfiguration can still write inconsistent state.

Suggested fix:
Add an enforcing production mode, for example `GALLERYKIT_ENFORCE_SINGLE_WRITER=true`, that fails readiness or exits after persistent singleton-lock contention. Longer term, move correctness state to DB/advisory-lock-backed coordination and keep only explicitly lossy caches in memory. Health output should include singleton-lock state so deploy automation can reject split-brain topology.

### ARCH-C13-03 - Public dynamic-page flood protection depends on manually applied nginx state

Severity: Medium
Confidence: High

File/line region:
- `apps/web/src/app/[locale]/(public)/page.tsx:17-19`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:20`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:40-42`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:24`
- `apps/web/nginx/default.conf:1-10`
- `apps/web/nginx/default.conf:20-29`
- `apps/web/nginx/default.conf:274-295`
- `apps/web/deploy.sh:51-77`

Issue:
The broad public page surface is dynamic (`revalidate = 0`) and multi-query. The only broad navigation-level limiter is in the committed nginx template, and that template states it is config-only and must be applied/reloaded manually. The normal deploy path rebuilds/restarts Docker and verifies container health, but it does not apply or verify the host nginx limiter/real-IP posture.

Concrete failure scenario:
A host misses the latest nginx template, nginx is not reloaded after a repo update, or the app moves behind a different load balancer/CDN. Public page floods then reach Next/MySQL without the intended navigation-level backstop. In the opposite direction, an LB-fronted topology without realip configuration can collapse all visitors into one nginx bucket and cause broad 429s.

Suggested fix:
Either bring nginx config application and `nginx -t`/reload/probe into the deploy topology, or add an app-layer fallback limiter for public dynamic pages. If edge-only remains the design, add a deploy or health check that proves the active proxy applies the expected limiter and real-IP contract.

### ARCH-C13-04 - Shared-group reads own one half of the view-recording contract

Severity: Low
Confidence: High

File/line region:
- `apps/web/src/lib/data.ts:13-18`
- `apps/web/src/lib/data.ts:49-63`
- `apps/web/src/lib/data.ts:1318-1407`
- `apps/web/src/lib/data.ts:1805-1809`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`
- `apps/web/src/app/actions/public.ts:517-558`

Issue:
`getSharedGroup()` is a read helper, but by default it buffers a denormalized `shared_groups.view_count` increment. The public page separately calls `recordSharedGroupView()` for durable analytics. That means shared-group view semantics are split between a data accessor and an explicit analytics action, and React `cache()` argument/call-order behavior becomes part of the counting contract.

Concrete failure scenario:
A future metadata route, admin preview, crawler validation path, or background checker imports `getSharedGroupCached()` for convenience and accidentally increments `view_count` without a real public shared-gallery view. A future render path that calls the cached helper with different `incrementViewCount` semantics can make the count depend on which call reaches `cache()` first in that request.

Suggested fix:
Make shared-group retrieval pure. Move the denormalized counter update into an explicit view-recording service beside `recordSharedGroupView()`, and have the public page make one counting decision after resolving `selectedImage`. Cache only the pure read helper.

### ARCH-C13-05 - Docker native dependency pins can drift from package versions

Severity: Low
Confidence: High

File/line region:
- `apps/web/Dockerfile:50-62`
- `apps/web/Dockerfile:76-85`
- `apps/web/package.json:58-68`
- `apps/web/package.json:79-83`
- `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:13-18`

Issue:
The Dockerfile manually installs Linux-native optional packages with exact versions for Sharp, SWC, Next SWC, Parcel watcher, and lightningcss. These versions currently match the app dependency graph, but the lock is maintained by convention. The ops contract test pins the base image digest, not the native-package parity between Dockerfile and `package.json`/lockfile.

Concrete failure scenario:
A future dependency update bumps `next`, `sharp`, `@swc/core`, or related tooling in `package.json`/`package-lock.json`, but the Dockerfile workaround pins remain stale. Local tests can pass on macOS while container builds or runtime image processing fail on Linux due to mismatched native binary/package versions.

Suggested fix:
Derive the explicit native install versions from the lockfile/package metadata during the Docker build, or add a source-contract test that fails when Dockerfile native pins drift from the resolved app dependency versions. If npm optional dependency handling is now reliable for the target build matrix, retire the manual pins and rely on `npm ci --include=optional` plus the existing runtime `node -e "require('sharp')"` smoke check.

## Final Sweep

I found no Critical or High architecture issues in this pass.

Areas checked without new findings:

- Auth boundary: admin API exports are structurally wrapped, mutating server actions have same-origin guards, PAT Lightroom upload has scoped auth and upload-contract locking, and public expensive API routes are covered by linted rate-limit contracts.
- DB schema/migrations: schema, migration journal, reconcile logic, restore import validation, and migration coverage tests have explicit contracts. I did not find new migration drift.
- Restore/deployment safety: restore now drains shared-group buffers, image queue, tracked background DB writes, maintenance sweeps, and admin mutations before import. The remaining risk is the broader single-process topology, captured above.
- Storage/media: original privacy, derivative atomic replacement, static serving precedence, and experimental storage abstraction were checked. The live pipeline has stronger atomicity than the experimental storage layer, but I did not count that separately this cycle because the source currently marks the storage abstraction as not wired into production paths.
- Server/client layering: reviewed server-only DB/auth helpers, public page server components, client/server boundary tests, and privacy projection tests. No new server/client import leak found.
