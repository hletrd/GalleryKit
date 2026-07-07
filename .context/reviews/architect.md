# GalleryKit Architecture Review — Cycle 5 Prompt 1

Date: 2026-07-07
Lane: architect
Mode: read-only source review, except this artifact.

## Inventory

Review-relevant inventory was built before issue selection. Examined groups:

- Repository contract: `AGENTS.md`, `CLAUDE.md`, `.context/plans/README.md`, current cycle plan/deferred registers, recent review artifacts.
- Runtime bootstrap and lifecycle: `apps/web/src/instrumentation.ts`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/queue-shutdown.ts`, restore-maintenance modules, admin mutation barrier modules, upload path guards.
- Schema/migration/deploy contracts: `apps/web/drizzle/**`, `apps/web/scripts/migrate.js`, `apps/web/docker-compose.yml`, `apps/web/deploy.sh`, `apps/web/Dockerfile`, nginx/deploy docs.
- App boundaries: `apps/web/src/app/actions/**`, public/admin route files, `apps/web/src/lib/data.ts`, `apps/web/src/db/**`, queue/image/color/semantic-search libraries.
- Frontend and quality gates for architecture interactions: `apps/web/src/components/**`, `apps/web/e2e/**`, `apps/web/src/__tests__/**`, message catalogs.

I did not start a dev server or browser. In this prompt the allowed writes are the five review artifacts only; running Next/Playwright would create `.next`, traces, reports, or cache files outside that set. Runtime/browser risks are therefore listed as manual-validation risks rather than claimed live findings.

## Confirmed Issues

### ARCH-C5-01 — Cross-domain maintenance GC is still owned by image-queue bootstrap

Evidence:

- `apps/web/src/instrumentation.ts:1-9` starts only `syncRestoreMaintenanceFromDurable()`, `assertNoLegacyPublicOriginalUploads()`, then `bootstrapImageProcessingQueue()`.
- `apps/web/src/lib/image-queue.ts:1244-1274` starts session cleanup, rate-limit bucket cleanup, audit-log cleanup, anonymous view retention cleanup, and the hourly timer from inside the image queue bootstrap path.
- `apps/web/src/lib/queue-shutdown.ts:7-14` includes `gcInterval` in queue shutdown state, and `apps/web/src/lib/queue-shutdown.ts:27-30` clears that timer as part of draining the processing queue.

Concrete failure scenario:

If the queue bootstrap path is delayed, repeatedly retried, or disabled by a DB/startup failure, non-image lifecycle tasks do not get their startup purge or hourly retention cadence. Expired sessions, stale rate-limit buckets, audit logs, and view events are not image-processing concerns, yet their timer lifecycle is coupled to queue shutdown. This also makes future queue shutdown work easy to accidentally turn into a site-wide maintenance shutdown.

Suggested fix:

Extract a small `startMaintenanceScheduler()` module owned by app instrumentation, with its own idempotent process-global state and a shutdown/drain hook. Start it from `register()` after durable restore-maintenance sync and before or beside image queue bootstrap. Keep `pruneRetryMaps(state)` queue-owned, or split it into a queue-local retry-pruning timer so the site maintenance timer has no dependency on `ProcessingQueueState`.

Confidence: High. This is directly visible in current source and is already carried forward as C4-17.

## Likely Issues

### ARCH-C5-02 — `ProcessingQueueState` remains a broad mutable lifecycle object with partial shape migration

Evidence:

- `apps/web/src/lib/image-queue.ts:317-375` defines `ProcessingQueueState` with queue state, retry maps, permanent-failure diagnostics, bootstrap cursors/timers, shutdown state, side-effect tracking, maintenance `gcInterval`, embedding scan state, and per-job retry timers in one global object.
- `apps/web/src/lib/image-queue.ts:391-414` accepts an existing global state after validating only the load-bearing queue/enqueued/bootstrapped shape, then backfills selected later-added fields.
- `apps/web/src/lib/image-queue.ts:417-433` has defensive cleanup for leaked `gcInterval` and `retryTimers` when a malformed state object is replaced, showing this object has already accumulated lifecycle bug classes.

Concrete failure scenario:

A future change adds another timer, cursor, side-effect set, or durable/transient field and updates the constructor path but misses one of the hot-reload/global backfill, malformed-state replacement, shutdown, or bootstrap retry paths. The state then either leaks timers, silently loses progress, or executes a callback against stale queue state. The current object shape makes those omissions hard to review because unrelated lifecycles share one namespace.

Suggested fix:

Split the state into explicit sub-objects: durable queue coordination, transient timers, embedding scan state, diagnostics/retry maps, and site maintenance. Give each sub-object one initializer/backfill/reset helper and one shutdown owner. This can be done incrementally; the first safe cut is extracting maintenance state as in ARCH-C5-01, then isolating embedding scan cursor/model state.

Confidence: Medium. No new crash is proven in this pass, but the coupling and repeated defensive comments are current source evidence. This aligns with carry-forward C4-16.

## Manual-Validation Risks

### ARCH-C5-M01 — CDN/offline behavior needs an operator-topology decision before claiming PWA image caching

Evidence:

- `CLAUDE.md:427-434` documents that service-worker image caching is same-origin only and that cross-origin `IMAGE_BASE_URL` derivatives are opaque and deliberately not cached.
- `apps/web/public/sw.template.js:51-53` recognizes image derivative paths, and `apps/web/public/sw.template.js:323-334` caches only successful `networkResponse.ok` responses. Opaque cross-origin responses have status `0` and are not `ok`.
- `README.md:146-163` and `apps/web/README.md:49-51` document `IMAGE_BASE_URL` without repeating the service-worker caching caveat.

Risk scenario:

An operator enables a CDN origin for derivatives and assumes the advertised visited-image cache still applies. The shell/offline HTML fallback may work, but photo derivatives are not cached by the SW in that topology.

Suggested validation/fix:

Decide the production topology when `IMAGE_BASE_URL` is actually configured: same-origin proxy if visited-image offline caching matters, or explicit documentation that CDN derivatives skip SW image caching. Add a browser smoke test under that topology before marketing the PWA cache behavior.

Confidence: High for the code behavior, Medium for current production impact because this pass did not inspect live env.

### ARCH-C5-M02 — Operator-only deploy steps remain outside code verification

Evidence:

- Current plan/deferred registers still carry nginx shared-zone operator apply/verify work.
- Deploy/runtime behavior is partly config-driven through ignored env files and host-side nginx.

Risk scenario:

The repository gates can be green while the production edge is still running older nginx rate-limit zone settings or asset topology, so architecture claims about request caps and proxy behavior depend on operator verification.

Suggested validation/fix:

Keep the operator checklist in the deploy ledger and attach curl/nginx evidence after host changes. Do not encode hostnames or secrets into repo docs.

Confidence: Medium. This is an operational boundary, not a source defect.

## Final Sweep

Checked for common architecture misses: auth/origin gates on mutation actions, public-route rate-limit coverage, privacy-sensitive data omission patterns, migration journal/schema coupling, restore-maintenance boundaries, cache/runtime config split, service-worker cache invariants, i18n route structure, and deploy helper contracts. No additional confirmed architecture defects were found in the examined file groups.
