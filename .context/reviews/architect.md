# Cycle 19 Architecture Review

Role: architect lane, prompt 1. Scope is repository-wide architecture/design risk, not implementation.

Validation basis: static review of repository guidance, route/action/API inventory, data/schema/migration layer, queue and image pipeline, auth/session/rate-limit, settings/config, deployment/runtime scripts, tests/gates, and UI/client-server boundaries. No fixes were implemented and no tests were run because this prompt is review-only.

## Architecture Inventory

- Guidance and conventions: `AGENTS.md`, `CLAUDE.md`, `README.md`, root/package workspace scripts, `.context/plans/README.md`, prior aggregate/deferred review notes.
- Routing surface: public localized routes, admin protected routes, public permalink/share/feed routes, sitemap/robots/OpenGraph routes, admin DB/LR APIs, public search/similar/upload APIs, health/live probes.
- Server mutation surface: admin/server actions for images, tags, topics, collections, sharing, users, settings, SEO, embeddings, LR tokens, DB backup/restore, auth; public server actions for pagination, search, analytics/view counts, feeds and shares.
- Data ownership: Drizzle schema and migrations, `reconcileLegacySchema`, privacy projection guards, public/admin query helpers, search enrichment helpers, rate-limit buckets, analytics/view-count side effects.
- Media pipeline: upload admission, original-file persistence, Sharp/image metadata and derivative processing, queue lease/reclaim/shutdown, color/HDR policy, CLIP embedding activation and backfill scripts.
- Runtime/deploy: Next standalone Docker image, host-network compose deployment, bind-mounted mutable data, gitignored deploy env, remote deploy helper, Docker prune policy, instrumentation startup/shutdown hooks, single-writer guard.
- State/config: JSON site config, auth/session cookies, persistent rate-limit state, process-local queues/caches, restore-maintenance state, gallery config versioning/history, storage quarantine.
- Verification gates: ESLint custom scanners, typecheck, build, Vitest suite, Playwright e2e, deploy contract tests, migration/hash/post-condition tests, privacy and client/server boundary tests.
- UI boundaries: server/client component split, admin shared components, map/client components, upload/admin forms, public gallery/search/feed surfaces.

## Findings

### ARCH19-01 - Large upload and restore ingress still depends on framework-level full body materialization

Severity: High  
Confidence: High  
Status: Confirmed

Evidence:
- Browser uploads are handled as a Server Action and immediately read `FormData` files in `apps/web/src/app/actions/images.ts:129` and `apps/web/src/app/actions/images.ts:148`. Size/quota checks occur later at `apps/web/src/app/actions/images.ts:239`.
- The global Server Action body cap is intentionally large in `apps/web/next.config.ts:111`.
- Lightroom uploads perform useful route-level admission and a one-slot parser gate at `apps/web/src/app/api/admin/lr/upload/route.ts:60`, `apps/web/src/app/api/admin/lr/upload/route.ts:101`, and `apps/web/src/app/api/admin/lr/upload/route.ts:160`, but still call `await request.formData()` at `apps/web/src/app/api/admin/lr/upload/route.ts:180`.
- DB restore documents the same limitation: Next may accept a larger request body before application code rejects it in `apps/web/src/app/[locale]/admin/db-actions.ts:378`, then the action receives a `FormData` file at `apps/web/src/app/[locale]/admin/db-actions.ts:385` and `apps/web/src/app/[locale]/admin/db-actions.ts:663`.

Risk and failure scenario:
Application-level streaming and quota checks happen after Next has already accepted and materialized large multipart bodies into `File` objects. A few concurrent browser uploads, Lightroom uploads, or restore attempts can spike memory/tmp usage on the small single-host deployment before the app reaches its own size, quota, restore-maintenance, or queue-admission logic. The LR route reduces concurrency for parsing, but it does not remove framework buffering risk; browser upload and restore have the larger architectural issue because they are Server Actions.

Suggested fix:
Move all large multipart ingress to streaming Route Handlers or a dedicated upload/restore ingress module with shared admission, content-length enforcement, and a process-wide large-body semaphore before parsing. Keep Server Actions as thin UI command surfaces that request preflight/upload sessions, not as the body transport. Reuse the LR route's route-admission ordering, but replace `request.formData()` with a streaming multipart parser or direct object/file stream path.

### ARCH19-02 - Semantic and similar search do request-local full vector scans

Severity: High  
Confidence: High  
Status: Confirmed

Evidence:
- Semantic search loads candidate embeddings, decodes each vector, computes cosine similarity, sorts, and slices in the request path at `apps/web/src/app/api/search/semantic/route.ts:263`.
- Similar-image search performs the same bounded decode/scan/sort pattern at `apps/web/src/app/api/search/similar/[id]/route.ts:177`.
- The architecture notes describe CLIP search as opt-in and bounded, but still production-accessible once enabled.

Risk and failure scenario:
Every semantic or similar request does CPU-heavy vector decode and scoring work inside the Next request process. The scan limit makes the risk bounded, but not isolated: concurrent search requests can compete with uploads, admin actions, health checks, and page rendering in the same container. As the gallery grows or CLIP is enabled by default, search latency and general app responsiveness can degrade together rather than failing in an isolated worker/service.

Suggested fix:
Move vector search behind a dedicated search owner: a vector index, sidecar service, background-built in-memory matrix with generation-based invalidation, or an explicit worker queue with concurrency caps. Keep the API route as admission/authorization/result-shaping only. If staying in-process for now, cache decoded vectors by embedding generation and enforce a shared concurrency budget separate from normal request handling.

### ARCH19-03 - Public map renders up to 10,000 markers client-side in one payload

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- The map query loads up to `MAP_MAX_MARKERS + 1`, slices to 10,000 markers, and includes a comment that clustering/viewport fetches are future work in `apps/web/src/lib/data.ts:1766`.
- The client computes bounds over all coordinates at `apps/web/src/components/map/map-client.tsx:77`.
- The client renders one React Leaflet `<Marker>` per marker at `apps/web/src/components/map/map-client.tsx:120`.

Risk and failure scenario:
The map architecture couples one server query, one JSON payload, one client bounds pass, and one React component tree to the full public geotagged corpus. A personal-scale library may be acceptable, but a large imported archive can produce slow initial page loads, high hydration cost, and browser jank without tripping server tests. The `hasMore` flag acknowledges truncation, but users still receive the heaviest possible client payload before any viewport filtering.

Suggested fix:
Introduce viewport-bounded marker APIs and server-side clustering or tile buckets. Render clusters/visible markers only, fetch on map movement, and preserve the existing 10,000 cap as an emergency ceiling rather than the primary shape. If full-corpus loading remains necessary, use a non-React marker layer or canvas/WebGL layer and progressive chunking.

### ARCH19-04 - Restore quiescence does not clearly own public rate-limit DB writes

Severity: Medium  
Confidence: Medium  
Status: Likely

Evidence:
- Restore declares a process-local drain checklist and warns that every process-local DB writer must be accounted for in `apps/web/src/app/[locale]/admin/db-actions.ts:547`.
- The restore drain covers image queue, shared group-count flushes, tracked background DB writes, maintenance sweeps, and admin mutations at `apps/web/src/app/[locale]/admin/db-actions.ts:553`.
- Public actions check restore-maintenance at entry, then later perform persistent rate-limit writes or checks, for example `loadMoreImages` at `apps/web/src/app/actions/public.ts:132` and `apps/web/src/app/actions/public.ts:157`, semantic search at `apps/web/src/app/actions/public.ts:247` and `apps/web/src/app/actions/public.ts:293`, and view-record flows at `apps/web/src/app/actions/public.ts:443`.
- Persistent rate-limit writes update `rate_limit_buckets` in `apps/web/src/lib/rate-limit.ts:480`, while the background-write tracker currently covers named background operations in `apps/web/src/lib/background-db-writes.ts:42`.

Risk and failure scenario:
The restore flow is careful about known writers, but public request side effects can pass the maintenance check before restore becomes active and then reach rate-limit DB writes while restore is importing or immediately after it drains tracked writers. The most likely outcome is noisy restore-time DB errors or rate-limit state being written against a transient/restored schema snapshot; the deeper issue is that side-effect ownership is split between public actions, rate-limit helpers, and restore quiescence rather than centralized.

Suggested fix:
Make persistent rate-limit writes participate in the same restore quiescence boundary as analytics/background writes, either by registering them with a foreground/public DB activity tracker or by making the rate-limit storage layer restore-aware and no-op/short-circuit during maintenance. Consider a second maintenance gate immediately before any persistent public side effect, not only at action entry.

### ARCH19-05 - Docker native optional dependency pins are only partially lockfile-guarded

Severity: Low  
Confidence: High  
Status: Confirmed

Evidence:
- The Docker build manually installs native optional packages and versions for Sharp, Parcel watcher, SWC, Next SWC, and Lightning CSS in `apps/web/Dockerfile:50`.
- The production dependency stage separately pins Sharp native packages in `apps/web/Dockerfile:76`.
- The deploy contract test asserts all build-stage native install tokens have explicit versions, but only lockfile-compares tokens matching `@next`/`@swc` in `apps/web/src/__tests__/deploy-script-contract.test.ts:258`.
- The production-stage test asserts literal Sharp versions at `apps/web/src/__tests__/deploy-script-contract.test.ts:286`, not that they match `package-lock.json`.

Risk and failure scenario:
The current Dockerfile pins match the lockfile, but the guard is incomplete. A future Next, Sharp, Parcel, or Lightning CSS upgrade can update `package-lock.json` while leaving a stale Dockerfile pin that still passes most deploy contract tests. The failure would surface later as a container build error, missing native binding, architecture-specific runtime crash, or a production-only mismatch after `npm ci --omit=dev --omit=optional`.

Suggested fix:
Extend the deploy contract test to parse every manually installed native package token, substitute both supported `npm_arch` values where needed, and compare all package versions against `package-lock.json`. Replace literal version assertions with lockfile-derived assertions for both build and production stages.

## Manual-Validation Risks

- Production topology assumptions are well documented as single-host/single-writer and process-local. I did not validate the live host, nginx proxy, CLIP weights, deploy env, or currently running container state.
- Playwright/browser-flow coverage exists, but this review did not run desktop/mobile browser checks or admin credentialed flows.
- The storage backend abstraction is intentionally quarantined and not wired into the live image pipeline; I did not treat that as a finding because `apps/web/src/lib/storage/index.ts` and the storage quarantine tests make the boundary explicit.

## Final Sweep

Categories examined: repository guidance, package scripts, app routing, layouts/pages, server actions, API routes, data projections and privacy guards, schema/migrations/reconciliation, image upload/processing/queue, CLIP and search, auth/session/origin/rate-limit, restore/backup, deploy scripts, Docker/compose, runtime instrumentation, settings/site config, tests/gates, client/server boundary enforcement, admin/public UI component boundaries, map rendering, and storage quarantine.

No source category from the requested architecture inventory was intentionally skipped. Live infrastructure validation, production data inspection, and dynamic browser/runtime testing were outside this review-only lane.
