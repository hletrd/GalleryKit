# Architect Review - Cycle 24/100

Repo: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `a6efd6fd584fe44138be3729d90743ceb76dbfad`
Review date: 2026-06-30
Role: architect

## Scope And Method

I reviewed current HEAD, not prior-cycle assumptions. I read `AGENTS.md` and `CLAUDE.md`, then inventoried the live architecture surfaces before selecting files for detailed review.

Inventory evidence:
- Live app/source/config/migration/test inventory: 572 files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, and `apps/web/e2e`.
- TypeScript app source: 505 files under `apps/web/src`.
- Route/action layer: 76 files under `apps/web/src/app`.
- Shared library/domain layer: 97 files under `apps/web/src/lib`.
- Contract/unit test layer: 268 files under `apps/web/src/__tests__`.

Architecture-relevant files and regions reviewed:
- Project rules/docs: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.context/plans/*`, and current `.context/reviews/*` for live design intent and repeated review concerns.
- Package/build/runtime config: root `package.json`, `apps/web/package.json`, `next.config.ts`, `tsconfig*.json`, ESLint config, Vitest config, Playwright config, Dockerfile, Compose, nginx config, deploy scripts, and `scripts/entrypoint.sh`.
- Persistence and migration ownership: `apps/web/src/db/*`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, restore/export/backfill scripts, and schema reconciliation code.
- App Router and API boundaries: all `apps/web/src/app/**` route handlers, server actions, public pages, admin pages, auth wrappers, origin guards, public rate-limit gates, and semantic-search endpoints.
- Shared runtime/domain modules: `data.ts`, image queue, image processing, CLIP model/embedding helpers, smart collections, restore maintenance, upload tracker state, rate limiting, request origin, admin tokens, audit, storage quarantine, image URL/path helpers, SEO/config/cache helpers, and localization utilities.
- Client and UI state surfaces: components under `apps/web/src/components/**`, admin components, map/search/lightbox/photo viewer flows, upload manager, and client/server import contract tests.
- Verification scaffolding: unit/source-contract tests, custom lint scripts, public route rate-limit lint, action-origin lint, API auth lint, touch-target audit, and e2e specs.

Skipped as non-architecture/generated/runtime artifacts:
- `.git`, `node_modules`, `.next`, build output, coverage/test output, `apps/web/public/uploads`, `apps/web/public/resources`, `apps/web/data`, root and app `test-results`, `.omx`/`.omc` runtime state, `.claude/worktrees`, and archived historical review screenshots/artifacts under `.context/reviews/archive`.
- I used prior plans/reviews as design history, not as source of truth for current code.

Validation was static architecture review only. I did not run lint/typecheck/build/tests because this task only writes this review file and makes no runtime/source-code changes.

## Confirmed Issues

### ARCH24-01 - Embedding Schema Has Two Sources Of Truth

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- The Drizzle schema says the physical column is `MEDIUMBLOB`, but declares it as `text("embedding")`: `apps/web/src/db/schema.ts:266-286`.
- The executable reconciler/migration creates `embedding mediumblob NOT NULL`: `apps/web/scripts/migrate.js:643-651`.
- Runtime decode code compensates for the mismatch by accepting both raw `Buffer` values and legacy base64 strings: `apps/web/src/lib/clip-embeddings.ts:115-153`.

Design failure scenario:
The schema contract is split between comments, migration SQL, and runtime conversion helpers. A future Drizzle schema diff, migration generator, refactor, or developer reading only `schema.ts` can treat `image_embeddings.embedding` as text and accidentally alter, collate, serialize, or validate it as string data. That can silently corrupt CLIP embeddings or force defensive decode branches to become permanent architecture.

Concrete fix:
Make the DB schema express the real type. Add a MySQL custom Drizzle type or narrow schema helper for `MEDIUMBLOB` embeddings so `schema.ts`, migrations, `reconcileLegacySchema`, and runtime reads agree. Keep the legacy base64 decode path only as an explicit migration fallback. Add a source-contract test that fails if the declared embedding column no longer maps to binary `MEDIUMBLOB` storage.

### ARCH24-02 - Client Action Imports And Auth Reuse Cross The App/Lib Boundary

Severity: Medium  
Confidence: High  
Status: Confirmed

Evidence:
- The broad action barrel re-exports unrelated action groups from one `@/app/actions` surface: `apps/web/src/app/actions.ts:1-34`.
- Multiple client components import server actions through that broad barrel, including upload, listing, image management, and photo viewer flows: `apps/web/src/components/upload-dropzone.tsx:1-8`, `apps/web/src/components/load-more.tsx:1-5`, `apps/web/src/components/image-manager.tsx:1-5`, `apps/web/src/components/photo-viewer.tsx:1-23`.
- The client/server boundary test only follows `@/lib` and `@/db` runtime imports, so it does not protect the `@/app/actions` barrel surface: `apps/web/src/__tests__/client-server-only-boundary.test.ts:115-143`.
- A narrower source contract exists only for visitor keyword search, proving the issue is known locally but not generalized: `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:19-23`.
- The API auth layer imports `isAdmin` from a server-action module: `apps/web/src/lib/api-auth.ts:1`. That action module owns cookies, redirects, translation, login rate limits, audit logging, restore maintenance messaging, and mutation logic in the same file: `apps/web/src/app/actions/auth.ts:1-21`.

Design failure scenario:
The `@/app/actions` barrel becomes a high-coupling boundary between client components, server actions, admin actions, public actions, and auth state. A future export added for convenience can pull server-only dependencies into a client import closure or make a route/API layer depend on action-module behavior. The existing boundary scanner can still pass because it does not traverse `@/app/actions`. Separately, low-level API auth depending on `app/actions/auth` makes auth state ownership live in the App Router action layer instead of a server-only auth domain module.

Concrete fix:
Remove broad barrel imports from client components. Import from the exact action module, as `search.tsx` already does for `@/app/actions/public`. Add a source-contract test that forbids value imports from `@/app/actions` in `'use client'` files and follows `@/app/actions/*` when checking server-only import closures. Move `getSession`, `getCurrentUser`, and `isAdmin` into a server-only `lib/auth-context` or `lib/current-user` module; then make both API wrappers and server actions depend on that module instead of routing auth through `app/actions/auth`.

### ARCH24-03 - Public Analytics Writes Are Fire-And-Forget But Not Owned By Shutdown

Severity: Low  
Confidence: High  
Status: Confirmed

Evidence:
- Photo view recording intentionally starts the insert and does not await it: `apps/web/src/app/actions/public.ts:362-390`.
- Topic and shared-group analytics use the same untracked insert pattern: `apps/web/src/app/actions/public.ts:397-421`, `apps/web/src/app/actions/public.ts:428-456`.
- Shutdown drains image processing and the shared-group aggregate buffer, but it does not track or drain these analytics insert promises: `apps/web/src/instrumentation.ts:33-40`.

Design failure scenario:
Analytics events are durable database rows by schema, but the runtime treats them as best-effort side effects with no queue, no bounded drain, and no loss counter. A deploy, SIGTERM, process crash, or DB pool stall immediately after a view can drop events silently. That may be acceptable for approximate analytics, but the architecture does not make that ownership explicit the way the shared-group aggregate buffer does.

Concrete fix:
Pick one contract and encode it. If these events are best-effort, document admin analytics as approximate and add a drop/loss counter for observability. If they are intended to be durable, route them through a small bounded analytics queue with shutdown drain, timeout, and backpressure/drop metrics.

## Likely Issues

### ARCH24-04 - First-Page Public Listing Queries Keep Exact Window Counts On Expensive Dynamic Predicates

Severity: Medium  
Confidence: Medium  
Status: Likely issue

Evidence:
- The generic listing first page selects `COUNT(*) OVER()` while grouping tags and ordering by image date: `apps/web/src/lib/data.ts:878-907`.
- Smart collection cursor pages avoid the count, but the initial/offset path still selects `COUNT(*) OVER()` over the compiled predicate and tag joins: `apps/web/src/lib/data.ts:1417-1465`.
- Public smart-collection pages are dynamic (`revalidate = 0`) and call the initial counted query on every first render: `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:14`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:78-101`.
- Smart collection predicates allow fields and `contains` operations that are not covered by the main image listing indexes, such as camera/lens/exposure/tag contains: `apps/web/src/lib/smart-collections.ts:21-30`, `apps/web/src/lib/smart-collections.ts:221-238`, `apps/web/src/lib/smart-collections.ts:250-267`. The image table indexes are mostly processed/date/topic/filename/uploader oriented: `apps/web/src/db/schema.ts:115-121`.

Design failure scenario:
An admin can create a public smart collection with a broad `contains` predicate over camera, lens, exposure, or tag text. Every visitor to the first page then forces the database to evaluate a dynamic predicate, join/group tags, order results, and compute an exact total count. Cursor-based load-more is cheaper, but the first page remains the route-level choke point. On a larger gallery or crawler traffic, this becomes a DB-bound public endpoint and pushes maintainers toward ad hoc per-route caching.

Concrete fix:
Remove exact count from hot public first pages unless the UI truly requires it. Fetch `pageSize + 1` rows for `hasMore` and compute totals asynchronously, cached per smart collection, or behind an admin-only/low-priority path. For public smart collections, consider materialized membership rows or a constrained/indexed predicate set. Add an EXPLAIN/performance budget test for representative smart-collection predicates before expanding the query language.

## Risks Needing Manual Validation

### ARCH24-05 - Semantic Search Recall Is Bounded By Recency, Not Similarity

Severity: Medium  
Confidence: High  
Status: Risk needing manual validation

Evidence:
- Semantic search scans only the most recently updated embeddings for the active model, capped by `SEMANTIC_SCAN_LIMIT`: `apps/web/src/app/api/search/semantic/route.ts:263-275`.
- Similar-photo search has the same most-recent scan cap: `apps/web/src/app/api/search/similar/[id]/route.ts:164-177`.
- The cap defaults to 2,000 rows and is clamped to 25,000 by env parsing: `apps/web/src/lib/clip-embeddings.ts:22-44`.

Design failure scenario:
This is operationally reasonable for the current documented corpus size, but it is not a semantic-search architecture. Once the gallery grows beyond the scan cap, older images are invisible to a query no matter how relevant they are. Raising the cap increases DB transfer and CPU cost linearly per public request. Similar search has the same failure mode: relevant older neighbors can never be considered if they fall outside the recency window.

Concrete fix:
Before relying on CLIP search as a long-term feature, validate expected corpus size and recall requirements. If recall matters beyond the cap, introduce an actual vector/ANN index or materialized nearest-neighbor service/table. Short term, expose scanned row count versus total embedding count in logs/metrics and make the UI/admin docs clear that results are bounded by the configured scan window.

### ARCH24-06 - Current Topology Still Depends On Single-Instance Process Ownership

Severity: Medium  
Confidence: Medium  
Status: Risk needing manual validation

Evidence:
- `CLAUDE.md` documents a single web instance with local filesystem and process-local runtime ownership.
- The runtime state reviewed includes process-local restore maintenance state, upload tracker state, queue bootstrap/shutdown state, and shared view-count buffering in `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/upload-tracker-state.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/instrumentation.ts`, and `apps/web/src/lib/data.ts`.
- Deployment config currently runs one web service behind nginx, so the design is internally consistent for the documented topology.

Design failure scenario:
The architecture remains correct only while deployment stays single-instance. A future scale-out, second Node process, platform migration, or accidental duplicate container would split restore flags, upload tracking, queue runtime state, and buffered counts across processes. Prior cycles flagged this class of risk; current HEAD still relies on docs and deployment shape rather than an executable startup lease.

Concrete fix:
If single-instance is a product invariant, enforce it with a startup DB advisory lease or durable runtime instance claim that fails fast when another writer is active. If horizontal scaling is on the roadmap, move restore state, upload claims, queue ownership, rate-limit buckets, and analytics buffers to shared durable storage before adding the second process.

## Positive Architecture Confirmations

- Storage remains quarantined: the compatibility storage module is covered by quarantine tests and is not part of live image path ownership.
- Restore and migration paths have explicit advisory locks, maintenance gates, journal post-condition checks, and schema reconciliation. I did not find a new persistence-boundary issue beyond the embedding type mismatch.
- Public mutation surfaces have dedicated lint gates for admin auth, same-origin action guards, and public route rate limiting.
- Deployment topology is consistently documented and reflected in Compose/nginx/deploy scripts for the current single-host model.

## Final Sweep

Final architecture sweeps covered:
- `process.env` and runtime config ownership.
- `globalThis`, module-local maps/sets/timers, queues, and shutdown hooks.
- Raw SQL, advisory locks, migration journal entries, and schema reconciliation.
- Public API mutating handlers, admin API wrappers, action-origin exemptions, and rate-limit helpers.
- Client/server import boundaries, `server-only` usage, action barrels, and route/action layering.
- Image storage, upload, processing queue, restore/backup, semantic search, smart collections, shares, maps, and analytics.

No additional architecture/design findings met the severity bar after that sweep. Skipped files were limited to generated, dependency, build, runtime data, upload/resource, test-output, worktree, and archived historical artifacts listed in the scope section above.
