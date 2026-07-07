# Cycle 20 Architecture Review

Role: architect lane. Scope: repository-wide architecture/design review of module boundaries, layering, state ownership, Next.js App Router structure, data access, background jobs, migrations, deploy/runtime topology, PWA/service worker, UI component architecture, storage abstraction, and documented product boundaries.

Validation basis: static source review after reading `AGENTS.md`, `CLAUDE.md`, and product docs. I did not modify source code and did not run the full quality gates because this lane is review-only. The worktree already had concurrent `.context/reviews/*.md` edits; this report only replaces `.context/reviews/architect.md`.

## Architecture Inventory

Tracked repository size: 3,511 tracked files.

Architecture-relevant inventory examined:

- Guidance/product/deploy docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `apps/web/README.md`, `docs/superpowers/**`, `plan/**`, `.context/plans/**`, prior `.context/reviews/**` for known boundary history.
- Package/config/runtime: root `package.json`, `package-lock.json`, `apps/web/package.json`, `next.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `tailwind.config.ts`, `components.json`.
- App Router surface: all 80 `apps/web/src/app/**/*.{ts,tsx}` files, including localized public pages, admin layouts/pages, API routes, metadata routes, upload route handlers, and server actions.
- Shared app code: all 114 `apps/web/src/lib/*.ts` files plus `apps/web/src/lib/storage/*`, all `apps/web/src/db/*.ts`, all `apps/web/src/i18n/*.ts`, and all 61 `apps/web/src/components/**/*.{ts,tsx}` files.
- Persistence and migrations: `apps/web/src/db/schema.ts`, all 30 SQL migrations, 3 Drizzle meta files, `drizzle.config.ts`, and `apps/web/scripts/migrate.js`.
- Operational scripts/topology: all 31 files under `apps/web/scripts/` and root `scripts/`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`.
- PWA/static runtime: `apps/web/public/sw.template.js`, generated `sw.js`, `histogram-worker.js`, PWA icon/manifest routes, and `src/lib/sw-cache.ts`.
- Test contracts reviewed for architecture coverage: all 357 `apps/web/src/__tests__/*.test.ts` names and architecture/security/source-contract tests where relevant, plus all 10 Playwright specs in `apps/web/e2e/`.

## Files Examined

Primary detailed reads included these architecture centers:

- Upload and restore: `app/actions/images.ts`, `app/api/admin/lr/upload/route.ts`, `app/[locale]/admin/db-actions.ts`, `lib/upload-limits.ts`, `lib/upload-tracker-state.ts`, `lib/upload-processing-contract-lock.ts`, `lib/process-image.ts`, `lib/image-queue.ts`, `lib/admin-backfill-runner.ts`.
- Data access and public discovery: `lib/data.ts`, `app/actions/public.ts`, `lib/smart-collections.ts`, `app/[locale]/(public)/c/[slug]/page.tsx`, `app/api/search/semantic/route.ts`, `app/api/search/similar/[id]/route.ts`, `lib/clip-embeddings.ts`.
- Routing/security/layering: `src/proxy.ts`, `lib/api-auth.ts`, `lib/action-guards.ts`, `scripts/check-api-auth.ts`, `scripts/check-action-origin.ts`, `scripts/check-public-route-rate-limit.ts`.
- Schema and migrations: `db/schema.ts`, `scripts/migrate.js`, `drizzle/meta/_journal.json`, all migration SQL files, migration/source-contract tests.
- Runtime/deploy: `instrumentation.ts`, `lib/single-writer-guard.ts`, `lib/maintenance-scheduler.ts`, `lib/restore-maintenance*`, `docker-compose.yml`, `deploy.sh`, `nginx/default.conf`.
- UI/PWA/storage boundaries: public/admin page trees, `components/home-client.tsx`, `components/map/*`, `components/search.tsx`, `components/register-service-worker.tsx`, `public/sw.template.js`, `lib/sw-cache.ts`, `lib/storage/*`, `__tests__/storage-quarantine.test.ts`.

## Confirmed Issues

### ARCH20-01 - Browser and PAT uploads duplicate one ingest transaction contract

Severity: High
Confidence: High
Classification: confirmed issue

Exact region:

- Browser upload admission, topic/config lookup, quota claim, original save, metadata insert, queue payload, audit, and revalidation: `apps/web/src/app/actions/images.ts:129-653`.
- PAT/Lightroom upload admission, multipart parsing, quota claim, topic/config lookup, original save, metadata insert, queue payload, audit, and revalidation: `apps/web/src/app/api/admin/lr/upload/route.ts:84-634`.

Failure scenario:

A future upload-time invariant is added to one path and missed in the other: a new privacy setting, processing snapshot property, color/HDR field, alt-text field, restore fence, queue payload field, audit field, or cleanup branch. The comments show this has already been a recurring maintenance class: the PAT route mirrors browser GPS stripping, HDR gating, color metadata, EXIF caption inputs, and queue settings through hand-copied blocks.

Concrete fix:

Extract a single ingest service for already-authenticated upload requests. Keep Server Action and PAT Route Handler adapters thin: auth, request parsing, response shape. The shared service should own config snapshot creation, quota claim/settlement, topic verification, original save, GPS/HDR/color normalization, DB insert, tag handling where applicable, queue payload construction, audit inputs, cleanup, and revalidation. Add parity tests at the service boundary so a new upload field cannot land in only one adapter.

### ARCH20-02 - Large binary ingress still depends on framework multipart materialization

Severity: High
Confidence: High
Classification: confirmed issue

Exact region:

- Browser upload receives `FormData` and extracts `File` objects before app-level quota checks: `apps/web/src/app/actions/images.ts:129-148`, then checks file count/size at `apps/web/src/app/actions/images.ts:184-263`.
- PAT upload performs header checks and a one-slot parser semaphore, but still materializes the body via `await request.formData()`: `apps/web/src/app/api/admin/lr/upload/route.ts:101-181`.
- DB restore is a Server Action accepting `FormData`; only after that does it stream the `File` to disk: `apps/web/src/app/[locale]/admin/db-actions.ts:400-407`, `apps/web/src/app/[locale]/admin/db-actions.ts:693-714`.
- Next raises framework request body caps for these large bodies: `apps/web/next.config.ts:111-119`; cap constants allow 200 MiB uploads and 250 MiB restore files plus overhead: `apps/web/src/lib/upload-limits.ts:1-33`.

Failure scenario:

A large browser upload, PAT upload, or restore request is accepted by Next and materialized into `FormData`/`File` before the app can stream to disk or enforce most domain checks. On the documented single-host deployment, concurrent large requests plus Sharp/image work can spike memory or temp-storage pressure and degrade public/admin traffic even when later app checks reject the request correctly.

Concrete fix:

Move large binary ingress to streaming Route Handlers. Enforce `Content-Length`, per-part limits, total limits, and a process-wide large-body semaphore before parsing; stream directly to temp files; then pass validated temp-file handles into the shared upload/restore service. Keep Server Actions for small metadata commands only.

### ARCH20-03 - Single-instance topology is detected but not enforced

Severity: Medium
Confidence: High
Classification: confirmed issue

Exact region:

- Upload quota state is process-local: `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/upload-tracker-state.ts:70-78`.
- OG/share/feed/semantic public fast-path limiters are process-local Maps: `apps/web/src/lib/rate-limit.ts:78-109`, `apps/web/src/lib/rate-limit.ts:404-427`.
- Shared-group view-count buffer is process-local: `apps/web/src/lib/data.ts:13-63`.
- The singleton guard explicitly says it is warn-only and startup continues: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`.
- Startup initializes the guard fire-and-forget: `apps/web/src/instrumentation.ts:22-31`.
- Compose/deploy run a single named container but do not assert singleton DB ownership: `apps/web/docker-compose.yml:12-17`, `apps/web/deploy.sh:51-77`.

Failure scenario:

An operator accidentally runs two web processes against the same database during manual recovery, blue/green experimentation, or a compose scale/custom deployment. The guard logs, but both processes keep serving. Upload quotas, restore process state, view buffers, queue process state, and several public limiter budgets split by process, multiplying allowed traffic and weakening coordination.

Concrete fix:

For the supported topology, fail closed in production when another holder owns the singleton lock unless an explicit unsafe override is set. Add a deploy post-start assertion that exactly one `gallerykit-web` instance is serving the DB. If scale-out becomes a product goal, first move upload quota, public fast-path limiters, queue ownership, shared view buffers, and restore coordination into shared durable state.

### ARCH20-04 - Upload queue and admin backfill budget independently against the same DB/CPU pool

Severity: High
Confidence: High
Classification: confirmed issue

Exact region:

- Image queue computes its own DB-pool-derived concurrency: `apps/web/src/lib/image-queue.ts:121-153`.
- Admin backfill computes a separate DB-pool-derived concurrency: `apps/web/src/lib/admin-backfill-runner.ts:97-143`.
- Admin backfill documentation says it is invisible to the upload processing queue: `apps/web/src/lib/admin-backfill-runner.ts:41-44`.
- Each image conversion fans out WebP, AVIF, and JPEG encoders in parallel: `apps/web/src/lib/process-image.ts:1205-1418`.

Failure scenario:

Fresh uploads are processing while an admin starts in-app color/format backfill. At the default 10-connection pool, each lane can independently choose concurrency 2. Backfill also holds a run-level advisory lock, and each image job can hold claim/update connections while Sharp runs. Four active image jobs can fan out into three encoder branches each, oversubscribing CPU/libvips and leaving too little DB headroom for dynamic public pages, auth, search, and health checks.

Concrete fix:

Introduce a process-wide background-work budget shared by upload processing, admin color backfill, semantic embedding backfill/bootstrap, and other heavy side effects. Acquire DB and CPU tokens before advisory locks and Sharp work. A smaller first step is to pause/refuse admin backfill while foreground upload queue work is active, with a source-contract test proving combined queue plus backfill concurrency cannot exceed the shared budget.

### ARCH20-05 - Public discovery surfaces run expensive scans inside the request path

Severity: Medium
Confidence: High for current code shape; Medium for production impact without MySQL `EXPLAIN`
Classification: confirmed issue

Exact region:

- Public keyword action accepts two-code-point queries and calls search after rate limiting: `apps/web/src/app/actions/public.ts:247-317`.
- Keyword search uses leading-wildcard `containsLike` across images/topics/tags/aliases: `apps/web/src/lib/data.ts:1574-1749`.
- Smart collections parse/compile/run dynamic predicates on every public request: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:96-111`.
- Smart-collection compiler allows `contains` and tag `contains` predicates: `apps/web/src/lib/smart-collections.ts:221-223`, `apps/web/src/lib/smart-collections.ts:250-267`.
- Semantic and similar routes scan embedding blobs and score in Node per request: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`.
- Semantic scan limit can be configured up to 25,000 rows: `apps/web/src/lib/clip-embeddings.ts:36-48`.

Failure scenario:

Several public users or crawlers hit keyword search, broad public smart collections, and semantic/similar routes while normal SSR and image work are active. Rate limits bound request count, but each admitted request can still do non-sargable SQL scans, grouped tag/alias queries, dynamic predicate compilation, or thousands of vector decodes and dot products inside the same Next process and MySQL pool.

Concrete fix:

Create a dedicated discovery/search ownership boundary. Keyword search should use MySQL FULLTEXT/ngram or a maintained `image_search_terms` table. Expensive smart collections should be cost-classified at save time and materialized when public. Semantic/similar search should move to an ANN/vector index, worker service, or process-owned preloaded matrix with generation invalidation and explicit concurrency backpressure.

### ARCH20-06 - Public map ships one large exact-coordinate SSR/client payload

Severity: Medium
Confidence: High
Classification: confirmed issue

Exact region:

- Public map is always dynamic: `apps/web/src/app/[locale]/(public)/map/page.tsx:13-14`.
- Map query caps at 10,000 and comments defer bbox/clustering: `apps/web/src/lib/data.ts:1766-1775`.
- Query returns all opted-in GPS rows up to the cap with exact coordinates: `apps/web/src/lib/data.ts:1784-1816`.
- Page serializes all markers and renders a duplicate fallback list: `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`.
- Client computes bounds across all markers and renders one Leaflet marker each: `apps/web/src/components/map/map-client.tsx:77-94`, `apps/web/src/components/map/map-client.tsx:120-139`.
- Image indexes do not include a spatial/geohash access path: `apps/web/src/db/schema.ts:123-131`.

Failure scenario:

A location-rich gallery enables map visibility for thousands of photos. `/map` serializes thousands of exact coordinates and list entries into one response, then hydrates thousands of Leaflet markers and popups on mobile. The page can stall or crash even though the SQL result is capped, and every visitor receives the full opted-in coordinate set whether or not they inspect that region.

Concrete fix:

Replace all-at-once marker hydration with viewport/bbox APIs, clustering, and a lower initial payload budget. Add a spatial/geohash/composite index matching the chosen query. Keep the accessible fallback list paginated or virtualized separately from marker rendering.

### ARCH20-07 - Cached shared-group data access still owns a view-count side effect

Severity: Medium
Confidence: Medium
Classification: confirmed issue

Exact region:

- `getSharedGroup()` buffers a denormalized view-count side effect while returning data: `apps/web/src/lib/data.ts:1392-1407`.
- The cached wrapper warns about different count semantics: `apps/web/src/lib/data.ts:1830-1834`.
- The public group page uses the cached read and then separately records the durable view: `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142`.

Failure scenario:

A future metadata, OG, preload, or layout path calls `getSharedGroupCached()` with `incrementViewCount:false`, or with different selected-photo semantics, before the page's main render. React request cache deduplicates a function that is not pure data access, so denormalized counters can be skipped, duplicated, or diverge from durable view recording depending on call order and arguments.

Concrete fix:

Split shared-group access into a pure cached data read and explicit view-recording orchestration. The page should fetch the group once, resolve whether the request is a group view or selected-photo navigation, then call denormalized and durable counters from one non-cached owner.

## Likely Issues / Design Debt

### ARCH20-08 - Topic slug remains a mutable natural key with manual fan-out semantics

Severity: Medium
Confidence: Medium
Classification: likely issue / design debt

Exact region:

- `topics.slug` is the primary key: `apps/web/src/db/schema.ts:10-18`.
- FK children reference the slug with no `ON UPDATE CASCADE`: `apps/web/src/db/schema.ts:20-39`, `apps/web/src/db/schema.ts:251-260`.
- Rename recreates the topic and manually repoints images, aliases, topic views, and smart-collection JSON before deleting the old row: `apps/web/src/app/actions/topics.ts:287-371`.
- A registry test now covers known FK children and smart-collection update order: `apps/web/src/__tests__/topic-slug-fk-registry.test.ts:1-79`.

Failure scenario:

The current known fan-out is covered, but future non-FK persistence sites, JSON settings, cache keys, generated feeds, or external integration records can store topic slugs outside the registry's model. A rename can leave a new feature pointing at the deleted slug, producing empty galleries, broken analytics association, stale public links, or hard-to-debug smart-collection behavior.

Concrete fix:

Migrate topic identity to an immutable surrogate `topic_id`, with slug as mutable route/display state and aliases as route history. Until then, extend the registry guard beyond schema FKs to every slug-bearing persistence site and JSON field, and require every new slug persistence site to declare rename behavior.

## Manual-Validation Risks

### ARCH20-MV01 - Public-page flood protection depends on live host nginx state outside deploy

Severity: Medium
Confidence: High for repo/deploy mismatch; Medium for live exploitability without host inspection
Classification: manual-validation risk

Exact region:

- Public and image limiter zones are defined only in the nginx template: `apps/web/nginx/default.conf:1-29`.
- Public SSR limiter is applied in the catch-all location: `apps/web/nginx/default.conf:274-295`.
- The template states deploys do not touch live nginx: `apps/web/nginx/default.conf:290-293`.
- Deploy builds/starts the app and health checks, but does not verify host nginx config: `apps/web/deploy.sh:51-77`.
- Docs state public pages rely on edge limiting and no app-layer page limiter exists: `CLAUDE.md:247`.

Failure scenario:

A repository change adds or relies on an nginx limiter/body cap, `npm run deploy` succeeds, but the host keeps an older nginx file or a different proxy. Operators believe dynamic public SSR pages are protected while `/`, `/p/:id`, `/map`, `/timeline`, topic pages, and smart collections reach Next/MySQL with no page-level app limiter.

Concrete fix:

Make deploy verify the live edge config, for example by comparing a version/hash marker from `nginx -T` against the committed template and failing or marking deploy incomplete when missing. Longer term, add a cheap app-layer fallback limiter around public page data loaders so proxy drift cannot remove the last availability guard.

### ARCH20-MV02 - Production semantic search correctness depends on host-only state

Severity: Medium
Confidence: High for host-state dependency; Low for current live status without host access
Classification: manual-validation risk

Exact region:

- Product docs state semantic search is disabled by default and production mode requires operator setup/weights/backfill/env opt-in: `README.md:50`.
- Runtime docs state production serving requires DB mode, `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`, seeded weights, and real embeddings: `CLAUDE.md:169`.
- Route gates on `semanticSearchMode` and active model version, then scans current rows: `apps/web/src/app/api/search/semantic/route.ts:186-204`, `apps/web/src/app/api/search/semantic/route.ts:263-311`.
- Similar route is production-only and scans the same embedding store: `apps/web/src/app/api/search/similar/[id]/route.ts:115-131`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`.

Failure scenario:

The repo can prove the gates and route shape, but not that the deployed host has the intended CLIP weights, env, DB setting, and embedding coverage. A production operator may believe semantic/similar search is active and complete while the route returns disabled/no-embedding responses or only scans a partial newest-first embedding set.

Concrete fix:

Add a deploy or operator preflight that checks `SEMANTIC_SEARCH_ALLOW_PRODUCTION`, model manifest/weights under `CLIP_MODELS_ROOT`, DB `semantic_search_mode`, embedding row count/model version, and a sample query. Record the result in deploy output or an admin diagnostics panel.

## Non-Findings And Positive Boundaries

- Admin API routes are centrally wrapped with `withAdminAuth(...)`, and `scripts/check-api-auth.ts` recursively enforces that boundary for `/api/admin/**`.
- Mutating server actions use `requireSameOriginAdmin()` plus the restore mutation barrier, with `scripts/check-action-origin.ts` enforcing both unless a reasoned exemption is present.
- Public route/action rate limiting has a dedicated scanner for public API routes and explicit route-level patterns for search, sharing, OG, feed, and semantic surfaces.
- Public data projections have privacy-sensitive compile guards; GPS and admin-only image metadata are not casually exposed by the normal public projections.
- The storage abstraction is explicitly quarantined: comments in `lib/storage/*` say the live pipeline still uses direct filesystem helpers, and `__tests__/storage-quarantine.test.ts` fails if source outside `lib/storage` imports it.
- Migrations have a hash postcondition and reconcile path in `scripts/migrate.js`; I did not find a new schema/journal drift issue in this pass.
- The PWA service worker has a generated template, version stamping, and a unit-tested reference implementation for LRU semantics. I did not find a new PWA architecture issue beyond the documented same-origin/CDN cache limitation.
- Product boundaries are documented clearly: finished-photo publishing, no editing/culling/scoring/payment, local-only storage support despite the internal storage abstraction, and operator-gated semantic search.

## Final Missed-Issues Sweep

Sweep categories checked: repository guidance, product docs, package/config, App Router pages/layouts/API routes/actions, auth/origin guard boundaries, data access and React `cache()` wrappers, public/admin projections, upload/restore ingress, image processing, queue/backfill interactions, restore/backup locking, schema/migration/reconcile, search/smart-collection/semantic paths, map/timeline/public SSR surfaces, analytics/retention/background jobs, deploy/Docker/nginx topology, PWA/service worker/cache, storage abstraction, UI component boundaries, and architecture/source-contract tests.

No requested source category was intentionally skipped. Items requiring live/manual validation: host nginx config, production MySQL `EXPLAIN`, production CLIP model/embedding state, browser performance traces for large maps, and actual deployed process count.
