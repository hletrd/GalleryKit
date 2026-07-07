# Run-10 Cycle 13/100 Deferred Findings

Date: 2026-07-07
Review aggregate: `.context/reviews/_aggregate.md`
Status: Active deferred register for findings not scheduled in `cycle-13-2026-07-07-plan.md`.

Repo-policy quotes used for deferrals that touch security/correctness/deployment boundaries:

- Single-instance security/topology: `CLAUDE.md:244-247` says the shipped deployment is a "single web-instance / single-writer topology", warns not to horizontally scale until process-local coordination states move to shared storage, and says public page limiting is intentionally supplied at the NGINX edge rather than app layer.
- Static derivative/backfill correctness: `CLAUDE.md:221` says derivative responses are deliberately not immutable because backfill re-encodes replace same filenames by atomic rename.
- Cycle 13 destructive-safety constraint forbids CI/CD workflow files, deploy scripts, Docker/deployment pipeline files, and DNS/network/firewall/auth config changes unless explicitly confirmed. Items requiring those edits are deferred instead of partially fixed.

Every item below preserves original severity/confidence. Deferred work remains bound by repo policy: GPG-signed conventional commits with gitmoji, no AI co-author trailers, `git pull --rebase` before push, required gates, and no destructive/production/network config edits without explicit authorization.

## Deferred Items

### C13-AGG-04 - npm security overrides leave the dependency tree invalid under `npm ls`

- Original severity/confidence: Medium / Medium
- Citation: `package.json:7-15`, `package-lock.json` transitive `postcss`/`esbuild` declarations
- Reason for deferral: no active audit vulnerability was found; the current override state is a tooling/upstream compatibility risk, not a confirmed runtime defect.
- Exit criterion: upstream packages publish compatible dependency ranges or CI adopts `npm ls`/dependency-health as a required gate.

### C13-AGG-05 - Quality workflow does not exercise the production Docker build path

- Original severity/confidence: Medium / High
- Citation: `.github/workflows/quality.yml:62-109`, `apps/web/Dockerfile:1-120`
- Reason for deferral: the direct fix requires CI workflow and/or Docker build pipeline changes, which this cycle's destructive-safety constraint forbids without explicit confirmation.
- Exit criterion: user authorizes CI/CD/Docker pipeline edits or a non-pipeline local Docker-build gate is requested.

### C13-AGG-06 - Batch image deletion repeatedly scans derivative directories

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:588-660`
- Reason for deferral: performance optimization with no confirmed correctness/security failure; scheduled work prioritizes confirmed runtime correctness and small UX fixes.
- Exit criterion: production delete latency/NAS I/O shows material cost, or a future cycle budgets a delete-cleanup batching pass.

### C13-AGG-07 - Live queue and in-app backfill reserve DB pool headroom independently

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/db/index.ts:21-41`, `apps/web/src/lib/image-queue.ts:120-140`, `apps/web/src/lib/admin-backfill-runner.ts:96-141`
- Reason for deferral: broader scheduler/budget design change; no immediate failing gate or confirmed outage in the shipped single-instance topology.
- Exit criterion: concurrent upload/backfill saturation is observed, or a future cycle schedules shared background budget architecture.

### C13-AGG-08 - Sidecar color backfill concurrency is not pool-budget clamped

- Original severity/confidence: Medium / High
- Citation: `apps/web/scripts/backfill-color-pipeline.ts:383-387`, `apps/web/src/db/index.ts:31-41`
- Reason for deferral: operator-side performance risk; changing sidecar behavior needs a broader backfill/runbook review.
- Exit criterion: sidecar backfills are run during live traffic, or operator asks for sidecar concurrency hardening.

### C13-AGG-09 - Homepage on-this-day query is non-sargable on every dynamic render

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:102-130`
- Reason for deferral: schema/index migration would be required; no production EXPLAIN evidence in this cycle.
- Exit criterion: production-like row counts show homepage latency/CPU impact, or a schema-performance cycle is authorized.

### C13-AGG-10 - Timeline year list uses non-sargable `YEAR(capture_date)`

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-80`, `apps/web/src/lib/data-timeline.ts:139-159`
- Reason for deferral: low-severity performance risk requiring schema/index work.
- Exit criterion: timeline EXPLAIN shows material scan cost or a generated-column migration is scheduled.

### C13-AGG-11 - Public listing queries aggregate tags before limiting page rows

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/data.ts:786-828`, `apps/web/src/lib/data.ts:893-940`
- Reason for deferral: query-shape refactor needs broader performance validation; current gates do not fail.
- Exit criterion: listing EXPLAIN/latency shows grouping cost or a data-access performance pass is scheduled.

### C13-AGG-12 - Public text search relies on multi-query substring scans

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/data.ts:1574-1713`
- Reason for deferral: search-index redesign; rate limiting mitigates abuse and no current failure was reproduced.
- Exit criterion: production search latency/CPU warrants FULLTEXT/normalized search work.

### C13-AGG-13 - Semantic search and similar-photo routes brute-force embedding blobs per request

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/clip-embeddings.ts:188-235`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
- Reason for deferral: vector-index/candidate-pruning work is larger than this cycle's correctness scope.
- Exit criterion: embedding row count or semantic latency exceeds budget, or vector indexing is explicitly scheduled.

### C13-AGG-14 - Lightroom upload route may materialize a max-size multipart file before disk streaming

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/app/api/admin/lr/upload/route.ts`, upload body limit configuration
- Reason for deferral: risk needs memory profiling under max-size uploads before replacing multipart handling.
- Exit criterion: max-size Lightroom upload smoke shows unacceptable memory growth.

### C13-AGG-15 - Public map can hydrate up to 10,000 markers plus duplicate accessible list

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/*`
- Reason for deferral: UI/performance redesign; no current map-size production failure was measured.
- Exit criterion: galleries approach high geotag marker counts or mobile map responsiveness fails.

### C13-AGG-16 - Single-writer correctness remains warn-only while state is process-local

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/single-writer-guard.ts:7-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/lib/upload-tracker-state.ts:15-20`, `apps/web/src/lib/rate-limit.ts:78-99`
- Reason for deferral: repo policy explicitly documents the shipped single web-instance topology and warns not to horizontally scale until process-local coordination moves to shared state (`CLAUDE.md:244-247`). Enforcing startup failure would be a topology/product decision with deployment risk.
- Exit criterion: user asks for enforce-fail singleton behavior, horizontal scaling, blue/green deploy support, or shared coordination state.

### C13-AGG-17 - Public dynamic-page flood protection depends on manually applied nginx state

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/nginx/default.conf:274-295`, `apps/web/deploy.sh:51-77`
- Reason for deferral: repo policy intentionally places page limiting at NGINX edge and says per-iteration deploys do not touch host nginx (`CLAUDE.md:247`); this cycle forbids deploy/network config changes.
- Exit criterion: user authorizes nginx/deploy validation changes or asks for app-layer dynamic-page limiter.

### C13-AGG-21 - Byte-impacting settings commit before derivative generation catches up

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/src/lib/settings-hash.ts:14-19`, `apps/web/src/lib/serve-upload.ts:252-258`, `apps/web/src/lib/process-image.ts:1187-1198`
- Reason for deferral: current repo contract explicitly supports same-filename derivative replacement after backfill and avoids immutable caching (`CLAUDE.md:221`). Full versioned derivatives/pending-backfill semantics are product architecture work.
- Exit criterion: product decision requires settings to be transactional with derivative regeneration, or stale derivative delivery is observed after a settings change.

### C13-AGG-22 - Shared-group reads own one half of view-recording semantics

- Original severity/confidence: Low / High
- Citation: `apps/web/src/lib/data.ts:1318-1407`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`, `apps/web/src/app/actions/public.ts:517-558`
- Reason for deferral: low-severity analytics semantics cleanup; no billing/audit-grade contract exists.
- Exit criterion: shared-group counts become user-visible accuracy commitments or another shared-group analytics refactor is scheduled.

### C13-AGG-23 - Docker native dependency pins can drift from package versions

- Original severity/confidence: Low / High
- Citation: `apps/web/Dockerfile:50-62`, `apps/web/Dockerfile:76-85`, `apps/web/package.json:58-83`
- Reason for deferral: direct fix touches Docker/deployment pipeline files, blocked by this cycle's destructive-safety constraint.
- Exit criterion: user authorizes Dockerfile/deployment-pipeline edits or a non-Docker source-contract-only check is requested.

### C13-AGG-26 - Top-level review slots mix multiple cycles

- Original severity/confidence: Low-Medium / High
- Citation: `.context/reviews/*.md`
- Reason for deferral: archiving/renaming top-level review artifacts is broad history churn and not needed to fix current code behavior.
- Exit criterion: user requests review-artifact cleanup, or future automation depends on cycle-scoped review filenames only.

### C13-AGG-29 - Playwright browser/device coverage is too narrow for the UI risk profile

- Original severity/confidence: Medium / High
- Citation: `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`
- Reason for deferral: browser-matrix expansion can require longer E2E runtime and DB setup; this cycle avoids starting new long-lived MySQL containers unless required.
- Exit criterion: browser-flow coverage is explicitly required or a future UI cycle budgets mobile/tablet Playwright matrix work.

### C13-AGG-30 - Nav visual checks capture screenshots but do not assert visual diffs

- Original severity/confidence: Low / High
- Citation: `apps/web/e2e/nav-visual-check.spec.ts`
- Reason for deferral: low-severity test semantics cleanup; current scheduled UI fixes are source/unit-testable.
- Exit criterion: visual regression assertions are added to CI or nav visual checks become a blocking quality signal.

### C13-AGG-31 - Admin password-change UI has no browser-level regression test

- Original severity/confidence: Medium / High
- Citation: `apps/web/e2e/admin.spec.ts`, `apps/web/src/app/[locale]/admin/(protected)/password/*`
- Reason for deferral: authenticated browser coverage requires E2E admin credentials/database setup; this cycle's implementation can avoid additional MySQL containers.
- Exit criterion: browser-flow coverage is required for password UI or admin E2E setup is available without container conflicts.

### C13-AGG-33 - Client component behavior is over-represented by source-string tests

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/__tests__/*source*.test.ts`
- Reason for deferral: broad test-strategy migration; this cycle adds targeted behavior tests for the highest-risk runtime issues instead.
- Exit criterion: recurring source-contract misses continue after targeted fixes or a test-infrastructure cycle is scheduled.

### C13-AGG-34 - Timeline/year-in-review tests partly reimplement behavior

- Original severity/confidence: Low / High
- Citation: `apps/web/src/__tests__/data-timeline*.test.ts`, `apps/web/src/lib/data-timeline.ts`
- Reason for deferral: low-severity test-quality cleanup tied to deferred timeline performance work.
- Exit criterion: timeline query logic is refactored or generated date columns are added.

### C13-AGG-35 - Test-only request mocks erase route contract types

- Original severity/confidence: Low / High
- Citation: route tests using request mocks
- Reason for deferral: broad low-severity test helper cleanup; no current route-contract failure was reproduced.
- Exit criterion: a route bug escapes because mocks differ from real `NextRequest`, or test helper cleanup is scheduled.

### C13-AGG-36 - Real HEIF/AVIF/HDR fixture gap remains open

- Original severity/confidence: Medium / High
- Citation: color/HDR tests and fixture directories
- Reason for deferral: adding real media fixtures requires provenance/licensing selection and larger fixture governance.
- Exit criterion: licensed minimal real fixtures are available or a color/HDR validation cycle is scheduled.

### C13-AGG-37 - No coverage report, threshold, or changed-file coverage ratchet exists

- Original severity/confidence: Low / High
- Citation: `apps/web/package.json`, Vitest config surface
- Reason for deferral: broad test-policy decision; existing required gates remain blocking.
- Exit criterion: user requests coverage ratchet or recurring untested regressions justify a policy change.

### C13-AGG-38 - Admin category, tag, and SEO save failures are toast-only

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- Reason for deferral: broader admin form error-state refactor across multiple forms; current cycle schedules smaller destructive-confirmation UX work.
- Exit criterion: admin form accessibility pass is scheduled or user reports missed validation errors.

### C13-AGG-39 - Tag autocomplete popovers can be clipped inside the admin image table scroller

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/components/image-manager.tsx:427-534`, `apps/web/src/components/tag-input.tsx:183-234`
- Reason for deferral: overlay/portal refactor needs authenticated admin visual validation; no credentials/session available this cycle.
- Exit criterion: browser-flow coverage for admin image manager is available or clipping is reproduced by a user.

### C13-AGG-45 - Mobile home puts the full tag-filter wall before the first photo

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/components/home-client.tsx:287-330`, `apps/web/src/components/tag-filter.tsx:62-122`
- Reason for deferral: responsive IA redesign with product tradeoffs; current cycle schedules smaller focus-order/discoverability fixes.
- Exit criterion: mobile homepage redesign is requested or first-content viewport budget becomes a blocking UX target.

### C13-AGG-46 - Admin navigation remains a flat ten-link wrap

- Original severity/confidence: Low-Medium / High
- Citation: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-27`
- Reason for deferral: admin IA redesign; not a correctness/security issue and needs authenticated visual validation.
- Exit criterion: admin navigation redesign is requested or Korean/narrow-width wrapping causes reported workflow friction.

### C13-AGG-47 - Admin recent uploads remains table-first instead of photo-workbench-first

- Original severity/confidence: Medium / Medium-High
- Citation: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-143`, `apps/web/src/components/image-manager.tsx:427-553`
- Reason for deferral: substantial product/design change outside this cycle's corrective scope.
- Exit criterion: user requests a photo-workbench admin mode or admin metadata cleanup workflow becomes a priority.

### C13-AGG-49 - Long Settings form has only a top save action

- Original severity/confidence: Low-Medium / Medium
- Citation: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:316-330`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:731-858`
- Reason for deferral: low-medium UX enhancement; current cycle schedules higher-confidence/public-facing and destructive-confirmation fixes.
- Exit criterion: settings-form usability pass is scheduled or admins report missed save actions.

