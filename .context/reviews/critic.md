# Critic Review - Cycle 20

Reviewer: critic
Repository: `/Users/hletrd/flash-shared/gallery`
HEAD reviewed: `5c55b68c` (`docs(clip): clarify semantic search operations`)
Mode: skeptical whole-repo critique. Implementation code was not edited.

## Inventory Reviewed

- Required guidance: `AGENTS.md` from the prompt and `CLAUDE.md`.
- Prior/current context: current modified `.context/reviews/*.md`, review archive inventory, `.context/plans/README.md`, recent gate logs, and current dirty-worktree state.
- Source inventory: 572 code/config/test/script/migration/public files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `apps/web/e2e`, and `apps/web/public`, plus root/app docs and deploy files.
- Product/UI paths: public pages, photo viewer/lightbox/navigation, map, masonry/load-more, search/similar UI, admin pages, i18n messages, service worker.
- Backend/ops paths: server actions, API routes, auth/session/token wrappers, upload and Lightroom ingest, image queue/backfill, CLIP semantic search, DB restore/backup, migrations/reconcile, Docker/deploy/nginx.
- Test/guard paths: Vitest and Playwright specs, custom lint scanners, privacy guards, source-contract tests, migration journal tests, touch-target/focus tests, deployment tests.

Validation evidence consulted:

- Existing cycle-20 peer reports recorded passing `lint:api-auth`, `lint:action-origin`, `lint:public-route-rate-limit`, targeted Vitest slices, and `npm audit --omit=dev`.
- I did not run full lint/typecheck/build/all-unit/e2e in this critic-only pass.

## Confirmed Issues

### CRIT20-01 - Upload ingest remains a parallel-controller contract

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed maintainability / architecture issue
- Region: `apps/web/src/app/actions/images.ts:114-190`, `apps/web/src/app/actions/images.ts:350-461`, `apps/web/src/app/actions/images.ts:499-531`, `apps/web/src/app/actions/images.ts:1227-1280`, `apps/web/src/app/api/admin/lr/upload/route.ts:15-18`, `apps/web/src/app/api/admin/lr/upload/route.ts:225-275`, `apps/web/src/app/api/admin/lr/upload/route.ts:307-452`, `apps/web/src/app/api/admin/lr/upload/route.ts:479-516`, `apps/web/src/lib/image-queue.ts:92-120`
- Problem: browser upload, Lightroom/API upload, and failed-image retry all construct the ingest lifecycle and queue job by hand. The Lightroom route says it reuses existing infrastructure, but route/action adapters still own save, HDR/GPS gates, insert values, processing snapshot serialization, and enqueue fields.
- Concrete scenario: a new processing or privacy setting is added to `ProcessingSettingsSnapshot`. Browser upload forwards it, but the Lightroom route or retry path misses it. Photos ingested through different clients then produce different bytes or metadata until a later backfill rewrites them.
- Suggested fix: extract one server-only ingest service or builder that owns config snapshot creation, original-save gates, image insert DTOs, and `ImageProcessingJob` construction. Keep routes as auth/body/localization adapters. Add an exhaustiveness test that fails when `ProcessingSettingsSnapshot` gains a field without the shared builder forwarding it.

### CRIT20-02 - Docker build-time configuration can diverge from runtime `.env.local`

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed operational risk
- Region: `apps/web/docker-compose.yml:4-21`, `apps/web/deploy.sh:15-31`, `apps/web/Dockerfile:64-70`, `apps/web/next.config.ts:28-105`, `apps/web/src/lib/upload-limits.ts:19-33`, `apps/web/.env.local.example:12-47`
- Problem: deploy validates `apps/web/.env.local` and passes it to the runtime container, but `docker compose ... up -d --build` does not source it for Compose interpolation. Build args cover only `BASE_URL`, `IMAGE_BASE_URL`, and `UPLOAD_MAX_TOTAL_BYTES`; `NEXT_UPLOAD_BODY_MAX_BYTES` is documented in `.env.local` but shapes `next.config.ts` at build time through `upload-limits.ts`.
- Concrete scenario: an operator sets `IMAGE_BASE_URL` or a larger `NEXT_UPLOAD_BODY_MAX_BYTES` in `.env.local` and deploys. The running container sees those runtime values, but the built Next app may lack the CDN remote pattern/CSP allowance or the larger server-action body cap.
- Suggested fix: make one environment source authoritative for deploy builds. Run Compose with `--env-file apps/web/.env.local`, or wire every build-time key as a build arg and add a contract test that flags build-time env reads not present in Compose/Docker.

### CRIT20-03 - Smart-collection load-more refunds rate limit after a DB-backed slug lookup

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed security/resource-control bug
- Region: `apps/web/src/app/actions/public.ts:197-211`, `apps/web/src/lib/rate-limit.ts:44-57`
- Problem: `loadMoreSmartCollectionImages` pre-increments the public limiter, performs `getSmartCollectionBySlugCached(slug)`, then rolls the limiter back when the slug is missing or private. The shared rate-limit convention says DB/CPU work should stay charged after validation.
- Concrete scenario: an unauthenticated caller repeatedly probes syntactically valid nonexistent/private collection slugs. Each request consumes the collection lookup but refunds the budget, creating a cheap enumeration and DB-pressure path from one IP.
- Suggested fix: keep the attempt charged after the smart-collection lookup. Only refund branches that return before protected work. Add a test asserting nonexistent/private smart-collection slugs do not call `rollbackLoadMoreAttempt`.

### CRIT20-04 - Image queue jobs can pin most of the shared MySQL pool while Sharp runs

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed performance/operational issue
- Region: `apps/web/src/db/index.ts:23-38`, `apps/web/src/lib/image-queue.ts:87-90`, `apps/web/src/lib/image-queue.ts:446-463`, `apps/web/src/lib/image-queue.ts:513-637`, `apps/web/src/lib/image-queue.ts:812-815`
- Problem: each processing job acquires a MySQL advisory-lock connection and holds it across original-path checks, config fallback, and `processImageFormats()`. The pool has 10 connections and `QUEUE_CONCURRENCY` can be raised to 8.
- Concrete scenario: during a large upload, `QUEUE_CONCURRENCY=8` pins eight pool connections through CPU/file-heavy Sharp work while live requests, final row writes, rate limits, search, and admin pages still need the same pool. The pool queue can fill and cause broad latency or acquisition failures.
- Suggested fix: use a short durable DB claim and release the connection before Sharp work, or move processing locks to a dedicated lock pool. At minimum, cap queue concurrency from the same pool-budget arithmetic used by the admin backfill runner.

### CRIT20-05 - CLIP production backfill docs over-promise a one-command full corpus backfill

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed documentation/operations bug
- Region: `apps/web/README.md:68-77`, `CLAUDE.md:520-535`, `apps/web/scripts/backfill-clip-embeddings.ts:116-120`
- Problem: the runbooks tell operators to backfill embeddings for existing photos before flipping production mode, but the script stops each run when `processed + failed` reaches `SEMANTIC_SCAN_LIMIT` and logs that the operator must rerun to continue.
- Concrete scenario: a gallery with 8,000 photos follows the runbook once. Only the first 2,000 rows are embedded by default; production semantic/similar search silently ignores the rest until repeated manual runs finish the backlog.
- Suggested fix: document the per-run cap and stop condition, or add a `--all`/loop mode that processes until no eligible rows remain. Include a final remaining-row count in the script output.

### CRIT20-06 - `SEMANTIC_TOP_K_MAX` default conflicts across docs, examples, code, and tests

- Severity: LOW
- Confidence: High
- Status: Confirmed documentation/config drift
- Region: `CLAUDE.md:115-116`, `CLAUDE.md:545-548`, `apps/web/.env.local.example:78-79`, `apps/web/src/lib/clip-embeddings.ts:22-44`, `apps/web/src/__tests__/clip-semantic-limits-env.test.ts:30-40`
- Problem: the env table and example say the default top-K cap is 24, while code and tests use 50 and a later runtime-limits section says 50.
- Concrete scenario: operators size UI payloads or CPU expectations around a 24-result cap, but production permits 50 unless explicitly configured. Future agents can also "fix" the wrong side because both values look authoritative.
- Suggested fix: choose one value. If 50 remains intended, update `CLAUDE.md` and `.env.local.example`; if 24 is the policy, change `clip-embeddings.ts` and tests.

### CRIT20-07 - Shared semantic rollback comments contradict current charged route policy

- Severity: LOW
- Confidence: High
- Status: Confirmed maintainability/test risk
- Region: `apps/web/src/app/api/search/semantic/route.ts:12-17`, `apps/web/src/app/api/search/semantic/route.ts:173-200`, `apps/web/src/app/api/search/semantic/route.ts:240-257`, `apps/web/src/app/api/search/similar/[id]/route.ts:24-29`, `apps/web/src/lib/rate-limit.ts:24-34`, `apps/web/src/lib/rate-limit.ts:374-377`
- Problem: semantic and similar routes intentionally keep disabled-mode, malformed-after-admission, and DB-backed branches charged. `rate-limit.ts` still says semantic text search refunds short-query rejections and names disabled mode as a rollback example.
- Concrete scenario: a future cleanup follows the shared-library comment, adds rollback for disabled mode or short queries, and reopens the unmetered config/body-probe class that current route tests are trying to keep closed.
- Suggested fix: update the shared comments to match route-local behavior, or change code/tests together if the product policy truly changed. Add a small source-contract test for the policy text if this convention remains security-critical.

## Likely Issues

### CRIT20-08 - Render-time analytics can be triggered by route prefetch, not committed views

- Severity: MEDIUM
- Confidence: Medium
- Status: Likely issue needing runtime validation against current Next.js prefetch behavior
- Region: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:154-156`, `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:284-292`, `apps/web/src/app/[locale]/(public)/[topic]/page.tsx:163-164`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:127-132`, `apps/web/src/components/photo-viewer.tsx:238-264`, `apps/web/src/components/photo-navigation.tsx:220-242`, `apps/web/src/app/actions/public.ts:371-456`
- Problem: photo/topic/share analytics writes are fired from server-rendered pages. The photo experience also prefetches adjacent photo routes through hidden `Link prefetch`, idle `router.prefetch`, and hover prefetch.
- Concrete scenario: opening one photo warms adjacent RSC payloads. If the runtime evaluates those server components, `recordPhotoView` can insert views for photos the visitor never opened and spend the per-IP view-record budget before real views occur.
- Suggested fix: move analytics to a committed client-visible view boundary or a tiny analytics route invoked from a visibility-aware client effect. If server-side recording remains, add a regression that proves adjacent prefetch does not mutate view tables.

### CRIT20-09 - Similar-photo search ignores client aborts while doing bounded vector work

- Severity: LOW-MEDIUM
- Confidence: Medium-High
- Status: Likely resource-waste issue
- Region: `apps/web/src/app/api/search/semantic/route.ts:99-105`, `apps/web/src/app/api/search/semantic/route.ts:247-257`, `apps/web/src/app/api/search/semantic/route.ts:263-316`, `apps/web/src/app/api/search/similar/[id]/route.ts:60-238`, `apps/web/src/lib/clip-embeddings.ts:36-44`
- Problem: semantic text search checks `request.signal` before expensive phases and maps aborts to 499. The sibling similar-photo route never checks `request.signal` while it loads target embeddings, scans up to `SEMANTIC_SCAN_LIMIT`, decodes/scores/sorts, and enriches rows.
- Concrete scenario: a visitor rapidly navigates through photos, aborting old similar-photo fetches. The server continues admitted old requests through DB scan and CPU scoring, competing with live page work.
- Suggested fix: add an abort helper to the similar route and check before charge, before target lookup, before/after scan, before scoring, and before enrichment. Add a route test for an already-aborted request returning before `preIncrementSemanticAttempt`.

### CRIT20-10 - High-cardinality public UI paths still hydrate everything

- Severity: LOW-MEDIUM
- Confidence: High for the code path, Medium for production impact
- Status: Likely scale/UI performance issue
- Region: `apps/web/src/lib/data.ts:1649-1685`, `apps/web/src/app/[locale]/(public)/map/page.tsx:38-89`, `apps/web/src/components/map/map-client.tsx:76-140`, `apps/web/src/components/home-client.tsx:124-130`, `apps/web/src/components/home-client.tsx:286-410`, `apps/web/src/components/load-more.tsx:41-96`, `apps/web/src/components/load-more.tsx:116-132`
- Problem: `/map` can serialize 10,000 markers, hydrate 10,000 fallback links, and mount one Leaflet marker per point. Infinite masonry appends every loaded image into React state and leaves every card in the DOM with no windowing or auto-load cap.
- Concrete scenario: a large GPS-visible gallery opens `/map` on mobile or a visitor scrolls thousands of photos. Hydration, Leaflet layers, style/layout, and image bookkeeping grow linearly with total loaded history and can degrade INP/scroll.
- Suggested fix: page or bbox-load map data with clustering and virtualize/collapse the fallback list. For masonry, introduce windowing or stop auto-loading after a bounded number of pages and switch to explicit pagination.

### CRIT20-11 - Recent behavior-critical fixes are source-pinned rather than behavior-tested

- Severity: MEDIUM
- Confidence: High
- Status: Confirmed test-coverage gap
- Region: `apps/web/src/__tests__/clip-model-contract.test.ts:32-50`, `apps/web/src/__tests__/cycle-19-source-contracts.test.ts:27-54`, `apps/web/package.json:69-85`, `apps/web/e2e/public.spec.ts:61-83`, `apps/web/e2e/test-fixes.spec.ts:49-75`
- Problem: CLIP queue abort/concurrency, bulk-edit reset, mobile swipe scoping, and zoom accessible naming are locked mostly by string assertions. There is no React DOM test harness dependency, and Playwright covers only adjacent smoke behavior.
- Concrete scenario: a refactor keeps strings like `signal.addEventListener('abort')`, `if (!nextOpen) resetState()`, or `swipeTargetRef` while breaking real queue waiter removal, dialog state reset, event binding, or accessible names. Tests stay green.
- Suggested fix: add behavior tests: fake-timer queue tests for saturation/abort/timeout, Playwright tests for bulk-edit submit/reopen reset, mobile swipe only over the media container, and zoom button accessible names containing the photo identity.

## Risks Needing Validation

### CRIT20-R01 - Single-process topology is documented but not enforced

- Severity: MEDIUM if scaled; Low under the current one-container deployment
- Confidence: High that the coupling exists
- Status: Risk needing validation before any topology change
- Region: `apps/web/docker-compose.yml:3-21`, `apps/web/src/lib/restore-maintenance.ts:1-56`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/rate-limit.ts:65-121`, `apps/web/src/lib/admin-backfill-runner.ts:144-250`, `apps/web/src/lib/data.ts:13-41`
- Problem: restore flags, upload quotas, several public/admin-token rate buckets, backfill status, and shared-group view buffers are process-local. The current Compose file runs one container, but startup does not appear to assert single-writer/single-process operation.
- Concrete scenario: a future PM2 cluster, second container, or autoscaled platform splits these states. One process can accept uploads during another process's restore maintenance window; rate limits fragment; backfill status is invisible from another worker; buffered counters are lost independently.
- Suggested validation/fix: either add a startup advisory lease/assertion that refuses a second writer process, or move correctness-critical coordination to durable storage/advisory locks before any multi-process deployment.

### CRIT20-R02 - Failed restore deliberately leaves maintenance active, but recovery UX/runbook is not evident in code

- Severity: MEDIUM operational risk
- Confidence: Medium
- Status: Risk needing validation
- Region: `apps/web/src/app/[locale]/admin/db-actions.ts:440-462`, `apps/web/src/app/[locale]/admin/db-actions.ts:618-628`, `apps/web/src/app/[locale]/admin/db-actions.ts:650-679`, `apps/web/src/lib/restore-maintenance.ts:44-56`
- Problem: restore import/read/stdin/timeouts, nonzero `mysql`, and post-restore migration failure resolve with `keepMaintenance: true`, and the finally block preserves maintenance mode in those cases. That fail-closed posture is defensible, but I did not find an explicit admin recovery action beyond process-level intervention.
- Concrete scenario: a partial restore or migration failure leaves the app in restore maintenance. Uploads, processing, and mutations remain blocked until an operator restarts or manually intervenes, and the UI may not provide a safe "acknowledge and exit maintenance" path.
- Suggested validation/fix: verify the admin UI and runbook expose a deliberate recovery path. If none exists, add one that requires operator acknowledgement and documents when it is safe, while preserving fail-closed default behavior.

### CRIT20-R03 - Active/deferred plan index can mislead future repair cycles

- Severity: LOW
- Confidence: Medium
- Status: Documentation/process risk
- Region: `.context/plans/README.md:3-57`
- Problem: the plan index keeps many older deferred/TODO items near completed-cycle entries without clear superseded/closed/current status.
- Concrete scenario: a future repair cycle treats stale deferred findings as equally live and reopens work that later reviews or fixes already superseded.
- Suggested validation/fix: tag active entries as `active`, `superseded`, `closed-by`, or `needs-revalidation`, and link them to the newest aggregate that owns the current decision.

## Non-Findings / Guardrails Rechecked

- Admin API auth, server-action origin, and public mutating-route rate-limit gates passed in current cycle reports.
- Privacy select guards were present at reviewed points: `publicSelectFields`, `_PrivacySensitiveKeys`, `SENSITIVE_KEYS`, and shared semantic/similar enrichment fields.
- Deploy prune ordering and bind-mount persistence matched the documented no-data-loss model; no prune-after-up mismatch was found.
- Migration inventory had matching journal tags and SQL files at the reviewed point; the known non-monotonic journal history is handled by the migration postcondition path.
- Paid download / Stripe removal and storage-backend "local only" policy were not contradicted by live user-facing docs in the reviewed surfaces.

## Final Missed-Issue Sweep

Final sweep patterns covered:

- Public route charge/rollback order, same-origin checks, abort handling, body caps, no-store headers, and Node runtime pins.
- Upload, Lightroom ingest, retry processing, delete cleanup, restore maintenance, backup download, advisory locks, and image queue state.
- Data-access hot paths: `COUNT(*) OVER()`, leading-wildcard search, semantic/similar embedding scans, map marker caps, timeline/date functions, and public privacy selects.
- UI/UX/a11y: masonry, map, photo navigation/lightbox, focus/touch/source-contract tests, and Playwright coverage.
- Docs/ops drift: CLIP activation, semantic limits, deploy env/build args, stale feature terms (`Stripe`, `entitlements`, `license_tier`, `S3`, `MinIO`, `Lightroom plugin`), migration runbook, and plan index status.

Generated build outputs, `node_modules`, persisted upload/resource blobs, and binary screenshots were excluded from line-level review. No critical or high-severity live exploit/data-loss bug was confirmed in this critic pass; the highest-value fixes are the upload ingest service extraction, build/runtime env unification, smart-collection limiter accounting, and queue pool-budget hardening.
