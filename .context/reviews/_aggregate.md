# Cycle 12 Aggregate Review

Date: 2026-07-07
Repo: `/Users/hletrd/flash-shared/gallery`
Cycle: 12/100
Reviewed HEAD: `173668ea0a0bb5f57a64cef581ac7b0f5abaef20`

## Review Coverage

Prompt 1 fan-out completed across all requested reviewer perspectives. Native child-agent registration in this environment exposes `default`, `explorer`, and `worker` rather than separate named review-agent types, and the live child-agent limit prevented a sixth concurrent thread. I covered the requested roles in six reviewer lanes, with the UI/UX lane retried after one reviewer completed. No reviewer perspective was silently dropped.

Per-agent provenance files:

- `.context/reviews/code-reviewer.md`
- `.context/reviews/perf-debugger-tracer.md`
- `.context/reviews/security-reviewer.md`
- `.context/reviews/verifier-test-engineer.md`
- `.context/reviews/architect-document-specialist.md`
- `.context/reviews/designer-ui-ux-reviewer.md`

Additional local checks during review:

- `npm run lint:api-auth --workspace=apps/web` passed in review lanes.
- `npm run lint:action-origin --workspace=apps/web` passed in review lanes.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed in review lanes.
- Focused security/privacy tests passed in the security lane.
- Focused UI/a11y tests passed in the designer lane.
- `npm audit --workspace=apps/web --omit=dev --audit-level=moderate` remained red for the nested Next/PostCSS advisory.

## Agent Failures

Initial UI/UX reviewer spawn failed because the environment agent-thread limit was reached. It was retried after one completed reviewer was closed and then completed successfully.

## Deduped Findings

### AGG-C12-01 - Production dependency audit remains red through Next's nested PostCSS

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer, security-reviewer, verifier-test-engineer
- Citation: `apps/web/package.json:59`, root `package.json:7-9`, `package-lock.json:9194-9205`, `package-lock.json:9334-9337`
- Summary: The root override pins top-level PostCSS, but `next@16.2.10` still vendors `postcss@8.4.31`, so production audit remains red for GHSA-qx2v-qp2m-jg93.
- Failure scenario: A current or future Next/PostCSS path stringifies attacker-influenced CSS into a style context and hits the known `</style>` escape bug; even without a confirmed app-level CSS input, the dependency gate is red.
- Suggested fix: Upgrade to a Next release that removes or patches the nested dependency, or prove a lockfile-effective override that replaces the nested copy without downgrading Next.

### AGG-C12-02 - Drizzle dev tooling still pulls vulnerable esbuild through deprecated esbuild-kit

- Severity: Low
- Confidence: High
- Source agents: security-reviewer
- Citation: `apps/web/package.json:79`, `package-lock.json:378-387`, `package-lock.json:764-812`, `package-lock.json:5874-5884`
- Summary: `drizzle-kit@0.31.10` pulls deprecated `@esbuild-kit/*` packages and `esbuild@0.18.20`, which is covered by GHSA-67mh-4wv8-2f99.
- Failure scenario: A developer or CI environment exposes an affected esbuild dev server to a browser-accessible network, allowing a malicious site to read responses from that server.
- Suggested fix: Upgrade or replace the Drizzle tooling path once available, or add a compatible precise override; keep dev servers loopback-only meanwhile.

### AGG-C12-03 - Proxy trust and public rate-limit topology depend on an unenforced operator contract

- Severity: Medium
- Confidence: Medium
- Source agents: security-reviewer, architect-document-specialist
- Citation: `apps/web/docker-compose.yml:15-22`, `apps/web/src/lib/request-origin.ts:45-69`, `apps/web/src/lib/rate-limit.ts:175-205`, `apps/web/nginx/default.conf:20-29`, `apps/web/nginx/default.conf:59-71`, `apps/web/deploy.sh:51-55`, `CLAUDE.md:506-518`
- Summary: App-layer origin/IP logic trusts proxy headers when configured, while dynamic-page protection is documented as edge-only and host nginx is not applied or verified by deploy automation.
- Failure scenario: Direct app-port exposure with `TRUST_PROXY=true` lets spoofed forwarded headers influence expected origin or rate-limit identity; an LB-fronted nginx without real-IP setup can collapse all visitors into one bucket or leave public pages without documented edge limits.
- Suggested fix: Add deployment smoke/config checks for forwarded headers and nginx config version/hash; consider app-layer fallback limiters on expensive public pages.

### AGG-C12-04 - Production Docker base image uses mutable tags rather than reviewed digests

- Severity: Low
- Confidence: Medium
- Source agents: security-reviewer
- Citation: `apps/web/Dockerfile:1`, `apps/web/Dockerfile:15`, `apps/web/Dockerfile:3-6`
- Summary: Production builds use `node:24-slim` tags without pinning a digest.
- Failure scenario: Two deploys from one commit resolve different base contents, making OS/runtime changes invisible to code review.
- Suggested fix: Pin `node:24-slim@sha256:<digest>` and update through a deliberate base-image refresh process.

### AGG-C12-05 - Dynamic date archive/home paths use non-sargable date functions

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer, perf-debugger-tracer
- Citation: `apps/web/src/lib/data-timeline.ts:102-155`, `apps/web/src/app/[locale]/(public)/page.tsx:232-235`, `apps/web/src/components/on-this-day-widget.tsx:15-22`
- Summary: `getOnThisDayImages()` filters with `MONTH()`/`DAY()`, and `getTimelineYears()` selects/orders by `YEAR()`, preventing tight use of date indexes on dynamic public surfaces.
- Failure scenario: Routine public traffic scans or function-sorts the processed dated image set as the archive grows.
- Suggested fix: Add generated/indexed date keys such as `capture_mmdd` and `capture_year`, or cache invalidated rollups backed by index-friendly predicates.

### AGG-C12-06 - Public map can hydrate 10,000 markers plus a duplicate accessible list

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer, perf-debugger-tracer
- Citation: `apps/web/src/lib/data.ts:1741-1777`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-110`, `apps/web/src/components/map/map-client.tsx:77-140`
- Summary: The map route can serialize and hydrate up to 10,000 React Leaflet markers plus a duplicate list.
- Failure scenario: A GPS-heavy gallery sends a large RSC/client payload and stalls mobile hydration/main-thread responsiveness.
- Suggested fix: Load markers by viewport/bounds, add clustering or canvas/WebGL rendering, virtualize/paginate the list, and compute bounds in one pass.

### AGG-C12-07 - Public listing queries aggregate tags before limiting the page

- Severity: Medium
- Confidence: Medium
- Source agents: code-reviewer, perf-debugger-tracer
- Citation: `apps/web/src/lib/data.ts:786-828`, `apps/web/src/lib/data.ts:893-940`
- Summary: Listing queries join/group tags before applying the page limit.
- Failure scenario: Broad gallery pages spend MySQL CPU/temp-table work aggregating tags for rows discarded by the page limit.
- Suggested fix: Select ordered page IDs first through image-table indexes, then join and aggregate tags only for those IDs.

### AGG-C12-08 - Semantic and similar-photo APIs brute-force embedding blobs on the request path

- Severity: Medium
- Confidence: Medium
- Source agents: code-reviewer, perf-debugger-tracer
- Citation: `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`, `apps/web/src/lib/clip-embeddings.ts:36-48`
- Summary: Public semantic routes transfer, decode, and score up to the configured scan limit of embedding blobs inside the web request path.
- Failure scenario: Production semantic traffic competes with SSR and background work for Node CPU, memory, and MySQL bandwidth.
- Suggested fix: Move scoring to a vector index, worker thread, or cached matrix with single-flight invalidation; keep public scan caps measured and conservative.

### AGG-C12-09 - Batch image deletion repeats derivative-directory scans per image and format

- Severity: Medium
- Confidence: High
- Source agents: perf-debugger-tracer
- Citation: `apps/web/src/app/actions/images.ts:735-744`, `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:575-664`
- Summary: Batch delete can scan derivative directories once per selected image and format.
- Failure scenario: Deleting 100 images on a large NAS-backed gallery performs up to 300 directory walks after DB rows are gone.
- Suggested fix: Add a batch cleanup helper that scans each derivative directory once and unlinks all variants for the selected base names.

### AGG-C12-10 - Public smart collections can expose expensive predicates on uncached routes

- Severity: Medium
- Confidence: Medium
- Source agents: perf-debugger-tracer
- Citation: `apps/web/src/lib/smart-collections.ts:142-147`, `apps/web/src/lib/smart-collections.ts:221-267`, `apps/web/src/lib/data.ts:1488-1544`, `apps/web/src/app/[locale]/(public)/c/[slug]/page.tsx:17`
- Summary: Published smart collections can use leading-wildcard `LIKE` and subquery-heavy tag predicates on dynamic public pages.
- Failure scenario: Visitors or crawlers repeatedly force broad scans/counts for a public collection.
- Suggested fix: Classify predicates at publish time, warn/block expensive public shapes, add targeted indexes, or materialize collection membership.

### AGG-C12-11 - Image queue and in-app backfill reserve DB-pool headroom independently

- Severity: Medium
- Confidence: High
- Source agents: perf-debugger-tracer
- Citation: `CLAUDE.md:275-283`, `apps/web/src/db/index.ts:31-42`, `apps/web/src/lib/image-queue.ts:120-140`, `apps/web/src/lib/admin-backfill-runner.ts:96-142`, `apps/web/src/lib/admin-backfill-runner.ts:715-721`
- Summary: Upload queue and admin backfill each clamp concurrency independently, but both can run together against the same 10-connection pool.
- Failure scenario: Queue and backfill workers pin most pool capacity, leaving live requests queued behind background encode work.
- Suggested fix: Introduce a shared background DB-connection budget/semaphore or dynamically reduce one consumer when the other is active.

### AGG-C12-12 - Startup orphan-temp cleanup uses unbounded stat/unlink fan-out

- Severity: Low
- Confidence: High
- Source agents: perf-debugger-tracer
- Citation: `apps/web/src/lib/image-queue.ts:40-96`, `apps/web/src/lib/image-queue.ts:1226-1230`, `apps/web/src/lib/process-topic-image.ts:146-168`
- Summary: Startup temp cleanup scans directories and runs `Promise.all` over every matching temp file.
- Failure scenario: Thousands of stale temp files after crashes can trigger thousands of filesystem operations at process start, delaying readiness or hitting file-descriptor pressure.
- Suggested fix: Process stat/unlink work with bounded concurrency or batching.

### AGG-C12-13 - Authenticated photo page performs duplicate image fan-out

- Severity: Low
- Confidence: High
- Source agents: perf-debugger-tracer
- Citation: `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx:148-159`, `apps/web/src/lib/data.ts:1057-1080`, `apps/web/src/lib/data.ts:1152-1198`
- Summary: Admin photo views fetch public image data and then fetch admin-viewer image data, duplicating primary lookup and tag/prev/next fan-out.
- Failure scenario: Admin browsing adds redundant DB work on an inspection-heavy path.
- Suggested fix: Resolve admin status before the body image fetch and call exactly one helper with the required select shape.

### AGG-C12-14 - Byte-affecting image settings can advertise new policy before static derivatives are regenerated

- Severity: Medium
- Confidence: High
- Source agents: architect-document-specialist, perf-debugger-tracer
- Citation: `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/next.config.ts:56-72`, `apps/web/src/lib/serve-upload.ts:240-258`, `CLAUDE.md:338-340`
- Summary: Settings changes can make runtime config imply new derivative policy while existing static files continue serving old bytes until a separate re-encode.
- Failure scenario: Visitors receive mixed quality/color behavior by asset age and cache state after an admin changes byte-impacting settings.
- Suggested fix: Model settings as a generation workflow with pending/active versions, versioned derivative paths, or an admin state that prevents declaring new bytes active before re-encode completes.

### AGG-C12-15 - Single-writer correctness remains warn-only while key state is process-local

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer, architect-document-specialist
- Citation: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/instrumentation.ts:22-31`, `CLAUDE.md:244-249`
- Summary: The singleton guard warns but keeps startup healthy while restore/upload/rate-limit/backfill/view-count state remains process-local.
- Failure scenario: Two web processes attached to one DB split correctness-relevant state while operators see a nominally healthy service.
- Suggested fix: Add production readiness/startup enforcement after persistent contention or migrate correctness-sensitive state to durable coordination.

### AGG-C12-16 - Legacy schema reconcile remains a second schema authority with mostly source-only parity coverage

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer, verifier-test-engineer
- Citation: `apps/web/scripts/migrate.js:348-730`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-20`, `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:157-179`
- Summary: Reconcile DDL is hand-written and tests mostly assert names, not types/defaults/nullability/index/FK parity.
- Failure scenario: A legacy baseline diverges from normal migrations while source tripwires pass.
- Suggested fix: Add a disposable-MySQL information_schema diff between migrated and reconciled schemas.

### AGG-C12-17 - Real CLIP production activation is not proven by required gates

- Severity: High
- Confidence: High
- Source agents: verifier-test-engineer, code-reviewer
- Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/package.json:21-23`, `.github/workflows/quality.yml:66-80`
- Summary: Real-model tests skip unless weights and env flags are present, and the required CI gates do not run `test:clip:preflight`.
- Failure scenario: Model cache layout, dependency, runtime, or `CLIP_MODELS_ROOT` drift breaks production semantic search while CI remains green.
- Suggested fix: Add scheduled/manual CI that seeds/caches pinned weights and runs `npm run test:clip:preflight --workspace=apps/web`, or require recent preflight evidence before production mode.

### AGG-C12-18 - Browser/device e2e coverage is Chromium-only and screenshots are not visual assertions

- Severity: Medium
- Confidence: High
- Source agents: verifier-test-engineer
- Citation: `apps/web/playwright.config.ts:72-77`, `.github/workflows/quality.yml:72-77`, `apps/web/e2e/nav-visual-check.spec.ts:58`, `apps/web/e2e/nav-visual-check.spec.ts:72`, `apps/web/e2e/nav-visual-check.spec.ts:85`
- Summary: Required Playwright coverage uses only desktop Chromium, and nav screenshots are captured but not compared.
- Failure scenario: Mobile WebKit, Firefox, focus/display-capability, or visual nav regressions ship without failing tests.
- Suggested fix: Add a small required mobile WebKit and non-Chromium smoke matrix; convert visual captures to `toHaveScreenshot` or rename them artifact-only.

### AGG-C12-19 - Important client interactions are still protected by source strings or permissive browser assertions

- Severity: Medium
- Confidence: High
- Source agents: code-reviewer, verifier-test-engineer
- Citation: `apps/web/src/__tests__/photo-viewer-auto-lightbox-source.test.ts:8-14`, `apps/web/e2e/hydration-photo-page.spec.ts:44-49`, `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`, `apps/web/src/components/info-bottom-sheet.tsx:558-595`
- Summary: Several critical UI behaviors are asserted through source text or broad fallbacks rather than actual DOM/focus/menu behavior.
- Failure scenario: Auto-lightbox restore or mobile bottom-sheet dropdown containment breaks while source-string tests stay green.
- Suggested fix: Tighten the hydration spec and add mobile Playwright coverage for the info-sheet dropdown, focus containment, closing, and focus return.

### AGG-C12-20 - Admin UI e2e still misses first-class admin surfaces

- Severity: Medium
- Confidence: High
- Source agents: verifier-test-engineer
- Citation: `apps/web/e2e/admin.spec.ts:20-43`, `apps/web/e2e/admin.spec.ts:73-165`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-128`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:250-325`
- Summary: Admin e2e covers navigation and a few flows, but not token one-time plaintext/copy/revoke and other core admin page behaviors.
- Failure scenario: Hydrated admin pages break while action/unit tests still pass.
- Suggested fix: Add Playwright flows for token create/copy/ack/revoke and representative SEO/tags/users/backup UI validation.

### AGG-C12-21 - DB restore child-process failure cleanup remains source-only

- Severity: Medium
- Confidence: High
- Source agents: verifier-test-engineer
- Citation: `apps/web/src/__tests__/db-restore.test.ts:47-74`, `apps/web/src/app/[locale]/admin/db-actions.ts:807-833`
- Summary: Tests assert restore cleanup snippets exist, but do not execute fake child-process, stream, stdin, timer, or cleanup paths.
- Failure scenario: Spawn/stdin/read/timeout failure leaks child processes or streams while source text still matches.
- Suggested fix: Extract or inject the restore import runner enough to test failure branches with mocked `spawn`, fake streams, and timers.

### AGG-C12-22 - Lightroom upload route still has untested failure branches

- Severity: Medium
- Confidence: High
- Source agents: verifier-test-engineer
- Citation: `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:182-370`, `apps/web/src/app/api/admin/lr/upload/route.ts:101-158`, `apps/web/src/app/api/admin/lr/upload/route.ts:252-424`
- Summary: Success and several failures are covered, but many quota/lock/topic/settings/save/GPS/maintenance cleanup branches remain untested.
- Failure scenario: External Lightroom uploads get wrong status or leave quota/original/lock/audit state inconsistent in untested branches.
- Suggested fix: Add table-driven handler tests asserting response plus tracker settlement, lock release, original cleanup, DB insert/queue absence, and audit behavior.

### AGG-C12-23 - There is no coverage report, threshold, or changed-file ratchet

- Severity: Medium
- Confidence: High
- Source agents: verifier-test-engineer
- Citation: `apps/web/package.json:13`, `apps/web/vitest.config.ts:1-39`, `.github/workflows/quality.yml:66-67`
- Summary: Unit tests run without coverage reporting or thresholds, and there is no changed-file ratchet for critical directories.
- Failure scenario: A new route/action/migration/helper lands with zero executed behavior coverage while source-contract tests make the suite appear broad.
- Suggested fix: Add non-blocking Vitest V8 coverage first, then enforce a changed-file ratchet for critical paths with reviewed exemptions.

### AGG-C12-24 - Shared-group data reader owns hidden view-count mutation

- Severity: Low
- Confidence: High
- Source agents: code-reviewer, architect-document-specialist
- Citation: `apps/web/src/lib/data.ts:13-63`, `apps/web/src/lib/data.ts:1318-1407`, `apps/web/src/lib/data.ts:1805-1809`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`
- Summary: `getSharedGroup()` looks like a read helper but may buffer denormalized view-count writes.
- Failure scenario: A future preview or API read accidentally increments analytics, or caching/call order suppresses a desired increment.
- Suggested fix: Split pure reads from explicit `recordSharedGroupViewCount` mutation.

### AGG-C12-25 - Experimental storage abstraction advertises live-pipeline use without live-pipeline invariants

- Severity: Low
- Confidence: Medium
- Source agents: architect-document-specialist
- Citation: `apps/web/src/lib/storage/index.ts:1-18`, `apps/web/src/lib/storage/types.ts:44-100`, `apps/web/src/lib/storage/local.ts:76-108`, `apps/web/src/lib/storage/local.ts:142-156`, `apps/web/src/lib/process-image.ts:1164-1224`, `apps/web/src/lib/process-image.ts:1433-1477`, `apps/web/src/__tests__/storage-quarantine.test.ts:1-27`
- Summary: The quarantined storage abstraction looks suitable for uploads/serving/Sharp but lacks atomic replace, rollback, partial-write, and no-follow path invariants used by live filesystem code.
- Failure scenario: A future maintainer wires it into production and bypasses safety properties embedded in current image processing.
- Suggested fix: Keep quarantine and either delete the abstraction or expand the contract before integration with production primitives and parity tests.

### AGG-C12-26 - Active carry-forward backlog duplicates the runtime site-config decision

- Severity: Low
- Confidence: Medium
- Source agents: architect-document-specialist
- Citation: `.context/plans/deferred-carry-forward.md:24-29`, `.context/plans/deferred-carry-forward.md:60`, `.context/plans/deferred-carry-forward.md:76`, `README.md:56-58`, `apps/web/README.md:49-57`, `apps/web/docker-compose.yml:28-32`, `CLAUDE.md:157`
- Summary: Docs now consistently describe build-time/import-time `site-config.json`, but carry-forward still tracks duplicate runtime-editable config items.
- Failure scenario: Future cycles re-review the same product decision as separate architecture risks.
- Suggested fix: Consolidate the duplicate carry-forward rows into one product/operator decision item.

### AGG-C12-27 - Public map and timeline are implemented but undiscoverable from normal navigation

- Severity: Medium
- Confidence: High
- Source agents: designer-ui-ux-reviewer
- Citation: `README.md:36`, `apps/web/src/app/[locale]/(public)/map/page.tsx:68`, `apps/web/src/app/[locale]/(public)/timeline/page.tsx:61`, `apps/web/src/components/nav-client.tsx:128`, `apps/web/src/components/nav-client.tsx:167`, `apps/web/src/components/footer.tsx:41`, `apps/web/src/components/on-this-day-widget.tsx:24`, `apps/web/src/components/on-this-day-widget.tsx:39`
- Summary: README advertises map/timeline browsing, routes exist, but normal nav/footer do not expose persistent links.
- Failure scenario: Visitors cannot discover advertised browsing modes without knowing URLs or hitting a conditional widget.
- Suggested fix: Add footer/nav-overflow/About links for Map and Timeline.

### AGG-C12-28 - Production semantic search is active but hidden behind an icon-only nav affordance

- Severity: Medium
- Confidence: High
- Source agents: designer-ui-ux-reviewer
- Citation: `README.md:48`, `apps/web/README.md:67`, `apps/web/src/components/search.tsx:371`, `apps/web/src/components/search.tsx:521`
- Summary: Live semantic search works, but the closed search affordance is a magnifying-glass-only button with no visible `Search` text.
- Failure scenario: First-time demo visitors miss a major differentiator.
- Suggested fix: Show visible `Search`/`Search photos` copy when semantic search is active and add a compact semantic empty-state hint.

### AGG-C12-29 - Similar photos is absent from the mobile photo info surface

- Severity: Medium
- Confidence: High
- Source agents: designer-ui-ux-reviewer
- Citation: `README.md:48`, `apps/web/README.md:67`, `apps/web/src/components/similar-photos.tsx:58`, `apps/web/src/components/similar-photos.tsx:141`, `apps/web/src/components/photo-viewer.tsx:747`, `apps/web/src/components/photo-viewer.tsx:800`, `apps/web/src/components/info-bottom-sheet.tsx:353`
- Summary: Similar photos is desktop-sidebar only; mobile Info includes many details but no similar-photo discovery path.
- Failure scenario: Mobile visitors cannot access an advertised feature on the primary viewport.
- Suggested fix: Pass semantic mode and image sizes into `InfoBottomSheet` and mount `SimilarPhotos`, or document the desktop-only scope.

### AGG-C12-30 - Mobile home spends the first photo viewport on a tag-filter wall

- Severity: Medium
- Confidence: High
- Source agents: designer-ui-ux-reviewer
- Citation: `apps/web/src/components/home-client.tsx:303`, `apps/web/src/components/home-client.tsx:318`, `apps/web/src/components/tag-filter.tsx:62`
- Summary: The full wrapping tag filter sits before the masonry grid, pushing photos down on mobile.
- Failure scenario: As tag count grows, the first viewport becomes taxonomy-first rather than gallery-first.
- Suggested fix: Use a compact mobile filter model such as top tags plus overflow sheet or horizontal chip rail.

### AGG-C12-31 - Category, tag, and SEO save failures are toast-only

- Severity: Medium
- Confidence: High
- Source agents: designer-ui-ux-reviewer
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:108`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:204`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42`, `apps/web/src/app/[locale]/admin/login-form.tsx:62-126`
- Summary: Several admin form failures only show transient toasts instead of persistent field/form errors.
- Failure scenario: Keyboard and screen-reader admins lose recovery context after validation or save failure.
- Suggested fix: Reuse the login/settings pattern with persistent `role=\"alert\"`, `aria-invalid`, `aria-describedby`, focus management, and pending states.

### AGG-C12-32 - Tag autocomplete popovers can be clipped inside the admin image table scroller

- Severity: Medium
- Confidence: Medium
- Source agents: designer-ui-ux-reviewer
- Citation: `apps/web/src/components/image-manager.tsx:427`, `apps/web/src/components/image-manager.tsx:501`, `apps/web/src/components/tag-input.tsx:184`, `apps/web/src/components/tag-input.tsx:231`
- Summary: `TagInput` suggestions are absolutely positioned inside a table contained by an overflow scroller.
- Failure scenario: Suggestions near the scrollport edge are clipped and hard to select.
- Suggested fix: Render suggestions through a portal/popover layer or Radix Popover/Command-style surface; add an overflow-wrapper regression harness.

### AGG-C12-33 - Admin image management remains table-first for a photo-first workflow

- Severity: Low-Medium
- Confidence: Medium
- Source agents: designer-ui-ux-reviewer
- Citation: `apps/web/src/components/image-manager.tsx:427`, `apps/web/src/components/image-manager.tsx:431`, `apps/web/src/components/image-manager.tsx:501`
- Summary: Image management is a horizontally scrollable metadata table, with inline tag editing inside rows.
- Failure scenario: Batch cleanup after upload requires scanning across many columns and scroll states instead of operating from photo preview plus metadata inspector.
- Suggested fix: Add an optional photo workbench view with grid/list plus sticky metadata/tags inspector; keep the dense table for bulk operations.

## Cross-Agent Agreement

Highest-signal items by overlap:

- `AGG-C12-01` dependency audit: code-reviewer, security-reviewer, verifier-test-engineer.
- `AGG-C12-05` non-sargable date queries: code-reviewer, perf-debugger-tracer.
- `AGG-C12-06` public map hydration: code-reviewer, perf-debugger-tracer.
- `AGG-C12-07` listing aggregation before limit: code-reviewer, perf-debugger-tracer.
- `AGG-C12-08` brute-force semantic scans: code-reviewer, perf-debugger-tracer.
- `AGG-C12-14` byte-affecting settings vs static bytes: architect-document-specialist, perf-debugger-tracer.
- `AGG-C12-15` warn-only single-writer: code-reviewer, architect-document-specialist.
- `AGG-C12-16` reconcile parity: code-reviewer, verifier-test-engineer.
- `AGG-C12-17` CLIP production preflight: verifier-test-engineer, code-reviewer.
- `AGG-C12-19` source-only UI test oracles: code-reviewer, verifier-test-engineer.
- `AGG-C12-24` shared-group read side effect: code-reviewer, architect-document-specialist.

## Already Fixed / Not Carried Forward From Prior Aggregates

- Topic-route advisory-lock release cleanup is fixed.
- Drizzle Kit TLS CA handling is fixed.
- Raw `IMAGE_BASE_URL` client/CSP leakage is fixed.
- Restore background-write drain hang is fixed.
- Settings-hash mapper drift is fixed.
- Logout is now same-origin and restore-barrier aware.
- Search duplicate accessible labels are fixed.
- Smart-collection delete copy no longer references a phantom Collections UI.

## Final Sweep

No Critical direct production defect was confirmed in this cycle. One High release-risk gap remains: production CLIP activation is not covered by required gates. The dominant residual classes are dependency audit debt, public-query scale risks, topology/operation contracts that rely on manual validation, behavior gaps hidden by source-string tests, and UI discoverability/administration ergonomics.
