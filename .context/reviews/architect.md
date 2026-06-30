# Architect Review - Cycle 25

Repo: `/Users/hletrd/flash-shared/gallery`
Review date: 2026-06-30
Role: cycle-25 architect
Mode: static whole-repo architectural/design risk review

## File Inventory First

I read `AGENTS.md` and `CLAUDE.md` first, then built a repository inventory before selecting files for deep review.

Inventory command scope excluded dependency/build/runtime artifacts (`node_modules`, `.git`, `.next`, `.omx`, `.omc`, `.claude`, upload/data/test-output directories). Source-relevant inventory:

- Total source/config/docs inventory: 801 files.
- App Router/API/action layer: 77 files under `apps/web/src/app`.
- Shared/domain/runtime library layer: 97 files under `apps/web/src/lib`.
- DB schema layer: 3 files under `apps/web/src/db`.
- Migration layer: 31 files under `apps/web/drizzle`.
- Operational scripts: 27 files under `apps/web/scripts`.
- UI/component layer: 57 files under `apps/web/src/components`.
- Unit/source-contract tests: 274 files under `apps/web/src/__tests__`.
- E2E tests: 8 files under `apps/web/e2e`.
- Plans/history: 180 files under `plan`.
- Static public assets in scope: 8 files under `apps/web/public` after excluding mutable uploads/resources.

Primary architecture surfaces reviewed:

- Boundaries/layering: `apps/web/src/app/actions.ts`, `apps/web/src/app/actions/*`, `apps/web/src/lib/api-auth.ts`, `apps/web/src/__tests__/client-server-only-boundary.test.ts`, client components importing server actions.
- Persistence/migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`.
- Data flows/query shape: `apps/web/src/lib/data.ts`, `apps/web/src/lib/smart-collections.ts`, public pages, search routes.
- Runtime state ownership: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/app/actions/public.ts`, `apps/web/src/instrumentation.ts`.
- Deployment/runtime architecture: root and app package manifests, `.github/workflows/quality.yml`, `.github/dependabot.yml`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `.dockerignore`, `.gitignore`.

Skipped as non-architecture/generated/runtime artifacts: dependency directories, Next build output, uploaded photo data, runtime data volumes, historical screenshots, local OMX state, and unrelated already-modified review files.

## Findings

### ARCH25-01 - Embedding Column Has Split Type Ownership

Severity: Medium
Confidence: High
Region: `apps/web/src/db/schema.ts:266-286`, `apps/web/drizzle/0012_image_embeddings.sql:5-8`, `apps/web/scripts/migrate.js:643-651`, `apps/web/src/lib/clip-embeddings.ts:115-153`

Design risk:
`image_embeddings.embedding` is physically a MySQL `MEDIUMBLOB`, but the Drizzle schema declares `embedding: text("embedding").notNull()`. The comments and runtime decoder know this is an approximation, and `decodeEmbeddingColumn()` compensates for both `Buffer` and legacy base64 string shapes. That makes the schema, migrations, runtime reads, and write casts separate sources of truth for the same storage contract.

Concrete failure scenario:
A future migration/schema-diff pass or refactor reads only `schema.ts`, treats the embedding as text, and introduces collation, string validation, JSON serialization, or a generated migration that rewrites the binary column. Semantic search then silently drops malformed rows through the length check or returns poor/empty results after corrupting 2048-byte float vectors.

Suggested fix:
Make `schema.ts` express the physical binary type with a custom Drizzle MySQL type/helper for `MEDIUMBLOB`. Keep the legacy base64 decode branch only as an explicit compatibility path. Add a source-contract test that compares the Drizzle declaration, migration SQL, and reconciler definition for `image_embeddings.embedding`.

### ARCH25-02 - Server Action Barrel And Auth Context Blur App/Domain Boundaries

Severity: Medium
Confidence: High
Region: `apps/web/src/app/actions.ts:1-34`, `apps/web/src/components/upload-dropzone.tsx:7`, `apps/web/src/components/load-more.tsx:4-5`, `apps/web/src/components/photo-viewer.tsx:22`, `apps/web/src/components/image-manager.tsx:4`, `apps/web/src/lib/api-auth.ts:1`, `apps/web/src/app/actions/auth.ts:1-70`, `apps/web/src/__tests__/client-server-only-boundary.test.ts:116-143`, `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:19-23`

Design risk:
The broad `@/app/actions` barrel re-exports auth, image mutations, topic/tag mutations, sharing, public actions, SEO, and settings from one surface. Several client components import from that barrel. Separately, low-level API auth imports `isAdmin` from `app/actions/auth`, while that action module also owns login, logout, cookie mutation, translations, redirects, rate-limit mutation, audit logging, and restore-maintenance behavior.

The client/server boundary test walks `@/lib` and `@/db` value imports, but not `@/app/actions`. A narrow source contract exists only for `searchImagesAction`, proving this risk is known for one path but not generalized.

Concrete failure scenario:
A developer adds a convenience export to `app/actions.ts` or adds a server-only dependency to an action module. A client component importing one action from the barrel gains a broader static import closure than intended, or an API route starts depending on action-layer behavior that was designed for forms/pages. The existing boundary scan can still pass because `@/app/actions` is outside its traversal set.

Suggested fix:
Deprecate broad value imports from `@/app/actions` in client components. Import from exact action modules or create narrow client-facing action modules. Move `getSession`, `getCurrentUser`, and `isAdmin` into a server-only auth-context/domain module under `lib`, then have both API wrappers and server actions depend on that module. Extend the boundary test to forbid client value imports from the broad barrel and to traverse `@/app/actions/*` imports.

### ARCH25-03 - Production Native Dependency Pins Can Drift Outside CI

Severity: Medium
Confidence: Medium
Region: `apps/web/Dockerfile:49-61`, `apps/web/src/__tests__/deploy-script-contract.test.ts:90-100`, `.github/workflows/quality.yml:48-80`, `.github/dependabot.yml:3-18`

Design risk:
The Docker build runs `npm ci` and then explicitly installs Linux native optional packages with hard-coded versions for Sharp/libvips/SWC/Lightning CSS. The deployment test named "pins explicit Docker native optional dependency installs to lockfile versions" only checks that each token ends with a numeric semver; it does not compare those versions to `package-lock.json` or to the selected top-level packages. CI also runs lint/typecheck/tests/e2e/build on the host Node environment, but does not build the production Docker image.

Concrete failure scenario:
Dependabot upgrades `next`, `sharp`, `@swc/core`, or `lightningcss` in `package-lock.json`. The source tests pass because the Dockerfile still contains semver-looking pins, but the production image forcibly installs stale native binaries with `--no-save`. The first deploy can fail during `next build`, load an ABI-incompatible native addon, or diverge from the lockfile graph that CI actually tested.

Suggested fix:
Add a CI Docker image build or a cheap lockfile parity test that parses the Dockerfile native install block and asserts each package/version exists in `package-lock.json` for the workspace. Prefer deriving these explicit native package versions from the lockfile during the Docker build or centralizing them in one generated manifest checked by CI.

### ARCH25-04 - Public First-Page Listings Still Couple UI To Exact Window Counts

Severity: Medium
Confidence: Medium
Region: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1417-1467`, `apps/web/src/lib/smart-collections.ts:21-30`, `apps/web/src/lib/smart-collections.ts:221-238`, `apps/web/src/lib/smart-collections.ts:250-267`, `apps/web/src/app/[locale]/(public)/page.tsx:149-168`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:78-101`

Design risk:
Initial public listing queries use `COUNT(*) OVER()` while also joining tags, grouping by image id, and ordering by capture/create/id. Smart-collection cursor pages avoid the count, but initial pages still compute an exact total over arbitrary admin-authored predicates. Those predicates include `contains` filters over unindexed text fields and tag subqueries.

Concrete failure scenario:
An admin creates a public smart collection with a broad `contains` predicate over camera, lens, exposure text, or tags. Each first-page visitor or crawler request forces MySQL to evaluate the dynamic predicate, group tags, order, and compute an exact count. Cursor load-more is cheaper, but the route entry point remains DB-bound and grows with the whole collection rather than one page.

Suggested fix:
Remove exact totals from hot public first pages unless the UI genuinely needs them. Use `pageSize + 1` for `hasMore`, move exact counts to an admin/async/cached path, or materialize smart-collection membership/counts for public collections. Add representative `EXPLAIN`/query-budget coverage before expanding the smart-collection predicate language.

### ARCH25-05 - Semantic Search Recall Is A Recency Window, Not A Corpus Search

Severity: Medium
Confidence: High
Region: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:164-201`, `apps/web/src/lib/clip-embeddings.ts:36-44`

Design risk:
Semantic text search and similar-photo search scan only the newest `SEMANTIC_SCAN_LIMIT` embeddings for the active model, ordered by `image_embeddings.updated_at`. The default cap is 2,000 and the hard env clamp is 25,000. This is a bounded brute-force operational shortcut, not a true vector-search architecture.

Concrete failure scenario:
Once the gallery grows beyond the cap, an older image can be the most relevant match and still be impossible to return because it is outside the newest-first window. Raising the cap increases DB transfer and CPU linearly per public request, while lowering it silently reduces recall. Similar-photo search has the same blind spot for older neighbors.

Suggested fix:
Expose scanned-row count versus total active embeddings in logs/admin status so the operator can see when recall becomes partial. If semantic search is expected to remain a first-class feature for larger galleries, add an ANN/vector index, a materialized nearest-neighbor table, or another retrieval tier that is not ordered by recency.

### ARCH25-06 - Single-Instance Runtime Ownership Is Documented But Not Enforced

Severity: Medium
Confidence: Medium
Region: `apps/web/docker-compose.yml:12-28`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-79`, `apps/web/src/lib/image-queue.ts:76-89`, `apps/web/src/lib/image-queue.ts:267-342`, `apps/web/src/lib/admin-backfill-runner.ts:219-250`, `apps/web/src/lib/data.ts:13-35`, `apps/web/src/instrumentation.ts:33-40`

Design risk:
The documented topology is one web container and one process. The code follows that topology: restore maintenance, upload tracker state, queue state, admin-backfill status, rate-limit fast paths, and shared-group view-count buffering are process-local. Several correctness paths use MySQL advisory locks, but there is no startup lease that makes "only one web writer is running" executable.

Concrete failure scenario:
A future operator starts a second container during a deploy, a platform migration adds a second Node process, or a local process supervisor restarts without stopping the old process. Upload quotas, maintenance flags, in-memory rate limits, queue bootstrap state, and status surfaces split between processes. Some image-processing races are fenced by advisory locks, but UX/status, throttling, and other process-owned state become inconsistent.

Suggested fix:
If single-instance is an invariant, enforce it with a startup MySQL advisory lease or durable instance row that fails fast when another writer is active. If scale-out is a roadmap item, move restore state, upload claims, rate-limit buckets, queue/status ownership, and analytics buffers to shared durable storage before adding a second process.

### ARCH25-07 - Public Analytics Row Writes Are Untracked Fire-And-Forget Side Effects

Severity: Low
Confidence: High
Region: `apps/web/src/app/actions/public.ts:362-390`, `apps/web/src/app/actions/public.ts:397-421`, `apps/web/src/app/actions/public.ts:428-456`, `apps/web/src/instrumentation.ts:33-40`, `apps/web/src/lib/data.ts:222-249`

Design risk:
Photo/topic/shared analytics events are durable DB rows by schema, but the server actions intentionally start the insert without awaiting it. Shutdown drains the image queue and the shared-group aggregate buffer, but not these per-view insert promises. The design is valid if analytics are approximate, but state ownership is ambiguous because row-level analytics look durable while their write path is best-effort.

Concrete failure scenario:
A deploy SIGTERM, process exit, DB pool stall, or crash immediately after a page render can drop a view event silently. Shared-group aggregate counts get a dedicated buffered flush path, while the row-level analytics events have no bounded queue, no shutdown drain, and no drop counter.

Suggested fix:
Choose and encode the contract. If row-level analytics are approximate, document that in the admin analytics copy/runbook and add a drop/loss counter. If they are intended to be durable, route them through a small bounded analytics queue with timeout, backpressure/drop metrics, and shutdown drain alongside the existing shared-group count flush.

## Positive Architecture Notes

- Migration drift handling is unusually defensive: the reconciler, per-entry migration baselining, hash post-condition, and journal monotonicity tests directly address Drizzle's MySQL cursor behavior.
- Admin API auth, server-action origin checks, and public mutating route rate-limit checks have dedicated lint gates in CI.
- Deployment data persistence is narrow and intentional: `data`, `public/uploads`, `public/resources`, and `site-config.json` are bind-mounted while immutable public assets come from the image.
- The CLIP production gate is intentionally operator-only, and the runtime fails closed unless `SEMANTIC_SEARCH_ALLOW_PRODUCTION=true`.
- The codebase carries many source-contract tests around prior architectural drift classes; most issues above are remaining boundary/ownership risks rather than missing one-off guards.

## Final Missed-Issue Sweep

Final sweep covered:

- Schema-to-migration-to-reconciler alignment, including removed paid-download/reaction schema.
- Admin-only/privacy select fields and search enrichment fields.
- Server action imports, client/server import closure tests, and action-origin lint coverage.
- Public API routes, expensive GET routes, and public rate-limit helper conventions.
- `globalThis`, process-local maps, queues, timers, shutdown hooks, and side-effect drains.
- Docker/Compose/nginx/deploy scripts, `.dockerignore`, `.gitignore`, CI, and Dependabot update paths.
- Runtime config/env ownership, upload storage paths, CLIP model paths, and semantic-search serving gates.
- Smart collection query compiler, listing pagination, search routes, analytics, restore, upload, image queue, and backfill flows.

No additional architecture/design findings met the severity bar after this sweep. I did not run lint/typecheck/build/tests because this was a static review whose only repository write is this report.
