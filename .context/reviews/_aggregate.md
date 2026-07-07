# Cycle 14 Aggregate Review

Date: 2026-07-07
Reviewed HEAD: `14d31ea4`

## Agent Coverage

Callable native agent roles in this environment were `default`, `explorer`, and `worker`, so reviewer specialties were assigned through explicit default-agent briefs. The initial designer spawn hit the active-thread limit and was retried after one reviewer completed; the retry succeeded.

Reports written:

- `.context/reviews/code-reviewer.md` - code quality + debugger
- `.context/reviews/security-reviewer.md` - security + tracer
- `.context/reviews/perf-reviewer.md` - performance + architecture
- `.context/reviews/verifier.md` - verifier + test-engineer
- `.context/reviews/critic.md` - critic + document-specialist
- `.context/reviews/designer.md` - designer + local UI/product reviewers

## Summary

- Unique findings after dedupe: 31
- Confirmed issues or confirmed coverage gaps: 22
- Likely issues: 4
- Manual-validation risks: 4
- Highest severity: High risk / Medium confirmed issue

## Confirmed Findings

### C14-AGG-01 - Cycle-plan provenance points at stale aggregate/index state

- Severity: Medium
- Confidence: High
- Cross-agent agreement: critic/document-specialist
- Source findings: C14-CRITDOC-01
- Citations: `.context/plans/cycle-14-2026-06-30-plan.md:1-57`, `.context/plans/cycle-14-2026-06-30-deferred.md:1-253`, `.context/reviews/_aggregate.md:1-34`, `.context/plans/README.md:34-38`
- Problem: Cycle 14 planning/deferred ledgers cite Cycle 14 IDs while the active aggregate/index still represented older cycle state, making provenance ambiguous.
- Failure scenario: A future cycle treats stale aggregate findings as current or treats Cycle 14 work as done without traceable review evidence.
- Suggested fix: Publish the current Cycle 14 aggregate, update plan indexes/current pointers, and add a freshness check for cycle/title/ID-prefix mismatches.

### C14-AGG-02 - Nginx multi-hop proxy comments contradict the tested real-IP contract

- Severity: Medium
- Confidence: High
- Cross-agent agreement: critic/document-specialist, verifier, code-reviewer, security-reviewer
- Source findings: C14-CRITDOC-02, VER-14-01, C14-CR-RISK-01, C14-SEC-02
- Citations: `apps/web/nginx/default.conf:20-28`, `apps/web/nginx/default.conf:59-71`, `apps/web/nginx/default.conf:100-112`, `README.md:168-174`, `apps/web/README.md:50-58`, `apps/web/.env.local.example:60-70`, `CLAUDE.md:97-98`, `apps/web/src/lib/rate-limit.ts:175-198`
- Problem: The nginx template comments still recommend append-mode XFF handling for upstream LB deployments, while the docs/tests support normalizing `$remote_addr` at nginx and overwriting XFF to the app.
- Failure scenario: An operator follows the stale comment, sets `$proxy_add_x_forwarded_for` and `TRUSTED_PROXY_HOPS=2`, and app-layer rate limits collapse to an LB or spoofable key.
- Suggested fix: Align nginx comments and proxy-topology docs with the shipped overwrite/real-IP contract. The checker should avoid overclaiming proof of client-IP safety unless it observes the selected bucket.

### C14-AGG-03 - Proxy topology checker can pass without proving selected client-IP bucket safety

- Severity: Medium
- Confidence: High
- Cross-agent agreement: verifier, code-reviewer
- Source findings: VER-14-01, C14-CR-RISK-01
- Citations: `scripts/check-proxy-topology.mjs:7-12`, `scripts/check-proxy-topology.mjs:102-123`, `apps/web/src/app/api/search/semantic/route.ts:173-184`, `apps/web/src/lib/rate-limit.ts:175-198`
- Problem: The checker classifies only status codes and cannot distinguish a safe edge overwrite from app acceptance of attacker-supplied XFF.
- Failure scenario: The script reports success while an attacker can rotate spoofed XFF values into distinct limiter buckets.
- Suggested fix: Add a non-mutating diagnostic for the effective client key, or narrow the script wording to same-origin reachability only.

### C14-AGG-04 - Normal quality gates do not build the production Docker image

- Severity: Medium
- Confidence: High
- Cross-agent agreement: verifier, critic/document-specialist
- Source findings: VER-14-02, C14-CRITDOC risk 2
- Citations: `.github/workflows/quality.yml:48-83`, `apps/web/Dockerfile:50-62`, `apps/web/Dockerfile:76-85`
- Problem: CI builds Next.js but does not exercise the Docker image's Linux-native dependency materialization path.
- Failure scenario: Next build passes, but deploy fails when Docker cannot install/resolve Sharp, SWC, Lightning CSS, or other native packages.
- Suggested fix: Add a non-publishing Docker build gate. Deferred this cycle because CI/deployment pipeline edits are explicitly forbidden.

### C14-AGG-05 - Background image queue and in-app backfill reserve DB pool headroom independently

- Severity: Medium
- Confidence: High
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-01
- Citations: `apps/web/src/db/index.ts:31-41`, `apps/web/src/lib/image-queue.ts:123-140`, `apps/web/src/lib/admin-backfill-runner.ts:105-142`
- Problem: The image queue and admin backfill each clamp concurrency independently and do not subtract the other subsystem's active DB/CPU workers.
- Failure scenario: Upload processing plus backfill saturate the small MySQL pool and queue live page/admin requests behind background work.
- Suggested fix: Add a shared in-process background resource budget and surface the combined effective budget.

### C14-AGG-06 - Sidecar color backfill bypasses the web pool-budget clamp

- Severity: Medium
- Confidence: High
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-02
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:378-387`, `apps/web/scripts/backfill-color-pipeline.ts:470-490`, `apps/web/src/lib/admin-backfill-runner.ts:129-142`
- Problem: The sidecar script can run up to eight workers from a separate process and pool, bypassing the in-app budget formula.
- Failure scenario: An operator runs high sidecar concurrency during live traffic and overwhelms MySQL, CPU, or storage.
- Suggested fix: Reuse shared budget helpers in scripts and require an explicit maintenance override for aggressive sidecar concurrency.

### C14-AGG-07 - Public map over-fetches and hydrates up to 10,000 markers plus a duplicate list

- Severity: Medium
- Confidence: High
- Cross-agent agreement: performance/architecture, designer
- Source findings: PERF-C14-03, DES-C14 risk
- Citations: `apps/web/src/lib/data.ts:409-444`, `apps/web/src/lib/data.ts:1759-1791`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-109`, `apps/web/src/components/map/map-client.tsx:77-140`
- Problem: Map data uses broad public select fields, serializes many rows to the client, renders every marker, and duplicates the list.
- Failure scenario: A GPS-heavy gallery sends a large RSC/client payload and hydrates thousands of Leaflet markers and list rows, especially painful on mobile.
- Suggested fix: Use a lean select, lower initial SSR cap, cluster or viewport-fetch markers, virtualize/paginate the list, and compute bounds in one pass.

### C14-AGG-08 - Dynamic homepage runs a non-sargable on-this-day query on every render

- Severity: Medium
- Confidence: High
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-04
- Citations: `apps/web/src/app/[locale]/(public)/page.tsx:155-178`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:111-130`, `apps/web/src/db/schema.ts:123-130`
- Problem: `MONTH(capture_date)` and `DAY(capture_date)` prevent direct index usage on a dynamic homepage request path.
- Failure scenario: Every homepage request scans/groups more dated rows as the archive grows.
- Suggested fix: Add generated month/day key(s) and covering index, then query equality on those keys.

### C14-AGG-09 - Backfill candidate selection lacks a pipeline-version index

- Severity: Medium
- Confidence: High
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-05
- Citations: `apps/web/src/lib/admin-backfill-runner.ts:390-428`, `apps/web/scripts/backfill-color-pipeline.ts:372-387`, `apps/web/src/db/schema.ts:82-83`, `apps/web/src/db/schema.ts:123-131`
- Problem: Stale processed-image scans filter by `pipeline_version` without an index shaped for candidate discovery.
- Failure scenario: Mostly-current backfills still scan large processed ranges to find a small stale tail.
- Suggested fix: Add and validate an index such as `(processed, pipeline_version, id)` or split null/stale queries if needed.

### C14-AGG-10 - Batch image deletion repeatedly scans derivative directories

- Severity: Medium
- Confidence: High
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-06
- Citations: `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:588-627`, `apps/web/src/lib/process-image.ts:644-660`
- Problem: Batch delete calls strict single-image cleanup with empty size arrays, causing repeated full scans of derivative directories.
- Failure scenario: Deleting 100 images can walk each derivative directory hundreds of times on NAS-backed storage.
- Suggested fix: Add a batch cleanup helper that scans each derivative directory once and deletes matching variants.

### C14-AGG-11 - Lightroom upload route has high-value rejection/cleanup branches without behavior tests

- Severity: Medium
- Confidence: High
- Cross-agent agreement: verifier/test-engineer
- Source findings: VER-14-03
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:101-540`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`
- Problem: Critical parse, quota, lock, cleanup, GPS, DB, and post-commit branches lack behavior tests.
- Failure scenario: A future change leaks a parse slot, skips quota settlement, leaves an original after GPS failure, or lets post-commit bookkeeping turn success into 500.
- Suggested fix: Add table-driven route tests for rejection and cleanup branches with side-effect assertions.

### C14-AGG-12 - DB restore child-process cleanup is guarded mostly by source-string tests

- Severity: Medium
- Confidence: High
- Cross-agent agreement: verifier/test-engineer
- Source findings: VER-14-04
- Citations: `apps/web/src/app/[locale]/admin/db-actions.ts:807-873`, `apps/web/src/__tests__/db-restore.test.ts:47-74`
- Problem: Source-string tests do not prove child-process, stream, timeout, or double-event runtime cleanup behavior.
- Failure scenario: A refactor leaves the same strings but breaks event ordering, cleanup, watchdog cancellation, or double-resolution handling.
- Suggested fix: Extract an injectable restore runner and add fake child/stream/timer behavior tests.

### C14-AGG-13 - Admin token UI lacks browser-level create/copy/revoke coverage

- Severity: Medium
- Confidence: High
- Cross-agent agreement: verifier/test-engineer
- Source findings: VER-14-05
- Citations: `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-324`, `apps/web/e2e/admin.spec.ts:20-165`, `apps/web/src/__tests__/cycle-22-source-contracts.test.ts:49-59`
- Problem: One-time plaintext, acknowledgement, copy, refresh, and revoke behavior is only server/source-string covered.
- Failure scenario: Hydrated token UI breaks while action tests still pass.
- Suggested fix: Add opt-in admin E2E for token create, copy, acknowledgement, and revoke with cleanup.

### C14-AGG-14 - No coverage report or coverage ratchet exists for critical changed code

- Severity: Low
- Confidence: High
- Cross-agent agreement: verifier/test-engineer
- Source findings: VER-14-06
- Citations: `apps/web/package.json:13-29`, `apps/web/vitest.config.ts:16-39`, `.github/workflows/quality.yml:69-83`
- Problem: The suite lacks quantitative coverage visibility or changed-file ratcheting for high-risk paths.
- Failure scenario: New branches land with only source-contract or no behavior tests and remain invisible to gates.
- Suggested fix: Add a non-blocking coverage report first, then ratchet critical directories. CI gating is deferred this cycle by pipeline-edit constraints.

### C14-AGG-15 - Mobile home puts a full tag wall before the first photo

- Severity: Medium
- Confidence: High
- Cross-agent agreement: designer
- Source findings: DES-C14-01
- Citations: `apps/web/src/components/home-client.tsx:287-330`, `apps/web/src/components/tag-filter.tsx:62-122`
- Problem: Mobile visitors and keyboard users encounter a dense filter chip block before the first photo.
- Failure scenario: The primary gallery content feels delayed and keyboard traversal reaches many filters before image content.
- Suggested fix: Keep a small above-grid filter affordance and move full taxonomy to a sheet, rail, or on-demand filter control.

### C14-AGG-16 - Admin create/edit failures are toast-only instead of field-linked validation

- Severity: Medium
- Confidence: High
- Cross-agent agreement: designer
- Source findings: DES-C14-02
- Citations: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:91-423`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:53-181`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-184`
- Problem: Server validation failures are easy to miss and not tied to invalid controls with ARIA state.
- Failure scenario: An admin misses a toast and cannot tell which field to correct.
- Suggested fix: Store field errors, render persistent inline messages, set `aria-invalid`/`aria-describedby`, and focus the first invalid field.

### C14-AGG-17 - Admin recent uploads uses a dense metadata table as the primary photo workbench

- Severity: Medium
- Confidence: Medium-High
- Cross-agent agreement: designer
- Source findings: DES-C14-04
- Citations: `apps/web/src/components/image-manager.tsx:427-553`
- Problem: The main post-upload task is photo review and metadata cleanup, but the UI is a dense table with small thumbnails and cramped editors.
- Failure scenario: A photographer loses visual context and must interact with cramped row controls to assign categories/tags.
- Suggested fix: Use a photo-first grid/list plus inspector, keeping dense table as optional power mode if needed.

### C14-AGG-18 - Admin navigation is a flat wrapping ten-link cluster

- Severity: Low-Medium
- Confidence: High
- Cross-agent agreement: designer
- Source findings: DES-C14-05
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-27`
- Problem: Operational, content, analytics, system, and account surfaces are not grouped, and wrapping changes spatial memory.
- Failure scenario: Admins rescan the whole nav cluster on smaller screens or with Korean labels.
- Suggested fix: Group navigation into stable sections and use sidebar/drawer patterns by viewport.

### C14-AGG-19 - Long settings form has only a top save action

- Severity: Low-Medium
- Confidence: Medium
- Cross-agent agreement: designer
- Source findings: DES-C14-06
- Citations: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:316-330`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:731-858`
- Problem: Lower settings changes have no nearby save action.
- Failure scenario: An admin changes semantic-search settings and navigates away or scrolls excessively to save.
- Suggested fix: Add sticky/repeated save actions with dirty-state messaging.

### C14-AGG-20 - Truncated technical values rely on mouse-only native title disclosure

- Severity: Low-Medium
- Confidence: High
- Cross-agent agreement: designer
- Source findings: DES-C14-07
- Citations: `apps/web/src/components/info-bottom-sheet.tsx:413-423`, `apps/web/src/components/photo-viewer.tsx:803-812`, `apps/web/src/components/upload-dropzone.tsx:535-538`, `apps/web/src/components/image-manager.tsx:497-499`
- Problem: Native `title` does not reliably expose full camera/lens/filename values to touch, keyboard, or assistive-tech users.
- Failure scenario: Users cannot verify long filenames or lens metadata when text is truncated.
- Suggested fix: Prefer wrapping, focusable tooltip/disclosure, copy affordance, or details rows.

### C14-AGG-21 - Production CLIP search availability is outside normal gates

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: code-reviewer, critic/document-specialist
- Source findings: C14-CR-RISK-02, C14-CRITDOC risk 3
- Citations: `CLAUDE.md:168-169`, `.github/workflows/clip-preflight.yml:1-46`, `apps/web/src/lib/clip-model.ts:200-229`, `apps/web/src/app/api/search/semantic/route.ts:173-190`
- Problem: Production semantic search depends on DB mode, env opt-in, seeded weights, and embeddings that default CI does not prove.
- Failure scenario: Semantic production mode is enabled without seeded weights or embeddings and public search degrades.
- Suggested fix: Treat activation as an operator runbook/preflight and add non-mutating deploy/status checks if it becomes always-on.

### C14-AGG-22 - Multi-instance operation is warn-only while several controls are process-local

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: security-reviewer, critic/document-specialist
- Source findings: C14-SEC-01, C14-CRITDOC risk 4
- Citations: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/lib/rate-limit.ts:87-110`, `apps/web/src/lib/upload-tracker-state.ts:7-20`, `apps/web/src/lib/data.ts:13-63`
- Problem: If production violates the documented single-instance topology, rate limits, upload quotas, and view buffers become per-process.
- Failure scenario: A second container continues serving after a warning, multiplying budgets and weakening coordination.
- Suggested fix: Keep single-instance deployment or move process-local state to shared storage; consider failing health/deploy on persistent contention.

## Likely Issues

### C14-AGG-23 - Sitemap omits footer-linked static public pages

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: verifier/test-engineer
- Source findings: VER-14-07
- Citations: `apps/web/src/components/footer.tsx:41-52`, `apps/web/src/app/sitemap.ts:54-55`, `apps/web/src/app/sitemap.ts:98-103`, `apps/web/src/__tests__/sitemap-robots.test.ts:46-79`
- Problem: `/map`, `/privacy`, and `/about-gallerykit` are public footer destinations, but only `/timeline` appears in static sitemap entries.
- Failure scenario: Sitemap-first crawlers discover timeline but not other linked public pages.
- Suggested fix: Define the intended static public path policy in one shared array and update sitemap tests.

### C14-AGG-24 - Public listing queries aggregate tags before limiting the page

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-07
- Citations: `apps/web/src/lib/data.ts:802-828`, `apps/web/src/lib/data.ts:893-940`, `apps/web/src/app/[locale]/(public)/page.tsx:175-178`
- Problem: Listing queries join and group tags over many matching rows before applying the page limit.
- Failure scenario: Broad tag-heavy pages create temp grouping/sort work proportional to the archive, not the page.
- Suggested fix: Fetch page image IDs first, then aggregate tags for those IDs.

### C14-AGG-25 - Admin analytics fans out multiple aggregation queries against one shared pool

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-08
- Citations: `apps/web/src/app/[locale]/admin/(protected)/analytics/page.tsx:24-36`, `apps/web/src/lib/analytics-data.ts:28-207`
- Problem: Five analytics aggregation queries run concurrently and share the same DB pool as live traffic/background workers.
- Failure scenario: `/admin/analytics?window=all` increases DB pressure during uploads/backfills.
- Suggested fix: Limit query concurrency, cache snapshots, or materialize daily rollups.

### C14-AGG-26 - Timeline year list uses YEAR(capture_date) on an uncached public route

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-09
- Citations: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:19`, `apps/web/src/lib/data-timeline.ts:143-159`, `apps/web/src/db/schema.ts:123-130`
- Problem: Distinct year lookup wraps `capture_date`, preventing direct use of the plain date index.
- Failure scenario: Large archives make timeline entry scan and distinct/order many rows.
- Suggested fix: Add generated `capture_year` and covering index or maintain a summary table.

### C14-AGG-27 - Tag autocomplete may be clipped inside the admin image table scrollport

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: designer
- Source findings: DES-C14-03
- Citations: `apps/web/src/components/image-manager.tsx:427-534`, `apps/web/src/components/tag-input.tsx:184`, `apps/web/src/components/tag-input.tsx:231-234`
- Problem: The autocomplete popup is absolutely positioned inside an overflow table wrapper.
- Failure scenario: Suggestions are hidden or require horizontal scrolling on narrower admin viewports.
- Suggested fix: Render suggestions through a portal/popover or move row editing to an inspector/drawer.

## Manual-Validation Risks

### C14-AGG-28 - Migration reconcile parity relies mainly on source tripwires

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: verifier/test-engineer
- Source findings: VER-14-08
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-225`, `apps/web/scripts/migrate.js`
- Problem: Current tests verify name/source mentions rather than structural equivalence of migrated vs reconciled schemas.
- Failure scenario: Column defaults, nullability, FK actions, or index order drift while source tripwires pass.
- Suggested fix: Add a disposable MySQL schema-equivalence integration lane.

### C14-AGG-29 - Public text search and smart-collection contains predicates are table-scan surfaces

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-10
- Citations: `apps/web/src/lib/data.ts:1574-1713`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/app/actions/public.ts:247-329`
- Problem: Substring `LIKE` predicates can be expensive on large archives even with request-level rate limits.
- Failure scenario: Allowed low-selectivity searches scan large images/tags/topic-alias surfaces.
- Suggested fix: Collect production-like `EXPLAIN ANALYZE` data, then consider FULLTEXT/search index or stricter query policy.

### C14-AGG-30 - Semantic routes brute-force embedding blobs in the web process

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-11
- Citations: `apps/web/src/lib/clip-embeddings.ts:36-235`, `apps/web/src/lib/clip-model.ts:53-173`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
- Problem: Semantic/similar routes decode and score up to the configured scan cap inside the web process.
- Failure scenario: Raised scan caps or concurrent semantic traffic consume CPU/memory needed for SSR/uploads.
- Suggested fix: Keep caps conservative; for growth, move to a vector index/store or worker-thread/single-flight scoring.

### C14-AGG-31 - Lightroom upload may buffer max-size multipart files before disk streaming

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: performance/architecture
- Source findings: PERF-C14-12
- Citations: `apps/web/src/app/api/admin/lr/upload/route.ts:60-186`, `apps/web/src/app/api/admin/lr/upload/route.ts:346-348`, `apps/web/src/lib/process-image.ts:887-923`
- Problem: The route uses `request.formData()` before streaming the file to disk, so peak RSS depends on multipart buffering behavior.
- Failure scenario: A max-size Lightroom upload creates a large transient memory spike in the web process.
- Suggested fix: Profile RSS; if material, replace formData parsing with streaming multipart-to-disk handling.

## Agent Failures

None. The designer reviewer failed to spawn on the first attempt because the active agent thread limit was reached; it was retried after a slot freed and completed successfully.
