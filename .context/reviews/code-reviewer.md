# Cycle 21 Code Reviewer Report

Date: 2026-07-08 KST
Role: `code-reviewer`
Review HEAD: `45b32d1db373e03d82a29511f53832051c770880`
Scope: repository-wide code quality, logic, SOLID, maintainability, shared-state, error handling, and cross-file correctness review.

## Inventory

Required guidance read first:
- `AGENTS.md`
- `CLAUDE.md`
- `.context/plans/README.md`
- `code-review` skill instructions from `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Review-relevant file inventory built before findings:
- App routes/actions/source: 80 files under `apps/web/src/app`.
- Core libraries: 114 files under `apps/web/src/lib`.
- UI/client components: 61 files under `apps/web/src/components`.
- Tests: 358 Vitest files under `apps/web/src/__tests__`.
- E2E: 12 files under `apps/web/e2e`.
- Scripts: 29 files under `apps/web/scripts`.
- Migrations/schema journal: 33 files under `apps/web/drizzle`.
- Behavior-affecting configs/docs reviewed: root/app `package.json`, `apps/web/next.config.ts`, `apps/web/drizzle.config.ts`, `apps/web/eslint.config.mjs`, `apps/web/playwright.config.ts`, `apps/web/vitest.config.ts`, `apps/web/Dockerfile`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, `apps/web/messages/{en,ko}.json`, `README.md`, `apps/web/README.md`, `CLAUDE.md`, `.context/plans/README.md`, current cycle plan/deferred/aggregate files.

Cross-file areas examined:
- Auth/origin/rate-limit contracts across API routes, server actions, and scanner scripts.
- Browser upload, Lightroom/PAT upload, original-file persistence, image queue, image processing, retry, cleanup, and restore-maintenance interactions.
- Data-access listing/search/map/smart-collection/shared-link query shapes and privacy select fields.
- DB schema, migration journal, migration reconcile/post-condition scripts, and deployment helper behavior.
- Service worker source/generated parity, public route revocability, upload serving, CSP/OG/feed/JSON-LD helper boundaries.
- Tests that enforce the above contracts, especially source-contract tests around privacy, touch targets, queue failures, migration coverage, and route/action lint gates.

Validation evidence gathered during this review:
- `git rev-parse HEAD` returned `45b32d1db373e03d82a29511f53832051c770880`.
- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- Migration journal spot-check found 30 entries, latest `when` `1783397921062`, and matching current tail entries through `0029_feed_updated_indexes`.
- Full `npm run lint`, `npm run typecheck`, `npm run build`, `npm test`, and Playwright were not run in this review lane.

## Confirmed Issues

### CR21-01 - Claim-exhaustion permanent failures bypass the bounded-set eviction contract

- Severity: Medium
- Confidence: High
- Code region:
  - `apps/web/src/lib/image-queue.ts:112-113` defines `MAX_PERMANENTLY_FAILED_IDS = 1000`.
  - `apps/web/src/lib/image-queue.ts:320-324` documents `permanentlyFailedIds` as a FIFO-bounded set.
  - `apps/web/src/lib/image-queue.ts:767` adds a claim-exhausted job to `state.permanentlyFailedIds` with no cap enforcement.
  - `apps/web/src/lib/image-queue.ts:1029-1041` enforces the cap only on the normal processing-failure add path.
  - `apps/web/src/lib/image-queue.ts:1155-1156` expands the whole set into a `notInArray(images.id, [...state.permanentlyFailedIds])` bootstrap predicate.
- Failure scenario: if many different jobs repeatedly fail to acquire their per-image processing claim, each reaches the claim-exhaustion branch and is added at line 767. Unlike the normal `MAX_RETRIES` branch, this path never evicts old IDs or cleans retry/error maps. A leaked lock, multi-process contention, or lock acquisition anomaly can grow the process-local set beyond the documented cap, making later bootstrap scans build increasingly large `NOT IN (...)` predicates.
- Suggested fix: extract one helper, for example `markPermanentlyFailed(state, id)`, that adds the ID, enforces FIFO eviction, and deletes `claimRetryCounts`, `retryCounts`, and `lastErrors` for evicted IDs. Use it at both add sites. Add a test that proves all `permanentlyFailedIds.add(...)` calls go through the helper or exercises claim exhaustion past the cap.

### CR21-02 - Browser and PAT uploads duplicate one ingest transaction contract

- Severity: High
- Confidence: High
- Code region:
  - `apps/web/src/app/actions/images.ts:129-270` handles browser upload auth, restore fence, config snapshot, quota checks, and quota claim.
  - `apps/web/src/app/actions/images.ts:377-560` saves originals, gates HDR/GPS, inserts image rows, creates tag links, and enqueues processing.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:84-185` repeats PAT upload auth/body/quota/parse admission.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:254-587` repeats restore/config/topic/disk/save/HDR/GPS/insert/enqueue/audit behavior.
  - The two hot paths are large and parallel in shape: the reviewed slices are about 326 lines for browser ingest and about 504 lines for PAT ingest.
- Failure scenario: a future upload-time field or invariant is added to one adapter only. This has a concrete blast radius: privacy flags, GPS stripping, HDR gates, processing snapshots, color metadata, alt-text inputs, audit attribution, and cleanup must remain identical across both paths. Because the contracts are implemented by parallel code instead of a shared service, the next small feature can silently create divergent production behavior between web admin uploads and external publish-client uploads.
- Suggested fix: extract a shared authenticated ingest service that owns the transaction-level contract: config snapshot, quota claim settlement, topic validation, original save/cleanup, metadata normalization, DB insert, tag attach, queue payload, audit data, and revalidation signals. Keep only request parsing/auth/response shaping in the Server Action and Route Handler. Add parity tests that feed the same synthetic image metadata through both adapters and assert identical inserted columns and queue jobs.

## Likely Issues

### CR21-03 - Large binary ingress still depends on framework multipart materialization

- Severity: High
- Confidence: High for source shape, Medium for live impact without RSS traces
- Code region:
  - `apps/web/src/app/actions/images.ts:129-148` receives browser uploads as `FormData`/`File` objects before domain logic.
  - `apps/web/src/app/api/admin/lr/upload/route.ts:174-181` calls `await request.formData()` for PAT uploads.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:407-420` documents restore as a 250 MB Server Action body before `restoreDatabase(formData)`.
  - `apps/web/src/app/[locale]/admin/db-actions.ts:717-720` pulls the restore `File` from already-materialized `FormData`.
  - `apps/web/next.config.ts:111-119` sets the framework body budget to `NEXT_SERVER_ACTION_BODY_SIZE_LIMIT`.
  - `apps/web/src/lib/upload-limits.ts:1-6` sets 200 MiB upload and 250 MiB restore app-level caps plus multipart overhead.
- Failure scenario: near-limit upload or restore bodies are accepted by the framework parser and materialized before most app-level validation can stream to controlled temp storage. In the single web process, that transient memory/temp-file pressure competes with public SSR, Sharp processing, CLIP inference, and DB work. Multiple valid requests can therefore create latency or OOM risk even when all later domain checks behave correctly.
- Suggested fix: move large binary ingress to streaming Route Handlers with content-length prechecks, per-part limits, a process-wide large-body semaphore, temp-file handoff, and shared upload/restore services. Keep Server Actions for small metadata-only mutations.

### CR21-04 - Cached shared-group reader still owns a view-count side effect

- Severity: Medium
- Confidence: Medium
- Code region:
  - `apps/web/src/lib/data.ts:1392-1407` buffers a denormalized shared-group `view_count` increment inside `getSharedGroup`.
  - `apps/web/src/lib/data.ts:1830-1834` wraps that reader in `cache(getSharedGroup)` while warning callers not to mix count semantics.
  - `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:111-142` calls `getSharedGroupCached(key, { selectedPhotoId })` and separately records durable analytics with `recordSharedGroupView`.
  - `apps/web/src/app/actions/public.ts:518-559` records the durable `shared_group_views` row in a separate fire-and-forget path.
- Failure scenario: a future metadata/layout/preload path calls `getSharedGroupCached` with different options in the same render tree. React `cache()` dedupes by arguments, so call order and option shape can decide whether the denormalized `view_count` buffer runs, while the durable analytics row is triggered elsewhere. The current page is careful, but the data-layer API remains foot-gun shaped: a function named like a pure reader can mutate process-local analytics state.
- Suggested fix: split `getSharedGroup` into a pure cached reader and an explicit `bufferSharedGroupViewCount` orchestration step owned by the page/action layer. Add a test that repeated cached shared-group reads are side-effect-free.

## Manual-Validation Risks

- Shared background resource budget: `apps/web/src/lib/image-queue.ts:121-153`, `apps/web/src/lib/admin-backfill-runner.ts:130-142`, and `apps/web/src/db/index.ts:31-45` each reason locally about a 10-connection pool. Live overlap between queue processing, admin backfill, semantic work, and public SSR still needs production traces before choosing a global budget.
- Semantic/similar search scan cost: `apps/web/src/app/api/search/semantic/route.ts:263-311` and `apps/web/src/app/api/search/similar/[id]/route.ts:177-214` intentionally perform bounded request-local vector scans. The code is bounded, but real CLIP production activation should validate CPU, RSS, DB bandwidth, and tail latency.
- Public map payload scale: `apps/web/src/lib/data.ts:1766-1816` caps exact-coordinate map payloads at 10,000 rows and `apps/web/src/components/map/map-client.tsx:120-138` renders one marker per row. This remains a product/performance validation risk for location-rich galleries.
- Host nginx protections: repo/deploy code does not prove the live host has applied `apps/web/nginx/default.conf`; `CLAUDE.md` says host nginx changes are manual. This is an operator validation risk, not a missing source guard.

## Final Sweep

Relevant categories inspected:
- Source routes/actions/libs/components under `apps/web/src`.
- Scripts under `apps/web/scripts`.
- Migrations and journal under `apps/web/drizzle`.
- Unit and E2E test inventory under `apps/web/src/__tests__` and `apps/web/e2e`.
- Behavior docs and configs that affect runtime, build, deploy, schema, i18n, and quality gates.

Categories not inspected as executable behavior:
- `node_modules`, `.next`, build/cache artifacts, uploaded image/resource/data stores, screenshots, and historical review/plan logs except where current repo instructions cite them as contracts.

Findings summary:
- Confirmed issues: 2
- Likely issues: 2
- Manual-validation risks: 4
