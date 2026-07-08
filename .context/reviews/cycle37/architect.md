# Cycle 37 Architect Review

Scope: architecture/design risks, layering, coupling, module boundaries, data ownership, deployment topology, schema/migration architecture, cache/build-time/runtime contracts, and long-term maintainability. I did not edit product code and did not commit or push.

## Inventory

Read first: `AGENTS.md` and `CLAUDE.md`.

Review-relevant inventory built from source:

- Deployment/topology: `apps/web/docker-compose.yml`, `apps/web/Dockerfile`, `apps/web/deploy.sh`, `scripts/deploy-remote.sh`, `apps/web/nginx/default.conf`, `apps/web/src/instrumentation.ts`, `apps/web/src/lib/single-writer-guard.ts`, `apps/web/src/db/index.ts`.
- Schema/migrations: `apps/web/src/db/schema.ts`, `apps/web/drizzle/*.sql`, `apps/web/drizzle/meta/_journal.json`, `apps/web/scripts/migrate.js`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts`.
- Runtime/cache/config: `apps/web/next.config.ts`, `apps/web/src/lib/gallery-config-shared.ts`, `apps/web/src/lib/gallery-config.ts`, `apps/web/src/lib/settings-hash.ts`, `apps/web/src/lib/serve-upload.ts`, `apps/web/src/lib/revalidation.ts`, `apps/web/src/app/actions/settings.ts`.
- Public routes/navigation: `apps/web/src/components/nav.tsx`, `apps/web/src/components/nav-client.tsx`, `apps/web/src/components/footer.tsx`, `apps/web/src/app/sitemap.ts`, `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx`.
- Data ownership/privacy: `apps/web/src/lib/data.ts`, `apps/web/src/lib/data-timeline.ts`, `apps/web/src/lib/search-enrichment-fields.ts`, `apps/web/src/__tests__/privacy-fields.test.ts`.
- Background work/resource boundaries: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/admin-backfill-runner.ts`, `apps/web/src/lib/maintenance-scheduler.ts`, `apps/web/src/lib/admin-mutation-barrier.ts`, `apps/web/src/lib/restore-maintenance.ts`.
- Existing cycle context checked: `.context/reviews/cycle37/code-reviewer.md`, `critic.md`, `perf-reviewer.md`, `security-reviewer.md`, `verifier.md`.

Working tree note: before and during this review, unrelated uncommitted product/review changes were present and continued to change. I did not edit those files; I treated all non-architect changes as current user/worktree state and wrote only this architect artifact.

## Findings

### C37-ARCH-01: Navigation visibility settings are resolved but not used as a route-level contract

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Area: configuration layering, public navigation, privacy/product contract, cache/runtime consistency
- Files/lines:
  - `apps/web/src/lib/gallery-config-shared.ts:68-70` adds `show_timeline_nav` and `show_map_nav` as gallery setting keys.
  - `apps/web/src/lib/gallery-config.ts:92-95` exposes `showTimelineNav` and `showMapNav` on `GalleryConfig`.
  - `apps/web/src/lib/gallery-config.ts:146-155` resolves those booleans from `admin_settings`.
  - `apps/web/src/components/nav.tsx:14-19` supplies fallback values and `apps/web/src/components/nav.tsx:24-30` passes the resolved booleans into `NavClient`.
  - `apps/web/src/components/nav-client.tsx:29-35` accepts `showTimelineNav` / `showMapNav`, but `apps/web/src/components/nav-client.tsx:46-49` still always builds both browse links.
  - `apps/web/src/components/footer.tsx:45-49` always links `/timeline` and `/map`.
  - `apps/web/src/app/sitemap.ts:25` always includes `/timeline` and `/map`, and `apps/web/src/app/sitemap.ts:100-107` emits those static public entries.
  - `apps/web/src/app/[locale]/(public)/map/page.tsx:34-47` still serves the map page and reads map data regardless of `config.showMapNav`.

Concrete failure scenario: an admin or migration writes `admin_settings.show_map_nav='false'` to hide the map browse surface after deciding map browsing is not part of the public experience. The server resolves that value and passes it into the nav client, so the setting appears architecturally supported, but the primary nav still renders the map link, the footer still renders it, the sitemap still advertises it, and `/map` still serves data. A crawler or visitor can continue discovering the supposedly hidden surface.

Suggested fix: promote these booleans from "nav props" to a single public-route visibility policy. A small server helper should answer `isTimelinePublic()` / `isMapPublic()` from `GalleryConfig`, and the same helper should drive `NavClient` link construction, `Footer`, sitemap static paths, and the page handlers' not-found/noindex behavior. Add source or unit tests that assert disabling a setting removes the nav/footer/sitemap entry and prevents direct page rendering when that is the intended contract. If the setting is only meant to hide the primary nav, rename it to avoid implying route visibility.

### C37-ARCH-02: The single-writer topology guard is advisory and starts after process-local schedulers

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Area: deployment topology, runtime ownership, process-local coordination
- Files/lines:
  - `apps/web/src/instrumentation.ts:7-10` starts the maintenance scheduler and bootstraps the image-processing queue before the singleton guard is initialized.
  - `apps/web/src/instrumentation.ts:22-30` initializes the guard fire-and-forget and explicitly treats failures as non-fatal.
  - `apps/web/src/lib/single-writer-guard.ts:7-16` documents that the guard cannot enforce single-instance operation and must not block startup.
  - `apps/web/src/lib/single-writer-guard.ts:218-235` logs that another instance is detected but states startup continues.
  - `apps/web/src/lib/single-writer-guard.ts:294-302` waits about 25 seconds before treating lock contention as persistent.

Concrete failure scenario: an operator accidentally starts two `gallerykit-web` containers against the same database, or a deployment leaves an old process alive while a new one comes up outside the expected drain window. Both processes can start process-local maintenance and image queue work before the guard logs. After the warning, both continue serving. That breaks the documented ownership assumptions for process-local mutation fences, upload quota state, retry maps, buffered view counts, and several rate-limit fast paths.

Suggested fix: choose one explicit topology contract. For strict single-instance deployments, add a production enforcement mode that acquires the singleton guard before starting process-local schedulers/queues and exits non-zero after the rolling-deploy grace window if contention persists. For future scale-out, move the affected coordination state to shared storage and make the guard informational only. Either way, the startup order should make "this process owns process-local background work" depend on the topology decision, not merely on a later warning.

### C37-ARCH-03: Background DB pool budgets are independently correct but not globally coordinated

- Severity: Medium
- Confidence: High
- Status: Confirmed risk
- Area: resource ownership, background work coupling, long-term maintainability
- Files/lines:
  - `apps/web/src/db/index.ts:21-31` documents a 10-connection pool and describes backfill budgeting in isolation.
  - `apps/web/src/lib/image-queue.ts:121-134` computes image-queue concurrency by reserving roughly half the pool for live traffic.
  - `apps/web/src/lib/image-queue.ts:137-153` clamps `QUEUE_CONCURRENCY` against that local formula, and `apps/web/src/lib/image-queue.ts:447-456` creates the image-processing `PQueue` with the result.
  - `apps/web/src/lib/admin-backfill-runner.ts:130-143` computes admin-backfill concurrency with its own local reserve formula.
  - `apps/web/src/lib/admin-backfill-runner.ts:724-733` creates a separate backfill `PQueue` from that local result.
  - `CLAUDE.md` also calls out this overlap in the connection-pool section, so this review confirms the risk remains in code.

Concrete failure scenario: an admin triggers a color-pipeline backfill while upload processing is already active. The image queue and backfill runner each believe they preserved live-request headroom, but they do not subtract the other background consumer. With the shipped 10-connection pool, the two paths can together pin most of the pool during Sharp/DB work, leaving too little room for a photo page's multi-query fan-out or API requests. Visitors then see queued DB work, slow pages, or transient failures even though each background subsystem passed its own cap.

Suggested fix: introduce one shared background connection budget manager or semaphore for all encode/backfill/embedding/maintenance consumers. Each job class should acquire declared units before starting work and release them in `finally`, with one place defining the live-traffic reserve. As a smaller interim fix, make the admin backfill runner pause or refuse to start while the upload queue has active work, and add tests that model queue+backfill overlap against `POOL_CONNECTION_LIMIT`.

## Non-Findings / Guardrails Confirmed

- Schema drift has unusually strong guardrails: the migration journal is pinned for monotonicity except the documented historical inversion (`apps/web/drizzle/meta/_journal.json:47-60`, `apps/web/src/__tests__/migration-journal-monotonicity.test.ts:44-75`), and `migrate.js` carries reconcile + baseline + post-condition safeguards (`apps/web/scripts/migrate.js:803-860`, `apps/web/scripts/migrate.js:968-980`).
- Public data ownership is intentionally guarded: public selects derive from `adminSelectFields` with explicit omissions (`apps/web/src/lib/data.ts:251-407`), the map select is the only public latitude/longitude path (`apps/web/src/lib/data.ts:409-444`), and `getMapImages()` enforces `topics.map_visible = true` plus runtime assertion (`apps/web/src/lib/data.ts:1777-1816`).
- Build-time/runtime cache contracts are documented in code: `IMAGE_BASE_URL` is baked into Next image remote patterns at build (`apps/web/next.config.ts:32-39`, `apps/web/next.config.ts:121-125`), derivative static cache policy is shared (`apps/web/next.config.ts:60-77`), and route-handler ETags include pipeline version, mtime, size, and settings hash (`apps/web/src/lib/serve-upload.ts:114-124`, `apps/web/src/lib/settings-hash.ts:93-103`).
- Deploy persistence is bind-mounted rather than Docker-volume-owned (`apps/web/docker-compose.yml:24-32`), and deploy prune runs after a healthy `up -d` without `volume prune -a` (`apps/web/deploy.sh:79-104`).

## Final Missed-Issues Sweep

Final sweep covered: public navigation and direct route reachability, config resolution and invalidation paths, Docker/deploy topology, singleton guard startup order, DB pool budgeting, schema migration reconcile architecture, privacy select boundaries, derivative cache contracts, sitemap/static public paths, and existing cycle 37 review artifacts.

I did not run the full lint/typecheck/build/test suite because this was a read-only architecture review and no product code was changed. Validation evidence is source inspection with exact line citations plus targeted source inventory. Residual risk remains in runtime-only deployment behavior, live DB state, proxy/nginx host configuration, and interactions with the pre-existing uncommitted config changes.
