# Cycle 25 Architect/Critic Review

Date: 2026-07-08 KST
Reviewed HEAD: `f78c8437ae833d50aa85db8332257f59d923dc60`
Lane: architect + critic combined
Scope: review-only. No product code edits.

## Inventory

Reviewed project instructions and current/archived context:

- `AGENTS.md`, `CLAUDE.md`
- `.omc/wiki/gallerykit-architecture-overview.md`
- `.context/reviews/architect.md`
- `.context/reviews/critic.md`
- `.context/reviews/_aggregate.md`
- `.context/plans/archive/cycle-25-2026-06-30-plan.md`
- `.context/plans/archive/cycle-25-2026-06-30-deferred.md`

Inspected implementation surfaces by architecture area:

- Upload/ingest: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, upload locks, path helpers, image queue enqueue payloads.
- Background coordination: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/background-db-writes.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/db/index.ts`.
- Runtime topology: `apps/web/src/lib/single-writer-guard.ts`, `apps/web/src/instrumentation.ts`, Docker/NGINX/deploy files.
- Storage boundary: `apps/web/src/lib/storage/*`, `apps/web/src/lib/upload-paths.ts`, `apps/web/src/lib/serve-upload.ts`, storage quarantine tests.
- Schema/migrations: `apps/web/scripts/migrate.js`, `apps/web/drizzle/meta/_journal.json`, `apps/web/src/db/schema.ts`, migration guard tests.
- Public scale/product invariants: map, semantic search, similar search, analytics, action barrel.

## Confirmed Issues

### AC25-01 - Upload ingest has two manually mirrored implementations

Severity: High
Confidence: High
Status: Confirmed architecture/coupling issue

The browser upload action and the Lightroom/PAT route independently implement the same ingest state machine: restore fence, upload quota claim, upload-processing contract lock, topic validation, config snapshot, disk preflight, original save, HDR policy, GPS stripping, late restore check, DB insert, queue payload, audit/revalidate. The browser path spans `apps/web/src/app/actions/images.ts:87-221` and `apps/web/src/app/actions/images.ts:325-516`. The Lightroom path repeats the same contract across `apps/web/src/app/api/admin/lr/upload/route.ts:84-188`, `apps/web/src/app/api/admin/lr/upload/route.ts:254-381`, and `apps/web/src/app/api/admin/lr/upload/route.ts:383-613`.

The code comments repeatedly say the LR path is "mirroring the browser upload path" for disk checks, HDR policy, GPS stripping, restore rechecks, and enqueue settings (`apps/web/src/app/api/admin/lr/upload/route.ts:327-340`, `apps/web/src/app/api/admin/lr/upload/route.ts:398-427`, `apps/web/src/app/api/admin/lr/upload/route.ts:438-445`, `apps/web/src/app/api/admin/lr/upload/route.ts:550-586`). That is useful documentation, but it is also evidence that product-critical invariants rely on reviewer memory and duplicated patches.

Failure scenario: a future privacy, color, schema, or processing setting is added to one path only. This already looks like a historically recurring class: the LR comments document fixes for missed HDR, GPS, ICC/color, upload attribution, queue payload, and caption parity. The next miss can produce a GPS leak at rest, wrong color metadata, ignored processing settings, or duplicate external publish retries.

Concrete fix: extract a shared ingest service that accepts a small transport adapter for browser `File[]` vs LR single-file metadata. Centralize these pieces behind one call path: quota claim/settle, processing-settings snapshot, original-save policy gates, `images` insert value builder, and `enqueueImageProcessing` payload builder. Keep per-transport validation/error mapping at the edge. Add parity tests that run the same fixture through browser and LR adapters and assert the persisted columns plus queue payload.

### AC25-02 - Background DB/CPU budgets are local, not global

Severity: High
Confidence: High for source-level design, medium for live saturation frequency
Status: Confirmed design risk

The DB pool is fixed at 10 connections with `queueLimit: 20` (`apps/web/src/db/index.ts:31-42`). The image queue caps itself by reserving half the pool for live traffic (`apps/web/src/lib/image-queue.ts:120-153`). The admin color backfill does the same with a separate formula and lock (`apps/web/src/lib/admin-backfill-runner.ts:97-143`, `apps/web/src/lib/admin-backfill-runner.ts:324-379`). The in-memory processing queue and background analytics queue are process-local and separately bounded (`apps/web/src/lib/image-queue.ts:313-372`, `apps/web/src/lib/background-db-writes.ts:3-75`).

`CLAUDE.md` already names the aggregate bug: queue and backfill each reserve 5 live connections but do not subtract each other, so concurrent queue processing plus re-encode can pin about 9 of 10 pool connections (`CLAUDE.md:269-284`). This is not just documentation debt; the code still has independent resolvers.

Failure scenario: an admin starts a color backfill while uploads are actively processing. Backfill pins one global lock plus per-image claims and updates; the queue pins per-image claims and transient updates. A live photo page fan-out then queues behind encode-duration holds, and `queueLimit=20` turns a short maintenance overlap into foreground request failures.

Concrete fix: introduce a shared background resource budget, not per-subsystem arithmetic. Model at least `dbPinned`, `dbTransient`, `sharpCpu`, and `clipInference` permits. Queue workers, backfill workers, analytics drains, and CLIP generation should acquire from the same budget before work starts. Add a stress test with pool size 10, queue concurrency 2, backfill concurrency 2, and concurrent foreground `getImage()` calls to prove at least one full page fan-out retains headroom.

### AC25-03 - Single-writer topology is a correctness contract, but enforcement is warn-only

Severity: Medium-High
Confidence: High
Status: Confirmed runtime-topology risk

The project is explicitly single-web-instance/single-writer: process-local restore fencing, upload quota tracking, queue state, backfill status, and some rate-limit fast paths are not safe across horizontally scaled web processes (`CLAUDE.md:244-249`). The guard documents that it "cannot enforce single-instance operation" and "must never block" boot (`apps/web/src/lib/single-writer-guard.ts:7-16`). When contention is detected, it logs a loud error and continues startup (`apps/web/src/lib/single-writer-guard.ts:218-235`). Startup wires the guard fire-and-forget and non-fatal (`apps/web/src/instrumentation.ts:22-31`).

Failure scenario: a second container is started by a manual operator, a failed deploy leaves an old process alive, or a future orchestrator runs two replicas. Both processes continue serving. Upload quota maps, queue dedupe, background analytics, and restore-maintenance process state split. Some DB advisory locks prevent specific double-writes, but the overall topology invariant is already broken by the time logs are noticed.

Concrete fix: make topology part of readiness, not only logs. Either fail readiness/startup on persistent singleton-lock contention unless an explicit `ALLOW_UNSAFE_MULTI_WRITER=true` override is set, or move all process-local correctness state to shared/durable coordination before permitting more than one web process. The guard can still tolerate brief rolling-deploy overlap with the existing reprobe window, but persistent contention should take the new process out of service.

### AC25-04 - The storage abstraction is quarantined, not the live storage boundary

Severity: Medium
Confidence: High
Status: Confirmed boundary/design risk, not an immediate live defect

`apps/web/src/lib/storage/index.ts` states that the storage abstraction is local-only and "not yet wired into the live image pipeline" (`apps/web/src/lib/storage/index.ts:4-12`). Live upload and serving still use direct filesystem paths via `UPLOAD_ROOT`, `UPLOAD_DIR_ORIGINAL`, and sibling directories (`apps/web/src/lib/upload-paths.ts:12-47`, `apps/web/src/lib/upload-paths.ts:59-88`). Public serving constructs filesystem paths directly from `UPLOAD_ROOT` (`apps/web/src/lib/serve-upload.ts:198-229`).

The project wisely has a quarantine test preventing accidental production imports of `@/lib/storage` (`apps/web/src/__tests__/storage-quarantine.test.ts:1-27`, `apps/web/src/__tests__/storage-quarantine.test.ts:111-132`). That makes this lower urgency than an active bug, but it means the named storage boundary is deliberately not the boundary of the product.

Failure scenario: a future change removes or relaxes the quarantine to use `getStorage()` for one write/read path, while originals, derivatives, deletes, ETag behavior, GPS stripping, symlink/path hardening, and public serving remain on direct fs helpers. The system would then have two storage contracts with different safety properties.

Concrete fix: keep the quarantine until a deliberate migration is ready, or delete the abstraction if it is not on the roadmap. If integrating it, route originals, derivatives, deletion, serving, ETag/hash invalidation, and backup/restore semantics through one storage service in the same change, with end-to-end tests for GPS strip, path traversal, derivative serving, and cleanup-on-insert-failure.

### AC25-05 - Semantic and similar search use bounded newest-first brute-force scans

Severity: Medium
Confidence: High
Status: Confirmed scalability and recall limitation

The shared semantic scan limit defaults to 2,000 and hard-caps at 25,000 (`apps/web/src/lib/clip-embeddings.ts:36-48`). Semantic search reads the most recently updated embeddings, scores them in application memory, and returns `topK` from only that slice (`apps/web/src/app/api/search/semantic/route.ts:263-311`). Similar search uses the same newest-first scan pattern (`apps/web/src/app/api/search/similar/[id]/route.ts:177-214`).

Failure scenario: a relevant older image outside the scan window is unfindable regardless of similarity. Raising the limit improves recall but increases MEDIUMBLOB reads and CPU per request. This is acceptable for a small/personal gallery, but it becomes a product correctness issue when semantic search is presented as whole-gallery search.

Concrete fix: expose the recall boundary in operator docs/UI, add telemetry for scanned row count and oldest scanned embedding age, and graduate to a vector index or durable in-memory normalized matrix when gallery size exceeds the bounded-scan assumption. Until then, search copy should not imply exhaustive whole-gallery recall.

### AC25-06 - Public map still hydrates/renders up to 10k markers and duplicates them in a list

Severity: Medium
Confidence: High
Status: Confirmed scale risk

The server intentionally caps map rows at `MAP_MAX_MARKERS = 10000` (`apps/web/src/lib/data.ts:1766-1816`). The page maps every returned image to a client marker and also renders every marker again in an accessible list (`apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/app/[locale]/(public)/map/page.tsx:98-110`). The Leaflet client computes bounds over every marker and renders one `<Marker>` per item (`apps/web/src/components/map/map-client.tsx:77-95`, `apps/web/src/components/map/map-client.tsx:120-141`).

Failure scenario: the DB no longer performs an unbounded query, but the client can still ship and hydrate thousands of markers plus list rows on every `/map` request. On mobile this becomes a slow page or tab crash before the user sees the truncation notice.

Concrete fix: move from global marker hydration to viewport-bbox queries, clustering, and a virtualized/non-duplicated accessible list. If a simple interim is needed, lower the public cap based on measured mobile payload/hydration limits and add a paged/list-only fallback for overflow.

### AC25-07 - The server-action barrel keeps domain boundaries soft

Severity: Low-Medium
Confidence: Medium
Status: Confirmed layering smell

`apps/web/src/app/actions.ts` re-exports auth, images, topics, tags, sharing, admin users, public actions, SEO, and settings from one import surface (`apps/web/src/app/actions.ts:1-34`). The action-origin lint recognizes it as an action barrel, so this is not a missing guard. The issue is architectural: client and server call sites can depend on a broad mixed-domain facade instead of importing the narrow module they use.

Failure scenario: dependency direction and ownership become harder to audit. A future client component imports from `@/app/actions` for convenience and accidentally pulls in a broader server-action surface than intended, making domain-specific review and tree-shape reasoning worse.

Concrete fix: keep the barrel only for backward compatibility. New code should import from domain modules. Add a lint rule or source-contract test that prevents new imports from `@/app/actions` outside an allowlist, then migrate existing callers opportunistically.

## Risks Needing Manual Validation

### AC25-R01 - Host NGINX/real-IP limiter topology is not proven by app deploy

Severity: High if proxy topology is wrong
Confidence: Medium
Status: Needs live-host validation

The shipped NGINX config defines per-IP zones with `$binary_remote_addr` and explicitly warns that LB-fronted topologies need realip or PROXY protocol support (`apps/web/nginx/default.conf:1-29`). The server block also warns that overwriting `X-Forwarded-For` with `$remote_addr` is correct only when the connector is the real client (`apps/web/nginx/default.conf:52-72`, `apps/web/nginx/default.conf:297-306`). The public page limiter is config-only and must be manually applied/reloaded; deploys do not touch host NGINX (`apps/web/nginx/default.conf:274-294`). The deploy script rebuilds/starts the container and health-checks it, but does not validate host NGINX state (`apps/web/deploy.sh:51-77`).

Failure scenario: production is behind a TLS/LB hop but NGINX buckets every visitor under the LB IP, causing global lockouts/429s, or the host is still running stale NGINX config with no public SSR limiter. App quality gates would still pass.

Concrete validation/fix: capture `nginx -T` from the host after deploy, verify `set_real_ip_from`/`real_ip_header` or PROXY protocol for the actual topology, and add a live probe that confirms the app-observed client IP and NGINX limiter key behavior. Consider making deploy print a warning when NGINX config checksum differs from the repo file or when the live host cannot prove the expected limiter.

### AC25-R02 - Migration source tripwires are strong, but live schema equivalence still needs DB validation after schema changes

Severity: Medium-High after schema work
Confidence: Medium
Status: Needs manual or integration validation on real DB

`migrate.js` has strong guards for DML-bearing migrations, per-entry baselining, pending-tail handling, reconcile, and postcondition checks (`apps/web/scripts/migrate.js:185-227`, `apps/web/scripts/migrate.js:777-860`, `apps/web/scripts/migrate.js:877-993`). Reconcile mirrors current schema columns and drops known removed objects (`apps/web/scripts/migrate.js:430-484`, `apps/web/scripts/migrate.js:760-769`). Tests pin journal monotonicity and the skipped-hash postcondition (`apps/web/src/__tests__/migration-journal-monotonicity.test.ts:1-28`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:56-120`) and source-scan reconcile coverage (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:1-20`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:124-180`).

The remaining gap is explicitly acknowledged by the test: the reconcile coverage check is a source tripwire, not a structural validator (`apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-19`). It cannot prove types, defaults, collation, indexes with exact shape, live DB drift, or host-specific migration state.

Concrete validation/fix: after every schema/migration change, run a fresh-DB init and an existing-DB migration against MySQL, then compare `information_schema` against Drizzle/schema expectations. Persist the diff output or a summarized artifact in the deploy/runbook evidence.

### AC25-R03 - Build-time vs runtime config split can diverge after restart-only changes

Severity: Medium
Confidence: Medium
Status: Needs operational validation

`IMAGE_BASE_URL` is parsed in `next.config.ts` and feeds Next image `remotePatterns` at build time (`apps/web/next.config.ts:32-40`, `apps/web/next.config.ts:121-125`). Docker passes `BASE_URL`, `IMAGE_BASE_URL`, and upload limits as build args before `npm run build` (`apps/web/Dockerfile:91-120`, `apps/web/docker-compose.yml:4-11`). The site-config bind mount is read-only but the compose comment says JSON imports are build-time inlined and runtime edits have no effect until rebuild (`apps/web/docker-compose.yml:24-32`).

Failure scenario: an operator changes `.env.local` or `site-config.json` and restarts without rebuilding. Runtime env and baked Next config then diverge; image optimization, URLs, CSP/proxy assumptions, or user-facing metadata can be stale while the container is healthy.

Concrete validation/fix: add a post-deploy probe that reports the baked build-time values relevant to images/site config beside runtime env values. Fail or warn loudly when a restart-only change cannot affect the running build.

### AC25-R04 - Fire-and-forget analytics are approximate by contract

Severity: Low now, Medium if analytics become product/audit state
Confidence: High
Status: Accepted design risk needing product validation

Photo view recording intentionally does not await the INSERT and swallows errors so analytics never blocks page render (`apps/web/src/app/actions/public.ts:435-470`). The analytics queue is in-memory, fixed at concurrency 2, and drops work when pending writes reach 1000 (`apps/web/src/lib/background-db-writes.ts:3-75`). `CLAUDE.md` documents shared-group view counts as best-effort and lost on crash/SIGKILL (`CLAUDE.md:249`).

Failure scenario: this is fine for approximate popularity metrics, but not fine if view counts are later used for billing, audit, ranking guarantees, or creator reporting. A process kill, restore window, or DB outage can undercount delivered views.

Concrete fix: keep UI/reporting copy clear that these are approximate, or move analytics events to durable storage/queue before using them as product-critical metrics.

## Validation And Missed-Issue Sweep

Commands run:

- `npm run lint:api-auth --workspace=apps/web` - passed.
- `npm run lint:action-origin --workspace=apps/web` - passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` - passed.
- Static sweep for `dangerouslySetInnerHTML`, `eval`, `new Function`, TODO/FIXME/HACK: only expected JSON-LD injection sites and comments/tests appeared in the reviewed output.
- Static sweep for advisory locks, raw DB execution, and process spawning: results matched known migration, backfill, restore, queue, and admin DB-action surfaces inspected above.
- Storage import sweep: no production source import of `@/lib/storage` outside the quarantined storage module; quarantine test enforces this.

No full `lint`, `typecheck`, `build`, or full test suite was run because this was a review-only lane with no product-code changes. The three targeted guard linters provide evidence that the current route/action auth and rate-limit contracts still hold during this review.

## Final Missed-Issue Sweep Result

I did not find a new missing admin API auth wrapper, missing mutating server-action origin guard, or missing public route rate-limit guard. The highest-confidence new/continuing architectural concerns remain the manually duplicated ingest paths and the non-global background resource budget. Several other items are known bounded-design risks rather than immediate defects: warn-only single-writer enforcement, quarantined storage abstraction, bounded semantic recall, map marker scale, and approximate analytics.
