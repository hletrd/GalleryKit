# Architect Review - Cycle 16/100

## Scope

- Reviewed HEAD: `7506661e247ee63680b547ed89a1e8462883b2e8`.
- Review mode: architecture lane, current HEAD only.
- Write scope: this report only.
- Existing unrelated worktree changes observed in other review reports were not inspected as source of truth and were not modified.
- Validation: repository inventory, whole-tree source/config/script scans, targeted full reads of boundary-owning modules, and a final missed-issues sweep. No test suite was run because this is a review-only artifact.

## Inventory Summary

No sampling was used for inventory. Every tracked path at HEAD was enumerated, then architecture-relevant surfaces were classified and scanned for route/action boundaries, server/client layering, storage access, upload/queue flows, migrations, deployment topology, and cross-cutting guards.

Key architecture surfaces:

- Application routes and server actions: `apps/web/src/app/**` (77 files), including public gallery pages, admin pages, public API routes, admin API routes, upload actions, smart-collection actions, sitemap/feed routes, and search endpoints.
- UI components: `apps/web/src/components/**` (57 files), with server/client boundary checks around imports from data and configuration modules.
- Domain and infrastructure libraries: `apps/web/src/lib/**` (96 files), including data access, queueing, upload contracts, rate limiting, CLIP embeddings, smart collections, image processing, analytics, caching, validation, and auth/session helpers.
- Database schema and connection layer: `apps/web/src/db/**` (3 files).
- Migrations and migration metadata: `apps/web/drizzle/**` (31 files), including `_journal.json` and SQL migration history.
- Operational scripts and deployment: `apps/web/scripts/**` (27 files), `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `next.config.ts`, and package manifests.
- Automated coverage inventory: `apps/web/src/__tests__/**` (267 files) and `apps/web/e2e/**` (8 files), used to understand enforced architectural contracts such as privacy guards, auth wrappers, route rate-limit checks, and touch-target rules.
- Project context and historical plans/reviews: `.context/**` (1755 files) was inventoried for process context; current review findings are based on HEAD source files, not prior review conclusions.

Primary boundary files inspected in detail:

- Data/read model: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/analytics-data.ts`, `apps/web/src/lib/view-retention.ts`.
- Write paths: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/actions/settings.ts`, `apps/web/src/app/actions/collections.ts`, `apps/web/src/app/actions/public.ts`.
- Upload and processing: `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/upload-tracker.ts`, `apps/web/src/lib/upload-processing-contract-lock.ts`, `apps/web/src/instrumentation.ts`.
- Search: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `apps/web/src/lib/clip-embeddings.ts`, `apps/web/src/lib/clip-model.ts`.
- Schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/src/db/index.ts`, `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`.
- Runtime/deploy: `apps/web/next.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/src/proxy.ts`.

## Confirmed Issues

### ARCH-16-01 - Smart-collection AST breadth is unbounded and can amplify public request cost

- Severity: Medium
- Confidence: High
- Code regions:
  - `apps/web/src/lib/smart-collections.ts:142-145` defines `MAX_DEPTH` and `MAX_IN_VALUES`, but no maximum children per group, total AST nodes, compiled predicates, or serialized query size.
  - `apps/web/src/lib/smart-collections.ts:165-178` compiles every group child and spreads all generated clauses into `drizzleAnd(...clauses)` / `drizzleOr(...clauses)`.
  - `apps/web/src/lib/smart-collections.ts:416-421` validates group children only for being a non-empty array, then recursively validates every child.
  - `apps/web/src/app/actions/collections.ts:32-50` and `apps/web/src/app/actions/collections.ts:83-98` persist `query_json` after `parseSmartCollectionQuery` without breadth or byte-size enforcement.
  - `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:86-101` reparses and compiles the stored query during unauthenticated public page rendering.
  - `apps/web/src/app/actions/public.ts:203-218` repeats the parse/compile/query path for public smart-collection load-more requests.

Failure scenario:

An admin, or anyone who compromises an admin session, can create a smart collection whose JSON fits in the database `TEXT` column but contains thousands of sibling predicates in a single `and` or `or` group. The current depth cap prevents deeply nested recursion and the `in` cap prevents one large `in` list, but neither cap limits breadth. Each unauthenticated request to the collection page or load-more action then parses the large JSON, recursively compiles every predicate, creates a very large SQL expression, and asks MySQL to plan and execute it. A single admin-authored object can therefore become a public CPU and database planner amplifier.

Suggested fix:

Add explicit structural limits to the smart-collection query contract:

- `MAX_CHILDREN_PER_GROUP`, enforced before recursively validating children.
- `MAX_AST_NODES` or `MAX_PREDICATES`, counted across the whole tree during validation.
- `MAX_QUERY_JSON_BYTES`, enforced in create/update actions before persistence.
- Regression tests for create/update rejection, parser error shape, and public route/load-more behavior with the maximum accepted query.

Keep these limits in `apps/web/src/lib/smart-collections.ts` so all writers and readers share the same contract. If future smart collections need very large boolean expressions, store normalized clauses and precomputed membership rather than compiling unbounded JSON into public-request SQL.

## Likely Issues

No likely architecture issues were found beyond the confirmed smart-collection breadth gap. The remaining items below are manual-validation risks because current HEAD has explicit constraints or documentation that make them acceptable under the documented single-instance personal-gallery topology.

## Manual-Validation Risks

### MVR-16-01 - Process-local coordination assumes exactly one active web process

- Severity if topology changes: Medium
- Confidence: High
- Code regions:
  - `apps/web/docker-compose.yml:11-16` defines a single `gallerykit-web` service instance for the deployed app.
  - `apps/web/src/lib/image-queue.ts:76-90` and `apps/web/src/lib/image-queue.ts:275-325` keep queue status, active job IDs, processed IDs, and retry state in process memory.
  - `apps/web/src/lib/data.ts:13-35` buffers shared-group view-count increments in process memory before flushing to MySQL.
  - `apps/web/src/lib/upload-tracker-state.ts:7-20` and `apps/web/src/lib/upload-tracker-state.ts:70-79` track active upload claims in process memory.
  - `apps/web/src/lib/rate-limit.ts:112-121` uses an in-memory fast path ahead of durable rate-limit persistence.

Risk scenario:

The design is coherent for the documented single-web-container deployment, and several operations also use database locks or durable tables. If the app is horizontally scaled without an architecture change, status visibility, upload-setting locks, retry bookkeeping, buffered counters, and rate-limit fast paths can diverge across processes. That would produce inconsistent admin status, premature setting changes during uploads on another worker, duplicate or missing transient queue state, or weaker burst limiting.

Suggested validation/fix:

Before adding replicas, externalize these coordination points to MySQL or Redis, or add an explicit deployment guard that fails startup when multiple web instances are configured without a distributed coordination backend. Keep the current single-instance assumption documented in deployment runbooks.

### MVR-16-02 - Semantic search remains a bounded brute-force architecture

- Severity if data or caps grow: Medium
- Confidence: Medium
- Code regions:
  - `apps/web/src/lib/clip-embeddings.ts:36-44` allows `SEMANTIC_SCAN_LIMIT` up to 25,000.
  - `apps/web/src/app/api/search/semantic/route.ts:261-305` loads a capped embedding candidate set and scores it in the request path.
  - `apps/web/src/app/api/search/similar/[id]/route.ts:143-176` uses the same request-path scoring pattern for similar-image search.
  - `apps/web/src/lib/clip-model.ts:53-70` constrains local CLIP inference concurrency but still runs model inference in the web runtime.

Risk scenario:

Current HEAD has rate limits, mode gates, scan caps, and concurrency caps, so this is not a confirmed defect. The architecture is still linear-scan search inside the web request path. If production image count, embedding count, scan caps, or inference concurrency are raised without load testing, search latency and Node CPU pressure can degrade regular gallery traffic.

Suggested validation/fix:

Keep the current caps conservative unless production profiling proves headroom. If semantic search becomes a primary workflow or the corpus grows materially, move vector ranking to a dedicated vector index/service or a precomputed nearest-neighbor table rather than raising brute-force scan limits.

### MVR-16-03 - Dockerfile native package pins are coupled to package versions by convention

- Severity if dependencies are upgraded without the Dockerfile: Low
- Confidence: Medium
- Code regions:
  - `apps/web/Dockerfile:50-56` explicitly installs native production packages such as `@next/swc-linux-x64-gnu@16.2.9`, `@swc/core-linux-x64-gnu@1.15.41`, and `@img/sharp-linux-x64@0.34.5`.
  - `apps/web/package.json:35-43` currently declares matching application-level Next.js, Sharp, and related package versions.

Risk scenario:

Current HEAD appears internally consistent. The risk is architectural coupling: dependency upgrades in `package.json` or `package-lock.json` can silently diverge from the explicit native package versions in the Dockerfile. That can produce container-only build/runtime failures or native binary mismatches even when local install and typecheck pass.

Suggested validation/fix:

Add a lightweight CI/script check that compares Dockerfile native pins against `package-lock.json`, or derive the native package install versions from the lockfile during the Docker build. Keep explicit pins only if the version-sync check is enforced.

## Final Missed-Issues Sweep

Final sweep checks performed across HEAD:

- Server/client boundary scan: checked `"use client"` files for direct imports from server-only data, database, filesystem, auth, and image-processing modules. No confirmed boundary violation found.
- Admin API boundary scan: checked admin API handlers against `withAdminAuth(...)` expectations and existing lint coverage. No confirmed gap found.
- Mutating public route scan: checked public `POST`/`PUT`/`PATCH`/`DELETE` routes for durable pre-increment rate-limit helpers or explicit exemptions. No confirmed gap found.
- Server-action origin scan: checked mutating server actions for same-origin admin guards where required. No confirmed gap found.
- Privacy/select-shape scan: checked public data selection patterns and privacy guard tests around admin-only columns. No confirmed leak found.
- Upload/settings interaction scan: checked browser upload, Lightroom upload, upload tracker claims, and upload-processing contract lock interactions. No confirmed race beyond the documented single-process manual-validation risk.
- Queue/bootstrap/shutdown scan: checked instrumentation bootstrap, advisory locks, retry state, derivative generation, and graceful shutdown. No confirmed architecture issue under the current single-instance deployment.
- Migration/schema scan: checked schema, migration journal, reconcile baseline, and migration post-condition assertion. No confirmed migration architecture issue found.
- Cache/revalidation scan: checked gallery config, smart collections, image mutations, and public load-more/search flows for obvious stale boundary violations. No additional confirmed issue found.
- Deployment/topology scan: checked Next standalone config, nginx upload/body limits, Docker build strategy, docker-compose service shape, and deploy helper. No confirmed issue beyond the native-pin drift risk.

Stop condition reached: one confirmed architecture issue was identified with exact code regions and fix direction; likely issues were not found; manual-validation risks were documented separately from confirmed defects.
