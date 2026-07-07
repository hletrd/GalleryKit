# Cycle 14/100 Deferred Findings

Source review: `.context/reviews/_aggregate.md`
Status: OPEN

Repo-policy notes:
- `AGENTS.md` and `CLAUDE.md` require small, reversible diffs, all quality gates, GPG-signed commit/push, and per-cycle deploy after green gates.
- This cycle explicitly forbids modifying CI/CD workflow files, deployment pipeline files, deploy scripts, DNS/network/firewall/auth config, and similar destructive branches. Items requiring those edits remain deferred with preserved severity.
- `CLAUDE.md` documents the shipped single web-instance/single-writer topology and operator-owned nginx/CLIP validation; deployment-dependent risks below stay deferred until their exit criteria fire.

## Deferred Items

### C14-AGG-02 - Nginx multi-hop proxy comments contradict the tested real-IP contract

- Original severity/confidence: Medium / High
- Citation: `apps/web/nginx/default.conf:20-28`, `apps/web/nginx/default.conf:59-71`, `apps/web/nginx/default.conf:100-112`, `README.md:168-174`, `apps/web/README.md:50-58`, `apps/web/.env.local.example:60-70`, `CLAUDE.md:97-98`, `apps/web/src/lib/rate-limit.ts:175-198`
- Reason deferred: Fixing the primary stale comments requires editing nginx/network deployment config, which this cycle explicitly forbids without separate user confirmation.
- Exit criterion: User authorizes nginx/network config edits, or a future cycle is permitted to modify `apps/web/nginx/default.conf` and matching docs/tests.

### C14-AGG-04 - Normal quality gates do not build the production Docker image

- Original severity/confidence: Medium / High
- Citation: `.github/workflows/quality.yml:48-83`, `apps/web/Dockerfile:50-62`, `apps/web/Dockerfile:76-85`
- Reason deferred: Requires CI workflow modification, forbidden by this cycle's destructive-safety constraint.
- Exit criterion: User authorizes CI workflow edits or requests Docker image build gating.

### C14-AGG-05 - Background image queue and in-app backfill reserve DB pool headroom independently

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/db/index.ts:31-41`, `apps/web/src/lib/image-queue.ts:123-140`, `apps/web/src/lib/admin-backfill-runner.ts:105-142`
- Reason deferred: Requires shared background budgeting design across queue/backfill subsystems; not a narrow cycle-14 fix.
- Exit criterion: Production observes pool saturation during queue/backfill overlap, or a planned resource-budget refactor is opened.

### C14-AGG-06 - Sidecar color backfill bypasses the web pool-budget clamp

- Original severity/confidence: Medium / High
- Citation: `apps/web/scripts/backfill-color-pipeline.ts:378-387`, `apps/web/scripts/backfill-color-pipeline.ts:470-490`, `apps/web/src/lib/admin-backfill-runner.ts:129-142`
- Reason deferred: Same shared-budget redesign as C14-AGG-05; sidecar maintenance-window policy needs operator-facing decision.
- Exit criterion: Backfill sidecar concurrency is changed, or operator reports live resource contention during sidecar runs.

### C14-AGG-07 - Public map over-fetches and hydrates up to 10,000 markers plus a duplicate list

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/data.ts:409-444`, `apps/web/src/lib/data.ts:1759-1791`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-109`, `apps/web/src/components/map/map-client.tsx:77-140`
- Reason deferred: Full fix requires product/UX choice among clustering, viewport fetching, and accessible-list pagination. A partial lean-select change would not close the finding.
- Exit criterion: Production GPS-visible photo count approaches the current cap, map INP/LCP degrades, or map redesign is selected.

### C14-AGG-08 - Dynamic homepage runs a non-sargable on-this-day query on every render

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/(public)/page.tsx:155-178`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:111-130`, `apps/web/src/db/schema.ts:123-130`
- Reason deferred: Requires schema migration and reconcile updates; no production query evidence was gathered in this cycle.
- Exit criterion: Production-like `EXPLAIN ANALYZE` shows material cost, or a schema-index performance cycle is opened.

### C14-AGG-09 - Backfill candidate selection lacks a pipeline-version index

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/lib/admin-backfill-runner.ts:390-428`, `apps/web/scripts/backfill-color-pipeline.ts:372-387`, `apps/web/src/db/schema.ts:82-83`, `apps/web/src/db/schema.ts:123-131`
- Reason deferred: Requires schema migration and production-like query validation.
- Exit criterion: Backfill stale-candidate scans are slow on real data, or a schema-index performance cycle is opened.

### C14-AGG-10 - Batch image deletion repeatedly scans derivative directories

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:588-627`, `apps/web/src/lib/process-image.ts:644-660`
- Reason deferred: Requires a batch cleanup implementation and behavioral tests across deletion/storage paths; not bundled with this cycle's narrow fixes.
- Exit criterion: Large batch deletes are slow on NAS-backed storage, or delete cleanup code is next modified.

### C14-AGG-11 - Lightroom upload route has high-value rejection/cleanup branches without behavior tests

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/api/admin/lr/upload/route.ts:101-540`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`
- Reason deferred: Broad test matrix; no production bug was confirmed.
- Exit criterion: LR upload route is modified, a cleanup regression appears, or a dedicated upload-hardening test cycle is opened.

### C14-AGG-12 - DB restore child-process cleanup is guarded mostly by source-string tests

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:807-873`, `apps/web/src/__tests__/db-restore.test.ts:47-74`
- Reason deferred: Requires extraction of an injectable restore runner; current restore behavior was not proven broken.
- Exit criterion: DB restore code is modified, restore failure cleanup regresses, or a restore-runtime test refactor is approved.

### C14-AGG-13 - Admin token UI lacks browser-level create/copy/revoke coverage

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-324`, `apps/web/e2e/admin.spec.ts:20-165`, `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:49-59`
- Reason deferred: Requires authenticated browser-flow coverage and likely local MySQL/E2E setup; this cycle avoids new long-lived containers unless browser-flow coverage is required for touched code.
- Exit criterion: Token UI changes, token UX bug report, or an E2E coverage cycle with safe DB provisioning.

### C14-AGG-14 - No coverage report or coverage ratchet exists for critical changed code

- Original severity/confidence: Low / High
- Citation: `apps/web/package.json:13-29`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:69-83`
- Reason deferred: Coverage ratchet/gate changes intersect test strategy and CI workflow policy; CI edits are forbidden this cycle.
- Exit criterion: User authorizes CI/test-tooling changes or requests coverage reporting.

### C14-AGG-15 - Mobile home puts a full tag wall before the first photo

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/components/home-client.tsx:287-330`, `apps/web/src/components/tag-filter.tsx:62-122`
- Reason deferred: Requires product/IA choice for collapsed filters, rail, or sheet; partial hiding could harm discoverability.
- Exit criterion: User approves a mobile filter IA direction or mobile first-photo engagement becomes a product priority.

### C14-AGG-16 - Admin create/edit failures are toast-only instead of field-linked validation

- Original severity/confidence: Medium / High
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-423`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-181`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-184`
- Reason deferred: Cross-form UX/a11y refactor requiring consistent action error shape; not safe to patch piecemeal in this cycle.
- Exit criterion: Category/tag/SEO forms are modified or a form-validation accessibility cycle is opened.

### C14-AGG-17 - Admin recent uploads uses a dense metadata table as the primary photo workbench

- Original severity/confidence: Medium / Medium-High
- Citation: `apps/web/src/components/image-manager.tsx:427-553`
- Reason deferred: Product-level redesign; no narrow bug fix closes it.
- Exit criterion: Admin upload workflow redesign is requested or table usability is a reported blocker.

### C14-AGG-18 - Admin navigation is a flat wrapping ten-link cluster

- Original severity/confidence: Low-Medium / High
- Citation: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-27`
- Reason deferred: IA redesign requiring grouping decisions and responsive pattern choice.
- Exit criterion: Admin navigation changes are requested or labels/routes grow further.

### C14-AGG-20 - Truncated technical values rely on mouse-only native title disclosure

- Original severity/confidence: Low-Medium / High
- Citation: `apps/web/src/components/info-bottom-sheet.tsx:413-423`, `apps/web/src/components/photo-viewer.tsx:803-812`, `apps/web/src/components/upload-dropzone.tsx:535-538`, `apps/web/src/components/image-manager.tsx:497-499`
- Reason deferred: Requires a reusable disclosure/copy pattern across public/admin contexts; `aria-label` alone would not close touch disclosure.
- Exit criterion: Metadata/file-name disclosure component is designed, or any cited component is reopened for UI work.

### C14-AGG-21 - Production CLIP search availability is outside normal gates

- Original severity/confidence: Medium / Medium
- Citation: `CLAUDE.md:168-169`, `.github/workflows/clip-preflight.yml:1-46`, `apps/web/src/lib/clip-model.ts:200-229`, `apps/web/src/app/api/search/semantic/route.ts:173-190`
- Reason deferred: `CLAUDE.md` documents CLIP production as operator-enabled with manual preflight and seeded weights; normal CI lacks model weights. CI/deploy preflight edits are forbidden this cycle.
- Exit criterion: Semantic search becomes always-on, production activation changes, or user authorizes CI/deploy preflight work.

### C14-AGG-22 - Multi-instance operation is warn-only while several controls are process-local

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/lib/rate-limit.ts:87-110`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/data.ts:13-63`
- Reason deferred: `CLAUDE.md` explicitly documents a single web-instance/single-writer topology and says not to horizontally scale until process-local coordination moves to shared state.
- Exit criterion: Multi-instance support is requested, deployment topology changes, or persistent singleton-lock contention appears in production.

### C14-AGG-24 - Public listing queries aggregate tags before limiting the page

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/lib/data.ts:802-828`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/[locale]/(public)/page.tsx:175-178`
- Reason deferred: Query-shape change needs production-like `EXPLAIN` evidence and regression coverage; no confirmed current latency failure.
- Exit criterion: Listing latency grows, tag-heavy production data shows temp table cost, or data-query optimization cycle is opened.

### C14-AGG-25 - Admin analytics fans out multiple aggregation queries against one shared pool

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36`, `apps/web/src/lib/analytics-data.ts:28-207`
- Reason deferred: Admin-only performance risk needing data-size evidence and a choice between serialization, cache, or rollups.
- Exit criterion: Analytics page is slow on real data, or analytics rollup/cache work is requested.

### C14-AGG-26 - Timeline year list uses YEAR(capture_date) on an uncached public route

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/lib/data-timeline.ts:143-159`, `apps/web/src/db/schema.ts:123-130`
- Reason deferred: Schema/index change without evidence of current impact.
- Exit criterion: Timeline latency grows or schema-index optimization cycle is opened.

### C14-AGG-27 - Tag autocomplete may be clipped inside the admin image table scrollport

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/components/image-manager.tsx:427-534`, `apps/web/src/components/tag-input.tsx:184`, `apps/web/src/components/tag-input.tsx:231-234`
- Reason deferred: Needs authenticated visual confirmation and portal/popover behavior work; not in the touched UI scope.
- Exit criterion: Admin tag editing is visually confirmed clipped, or image-manager/tag-input is reopened.

### C14-AGG-28 - Migration reconcile parity relies mainly on source tripwires

- Original severity/confidence: Medium / Medium
- Citation: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-225`, `apps/web/scripts/migrate.js`
- Reason deferred: Requires disposable MySQL schema-equivalence integration lane; local MySQL container constraints make new long-lived DB setup inappropriate this cycle.
- Exit criterion: Migration/reconcile code changes, disposable MySQL gate is authorized, or schema drift incident occurs.

### C14-AGG-29 - Public text search and smart-collection contains predicates are table-scan surfaces

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/lib/data.ts:1574-1713`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/app/actions/public.ts:247-329`
- Reason deferred: Needs production-like query analysis before choosing FULLTEXT/index/product limits.
- Exit criterion: Search latency grows, smart collections with contains predicates become common, or query analysis is requested.

### C14-AGG-30 - Semantic routes brute-force embedding blobs in the web process

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/lib/clip-embeddings.ts:36-235`, `apps/web/src/lib/clip-model.ts:53-173`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
- Reason deferred: Current `CLAUDE.md` runbook documents bounded scans and operator tuning; vector-store/worker redesign is future scale work.
- Exit criterion: Scan caps are raised, semantic traffic grows, or CPU/RSS profiling shows route pressure.

### C14-AGG-31 - Lightroom upload may buffer max-size multipart files before disk streaming

- Original severity/confidence: Low / Medium
- Citation: `apps/web/src/app/api/admin/lr/upload/route.ts:60-186`, `apps/web/src/app/api/admin/lr/upload/route.ts:346-348`, `apps/web/src/lib/process-image.ts:887-923`
- Reason deferred: Needs RSS profiling under max-size upload and a streaming multipart parser design if material.
- Exit criterion: LR max-size upload RSS is measured as problematic, upload size limits increase, or LR upload parser is reopened.

