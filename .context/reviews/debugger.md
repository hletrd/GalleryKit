# Cycle 24 Debugger Review

Role lane: debugger
Date: 2026-07-08 KST
Repository: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `4b43fad7ab471287b82fe5c8dac85c05c511220a`
Status: review-only; no source fixes implemented.

## Bug-Prone Inventory Built First

I inventoried failure-prone surfaces before inspecting details, then inspected the relevant files rather than sampling within those surfaces.

- Large request admission and cleanup: `apps/web/src/app/actions/images.ts`, `apps/web/src/app/[locale]/admin/db-actions.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`, `apps/web/next.config.ts`, upload contract locks, pending file deletion cleanup, restore scanner, `mysqldump`/`mysql` child process handling.
- Restore, maintenance, and state reset paths: `apps/web/src/lib/restore-maintenance.ts`, `apps/web/src/lib/restore-maintenance-durable.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/pending-session-revocations.ts`, `apps/web/src/lib/background-db-writes.ts`, protected admin layout, public restore guards.
- Background concurrency and retry paths: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/clip-model.ts`, `apps/web/src/lib/background-db-writes.ts`, DB pool setup, queue retry/failure cleanup, bootstrap paths.
- Public dynamic runtime surfaces: public Server Actions, semantic search route, smart collection compiler, map page/client, search and similar-photo clients, service worker, view-count buffering, rate-limit helpers.
- Deploy, migration, and operational failure modes: migration journal/reconcile mirror, `apps/web/scripts/migrate.js`, `apps/web/deploy.sh`, `apps/web/nginx/default.conf`, Docker compose/deploy health checks, backup/restore shell integration.
- Regression context checked: Cycle 23 plan/deferred registers, prior debugger findings, current Cycle 24 peer reviews in `.context/reviews/`, and the project rules in `CLAUDE.md` plus `.context/plans/README.md`.

## Confirmed Issues

### DBG-C24-01 - Large Server Action uploads can exhaust app memory before app-level guards run

- Severity: High
- Confidence: High
- Status: Confirmed source-level failure mode; live RSS/load reproduction not run.
- File/region: `apps/web/next.config.ts:111-119`; `apps/web/src/app/actions/images.ts:87-106`, `154-159`, `197-221`; `apps/web/src/app/[locale]/admin/db-actions.ts:745-767`; safer route contrast at `apps/web/src/app/api/admin/lr/upload/route.ts:101-187`.

Problem:

The browser upload path and DB restore path are Server Actions. The configured Server Action body limit is sized to the restore surface at `next.config.ts:111-119`, but the framework has to accept and parse the multipart body before the action code reaches its own lock, quota, file-size, and disk-budget checks. In `uploadImages`, the first application code runs at `actions/images.ts:87`, reads `formData.getAll('files')` at `actions/images.ts:106`, and only later obtains the upload contract lock at `actions/images.ts:154-159` and claims quota at `actions/images.ts:197-221`. In `runRestore`, the action receives `FormData` and then streams the uploaded file to a temp path at `db-actions.ts:745-767`, but the multipart body has already crossed the Server Action parser boundary before that streaming loop begins.

Concrete failure scenario:

Two admins, a buggy browser retry, or a tab restore submit large multipart bodies near the 250 MiB action limit while restore or upload locks are already held. The requests can consume Node/Next memory and parser work before the code can reject them for restore maintenance, lock contention, content-length, quota, disk space, or per-file policy. On the disk-constrained single-host deployment this can produce 413/500 churn, process OOM, health-check failure during deploy, or request starvation for unrelated traffic. The Lightroom route shows the safer shape: it rejects chunked uploads, checks `Content-Length`, claims quota, and enters a parse semaphore before `request.formData()` at `api/admin/lr/upload/route.ts:101-187`.

Suggested fix:

Move browser upload and DB restore ingestion off Server Actions and into Node route handlers that can reject on headers before parsing, share the existing upload/restore locks, require `Content-Length`, enforce a pre-parse semaphore, and stream to temp files before expensive image or SQL work. Keep the current Server Actions as thin form submit shims if needed, but the multipart parser boundary should sit behind the same early-admission controls already present in the Lightroom route.

### DBG-C24-02 - Background DB/CPU budgets are split across queues and can still overrun the shared pool under mixed load

- Severity: High
- Confidence: Medium-High
- Status: Confirmed architectural failure surface; exact saturation threshold needs load validation.
- File/region: DB pool `apps/web/src/db/index.ts:31-41`; image queue budget `apps/web/src/lib/image-queue.ts:121-153`, `447-456`; admin backfill budget `apps/web/src/lib/admin-backfill-runner.ts:97-143`, `716-727`; analytics/background writes `apps/web/src/lib/background-db-writes.ts:3-10`, `42-64`; CLIP inference budget `apps/web/src/lib/clip-model.ts:53-72`, `156-173`.

Problem:

The repository has several local concurrency controls, but they do not compose into one process-wide DB/CPU admission budget. The MySQL pool is 10 connections with a queue limit of 20 at `db/index.ts:31-41`. The image queue resolves its own concurrency from pool capacity at `image-queue.ts:121-153` and tracks active jobs at `image-queue.ts:447-456`. The admin backfill runner independently resolves backfill concurrency at `admin-backfill-runner.ts:97-143` and can run its work loop at `admin-backfill-runner.ts:716-727`. Analytics writes have their own queue and two-worker concurrency at `background-db-writes.ts:3-10`, `42-64`. CLIP inference has a separate CPU queue at `clip-model.ts:53-72`, `156-173`. Each limiter is locally reasonable, but none reserves against the others at runtime.

Concrete failure scenario:

An operator starts a color/metadata backfill while the image queue is processing a fresh upload batch, public view analytics are being written, and semantic embedding generation is enabled. Every subsystem believes it is inside its own cap, but the combined DB and CPU pressure can fill the 10-connection pool and 20-entry wait queue. User-visible reads then wait behind maintenance work, retry timers begin to fire, image jobs are retried or marked failed, and restore/drain paths have more outstanding background work to settle. This is a latent regression surface because future increases to any single cap can silently invalidate the assumptions in the other queues.

Suggested fix:

Introduce one shared process-wide admission controller for DB-pinning background work, with named budgets for image processing, backfill, analytics, semantic indexing, and restore drains. Make foreground/admin request reserve explicit, expose queue depth/active counts in diagnostics, and add a mixed-load stress test that runs upload processing, backfill, analytics writes, and CLIP jobs against a small pool to prove foreground reads and restore drains stay bounded.

## Likely Issues

### DBG-C24-03 - Public map can still create a browser/runtime failure at the current 10,000-marker cap

- Severity: Medium
- Confidence: High for scale risk; manual browser trace not run.
- Status: Likely user-visible failure mode on large GPS-enabled galleries.
- File/region: data cap `apps/web/src/lib/data.ts:1766-1816`; map page serialization/list duplication `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `89-110`; Leaflet render/fitting `apps/web/src/components/map/map-client.tsx:77-94`, `120-141`.

Problem:

The server-side query now has a hard cap, but the cap is still 10,000 full markers. `getMapImages()` intentionally returns up to `MAP_MAX_MARKERS = 10000` rows at `data.ts:1766-1816`. `MapPage` serializes those markers to the client at `map/page.tsx:42-66`, renders the full interactive map at `map/page.tsx:89-96`, and also renders a duplicate accessible list for every marker at `map/page.tsx:98-110`. `MapClient` then computes `Math.min(...lats)` / `Math.max(...lats)` over every marker at `map-client.tsx:77-94` and mounts one Leaflet `Marker`/`Popup` subtree per marker at `map-client.tsx:120-141`.

Concrete failure scenario:

A gallery with thousands of map-visible GPS photos opens `/map` on a mobile browser. The page ships a large RSC/client payload, creates thousands of list nodes, computes global bounds over large arrays, and mounts thousands of Leaflet marker/popup components. Even though the server avoids an unbounded query, the browser can hit long main-thread stalls, memory pressure, hydration timeouts, or tab reloads. The truncated notice appears only after the expensive payload has already been produced.

Suggested fix:

Lower the default public marker cap for the current all-at-once renderer, or add viewport-bounded fetching/clustering before allowing 10,000 markers. Keep the accessible list paginated or virtualized, and add a Playwright/browser performance regression with a synthetic high-marker fixture to assert hydration and interaction remain within a practical budget.

## Risks Needing Manual Validation

### DBG-C24-04 - Edge limiter and trusted-client-IP behavior depend on manually applied nginx topology

- Severity: Medium
- Confidence: Medium
- Status: Manual validation risk, not a confirmed source bug.
- File/region: limiter key caveat `apps/web/nginx/default.conf:1-29`; public limiter application `apps/web/nginx/default.conf:274-311`; deploy does not apply nginx config `apps/web/deploy.sh:51-58`; app IP fallback `apps/web/src/lib/rate-limit.ts:175-216`.

Problem:

The nginx file documents that all `limit_req_zone` keys use `$binary_remote_addr` and that load-balanced deployments need real-IP or PROXY protocol configuration at `nginx/default.conf:20-28`. The public SSR limiter is applied in the catch-all location at `nginx/default.conf:274-311`, but the same comments state this file is config-only and must be manually applied/reloaded. The deploy helper builds and starts Docker containers at `deploy.sh:51-58`; it does not validate or reload host nginx. At the app layer, `getClientIp()` has to choose from forwarded headers and socket metadata at `rate-limit.ts:175-216`, so runtime correctness depends on the external proxy chain matching the documented trust assumptions.

Concrete failure scenario:

If nginx has not been reloaded with the current config, expensive public SSR pages may have no edge flood cap. If the site is later placed behind another load balancer without real-IP configuration, all visitors can share one nginx limiter bucket and receive false 429s, while the app may see a different client-IP key than nginx. Either mismatch makes rate-limit behavior hard to reason about during traffic spikes or incident response.

Suggested fix:

Add an operator validation step that captures the live nginx config, confirms `nginx -T` contains the expected limiter zones/location, verifies whether real-IP or PROXY protocol is configured for the actual topology, and compares nginx and app-observed client IPs with a known forwarded request. If this topology remains expected, automate a non-destructive deploy-time check that fails before traffic is shifted when the host config is stale.

## Confirmed Non-Findings / Regression Checks

- The Cycle 23 restore-session ordering bug appears fixed at source level: `restoreDatabase()` now holds maintenance through the strict pending session revocation flush at `apps/web/src/app/[locale]/admin/db-actions.ts:656-673` and only then clears maintenance/resumes queues at `db-actions.ts:674-695`.
- The Cycle 23 protected-admin restore gap appears fixed at source level: the protected admin layout checks `isRestoreMaintenanceActive()` before rendering children at `apps/web/src/app/[locale]/admin/(protected)/layout.tsx:20-25`.
- The Lightroom upload route already follows the safer pre-parse admission pattern and was used as the contrast for DBG-C24-01, not flagged as broken.
- I did not find new missing `finally` cleanup in the inspected delete, restore, upload, queue retry, backfill, or CLIP inference paths. Existing catch/finally paths release upload locks, advisory locks, retry timers, pending deletion records, and inference waiters in the inspected regions.
- I did not find a new confirmed auth-wrapper, action-origin, or public route rate-limit scanner bypass in production route/action files during this static debugger pass.

## Final Missed-Issues Sweep

Final sweep covered restore marker ownership, queued cleanup ownership, session revocation replay, admin route layering, multipart upload/restore admission, child process timeout paths, queue retry cleanup, async abort/request-id handling in search/similar-photo clients, map hydration scale, semantic search request bounds, smart collection AST validation, public route limiters, migration/reconcile coupling, deploy health checks, nginx topology assumptions, and current deferred registers.

No additional confirmed debugger findings were identified beyond the two confirmed failure-mode issues, one likely browser-runtime scale issue, and one manual topology validation risk above.
