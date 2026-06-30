# Critic Review - Cycle 21

Reviewer: critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `2cc619bb` (`fix(cycle20): close review-plan-fix findings`)
Mode: skeptical whole-repo critique. Implementation code was not edited.

## Inventory Reviewed

- Required guidance: `AGENTS.md` and `CLAUDE.md`.
- Current change surface: clean `master` at `2cc619bb`, `.context/plans/cycle-21-plan.md`, `.context/plans/cycle-21-deferred.md`, recent cycle-20 critic findings, and cycle-21 fixed/deferred notes.
- Source inventory: repository file list under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, `apps/web/public`, root/app docs, deploy files, and review/plan history.
- Product/UI paths: public masonry home, topic/smart collection listing, map, semantic/similar search, photo viewer, admin pages, i18n messages, and focus/touch accessibility guards.
- Backend/ops paths: browser upload, Lightroom/API upload, image processing queue, upload trackers, restore maintenance, rate limiting, semantic embeddings, DB pool, migrations, Docker/deploy, and runtime topology docs.
- Test/guard paths: custom lint scanners, Vitest source-contract tests, privacy guard tests, focus-visible scanner, deployment tests, image input pixel test, map/search route tests, and existing deferred-test inventory.

Validation evidence consulted:

- `git status --short --branch` showed `## master...origin/master` before writing this artifact.
- Targeted line sweeps over upload, Lightroom, queue, DB pool, rate-limit, semantic/similar routes, map, home load-more, restore-maintenance, `CLAUDE.md`, and cycle-21 plan/deferred files.
- I did not run full lint/typecheck/build/unit/e2e gates in this critic-only pass; this artifact is a review document.

## Findings

### CRIT21-01 - Image processing can pin most of the shared MySQL pool while doing Sharp work

- Severity: MEDIUM
- Confidence: High
- Category: architecture / correctness / operations
- Region: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:87-90`, `apps/web/src/lib/image-queue.ts:446-472`, `apps/web/src/lib/image-queue.ts:513-520`, `apps/web/src/lib/image-queue.ts:622-637`, `apps/web/src/lib/image-queue.ts:812-815`
- Problem: the pool has `POOL_CONNECTION_LIMIT = 10`, but `QUEUE_CONCURRENCY` can be raised to 8. Each queue worker acquires a MySQL advisory lock by checking out a pool connection and keeps that same connection until the job's `finally`. The protected window includes filesystem access and `processImageFormats(...)`, which is CPU/file-heavy Sharp work rather than DB work.
- Failure scenario: an operator raises `QUEUE_CONCURRENCY=8` to drain a large upload/backfill queue. Eight workers pin eight of ten shared DB connections during image encoding. Live requests, login/session checks, semantic/search DB reads, upload quota checks, and admin actions then contend for the two remaining connections plus a pool queue of only 20, causing avoidable timeouts and cascading 500/503 responses even though the database itself is healthy.
- Suggested fix: release DB pool capacity before the Sharp phase. Options: use a dedicated small advisory-lock pool; replace the long advisory lock with a durable row claim/state transition; or cap queue concurrency using the same pool-budget arithmetic documented for backfill (`POOL_CONNECTION_LIMIT` with reserved live capacity). Add a stress/regression test that asserts max queue concurrency cannot pin more than the reserved background budget.

### CRIT21-02 - Upload ingest remains a duplicated lifecycle across browser and Lightroom paths

- Severity: MEDIUM
- Confidence: High
- Category: architecture / product correctness / security
- Region: `apps/web/src/app/actions/images.ts:175-242`, `apps/web/src/app/actions/images.ts:247-293`, `apps/web/src/app/actions/images.ts:340-461`, `apps/web/src/app/actions/images.ts:499-531`, `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`, `apps/web/src/app/api/admin/lr/upload/route.ts:114-151`, `apps/web/src/app/api/admin/lr/upload/route.ts:225-275`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-477`, `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`
- Problem: the Lightroom route claims it reuses existing upload infrastructure, but the two ingest paths still independently own quota claim/settle, config snapshot timing, disk precheck, topic validation, HDR rejection, GPS stripping, restore-maintenance windows, insert DTOs, processing snapshot serialization, and queue job construction. Recent comments show many parity fixes landed in one path after the other had drifted, which is evidence of an active failure mode rather than a theoretical style issue.
- Failure scenario: a future admin-only processing/privacy setting is added to `ProcessingSettingsSnapshot`, or a new upload-time gate is introduced. The browser path forwards or enforces it, while the Lightroom/PAT route misses one field or branch. Photos uploaded by different clients then get different retained originals, derivatives, metadata, captions, or semantic embeddings until a manual backfill catches up.
- Suggested fix: extract a server-only ingest service that accepts an authenticated actor, safe file object, topic, optional metadata, and response-local wording hooks, then owns save -> validate -> insert -> enqueue. Keep browser actions and API routes as thin auth/body/i18n adapters. Add an exhaustiveness test that fails when `ProcessingSettingsSnapshot` or `ImageProcessingJob` gains a field not forwarded by the shared builder.

### CRIT21-03 - Public map still ships and hydrates up to 10,000 markers at once

- Severity: LOW
- Confidence: High
- Category: UI / performance / product scale
- Region: `apps/web/src/lib/data.ts:1649-1658`, `apps/web/src/lib/data.ts:1667-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-50`, `apps/web/src/app/[locale]/(public)/map/page.tsx:68-89`, `apps/web/src/components/map/map-client.tsx:118-140`
- Problem: cycle history added a hard SQL cap, but the product surface is still all-or-nothing. `getMapImages()` can return 10,000 GPS rows, `MapPage` serializes all of them into the RSC/client payload, the fallback list renders one link per marker, and Leaflet mounts one `<Marker>` per marker. The code comment itself says galleries beyond this need bbox filtering or clustering, but the current page has no progressive boundary before that cap.
- Failure scenario: a photographer enables map visibility for a GPS-heavy archive. Mobile users receive a very large payload, hydrate thousands of fallback links, and mount thousands of Leaflet markers. The page can become unresponsive or crash before the user performs any map interaction, especially because `revalidate = 0` makes every request dynamic.
- Suggested fix: move the map to viewport-bounded data loading with server-side bbox filtering, marker clustering, and/or a visible cap with pagination for the accessible fallback list. If full-map behavior must remain, lower the initial payload cap and lazy-load additional regions after map movement.

### CRIT21-04 - Semantic rate-limit helper documentation contradicts the route-level charging policy

- Severity: LOW
- Confidence: High
- Category: security / maintainability / docs-code contract
- Region: `apps/web/src/lib/rate-limit.ts:24-35`, `apps/web/src/lib/rate-limit.ts:361-378`, `apps/web/src/app/api/search/semantic/route.ts:173-200`, `apps/web/src/app/api/search/similar/[id]/route.ts:98-125`
- Problem: the top-level rate-limit contract says semantic and similar requests stay charged after DB-backed mode lookup, including disabled-mode responses. The helper-level `rollbackSemanticAttempt` comment still says rollback is used for requests that exit before embedding/vector-scan work, "for example disabled mode." The live routes correctly keep disabled-mode/stub-mode failures charged after the config lookup.
- Failure scenario: a future maintainer follows the helper comment rather than the route comments and refunds disabled-mode or post-config exits. That reopens a low-cost amplification path where callers can repeatedly force body/config work or mode probes without consuming the semantic limiter.
- Suggested fix: update the helper comment to remove the disabled-mode example and define rollback as pre-admission-only. Consider splitting the API into `rollbackSemanticPreAdmissionOnly()` or adding a source-contract test that asserts semantic/similar disabled-mode branches do not call rollback.

### CRIT21-05 - Runtime single-instance constraints are documented but not guarded at startup

- Severity: MEDIUM when scaled; LOW in the shipped single-container topology
- Confidence: High
- Category: operations / correctness / architecture
- Region: `CLAUDE.md:232-235`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/image-queue.ts:76-90`, `apps/web/src/app/api/admin/lr/upload/route.ts:78-83`, `apps/web/src/app/actions/images.ts:398-410`
- Problem: `CLAUDE.md` accurately states the deployment is single web-instance/single-writer because restore maintenance flags, upload quota tracking, queue state, some rate-limit buckets, and view-count buffers are process-local. The code implements the restore-maintenance fence as a `globalThis` flag, and upload/LR paths check that local flag. There is no startup/runtime lease, replica-count assertion, or health warning that prevents a second web process from entering service with independent flags and buffers.
- Failure scenario: an operator changes Compose/Kubernetes/systemd to run two web processes for availability. One process starts a DB restore and sets its local maintenance flag while the other continues accepting uploads and queue work because its `globalThis` flag is false. The result can be writes racing restore assumptions, quota/rate-limit bypass by process distribution, and misleading admin status surfaces.
- Suggested fix: add a startup guard or shared lease that enforces the documented single-writer topology unless a distributed coordination backend is configured. For restore maintenance specifically, move the active flag to MySQL/advisory lock plus a durable status row so every process observes the same fence.

### CRIT21-06 - Home infinite scroll keeps every loaded image in React state and DOM

- Severity: LOW
- Confidence: High
- Category: UI / performance / product scale
- Region: `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-410`, `apps/web/src/components/load-more.tsx:122-129`, `.context/plans/cycle-21-deferred.md:119-131`
- Problem: `HomeClient` appends each loaded page with `setAllImages(prev => [...prev, ...newImages])`, then renders every loaded item in the masonry grid. `LoadMore` triggers automatically via an `IntersectionObserver`, so a long browsing session grows React state, the DOM, image observers, and layout work without a window or cap. This is already tracked as a deferred cycle-21 performance item, but it remains part of the current product risk surface.
- Failure scenario: a large gallery session loads hundreds or thousands of photos. Every append copies the full prior image array, and every render walks the full loaded set. On mobile Safari or lower-memory devices, scroll performance and memory degrade until the tab reloads or is killed.
- Suggested fix: introduce list/window management for loaded pages, cap auto-loading before requiring explicit pagination, or move to a virtualized masonry strategy that preserves scroll restoration without keeping all cards live.

## Closed Or Not Reopened From Cycle 20

- Deploy build/runtime env drift appears closed: `apps/web/deploy.sh` now invokes Docker Compose with `--env-file apps/web/.env.local`, and deploy tests cover forwarded upload limit env.
- Smart collection rate-limit rollback after private/missing collection lookup appears closed: the public action now keeps the pre-increment charged for those DB-backed outcomes.
- Semantic/similar abort handling appears improved: the routes now check `isRequestAborted()` around config, body, embedding, and bounded scan stages.
- CLIP semantic env defaults and documentation appear aligned on `SEMANTIC_SCAN_LIMIT=2000` and `SEMANTIC_SCAN_CONCURRENCY=50`.
- Focus-visible scanning is now present via `apps/web/src/__tests__/focus-visible-links-scan.test.ts`; I did not independently audit every UI element beyond the targeted source sweep.

## Final Missed-Issues Sweep

- Docs/code contradictions found: semantic rollback helper comment vs route-level policy; single-instance runtime warning vs lack of enforcement.
- Product constraints checked: photographer intent/no edit scoring still appears respected in reviewed surfaces; GPS privacy relies on known public map opt-in exception.
- Security surfaces checked: admin API wrapper and origin/rate-limit scanner policies were inventoried, but I did not rerun the scanners in this critic-only pass.
- Operational risks checked: DB pool starvation, process-local coordination, deploy env drift, and restore/upload interactions.
- Test risks checked: known deferred items remain in `.context/plans/cycle-21-deferred.md`; no new test execution was performed for this document.

Finding count: 6
