# Cycle 13 Aggregate Review

Date: 2026-07-07
Cycle start: `d8fcb3d62a88d09bb69458e3672129ed902318ba`

## Reviewer Coverage

Completed review artifacts:

- `code-reviewer.md`
- `perf-reviewer.md`
- `security-reviewer.md`
- `critic.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `architect.md`
- `debugger.md`
- `document-specialist.md`
- `designer.md`
- `product-marketer-reviewer.md`
- `ui-ux-designer-reviewer-cycle13.md`

Registered local reviewer surfaces included: `product-marketer-reviewer`, `ui-ux-designer-reviewer`.

Zero-finding lanes: `critic` found no fresh actionable findings; `tracer` found no confirmed causal/race/flow findings.

## Agent Failures

None. The initial `test-engineer` spawn hit the agent-thread limit and was retried successfully.

## Merged Findings

Total merged findings: 49.

### C13-AGG-01 - CI/local E2E runtime inherits non-local `BASE_URL` and rejects localhost admin actions

- Severity: High
- Confidence: High
- Cross-agent agreement: `code-reviewer`, `verifier`
- Source findings: `CR-C13-01`, `VER-C13-01`
- Citation: `.github/workflows/quality.yml:27-37`, `apps/web/playwright.config.ts:15-29`, `apps/web/scripts/run-e2e-server.mjs:95-110`, `apps/web/src/lib/request-origin.ts:45-67`, `apps/web/src/app/actions/auth.ts:99-103`
- Failure scenario: CI or local E2E exports a production/non-local `BASE_URL` while Playwright opens `http://127.0.0.1:<port>`, so same-origin protected admin actions reject localhost browser requests.
- Suggested fix: make the runtime E2E server use the actual local origin or unset inherited non-local `BASE_URL` for the runtime child while preserving build-time metadata behavior.

### C13-AGG-02 - Proxy topology checker claims XFF validation but never reaches IP/rate-limit code

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `code-reviewer`, `verifier`, related `security-reviewer`/`document-specialist`
- Source findings: `CR-C13-02`, `VER-C13-02`, related `C13-SEC-02`, `DOC-C13-04`
- Citation: `scripts/check-proxy-topology.mjs:98-119`, `apps/web/src/app/api/search/semantic/route.ts:117-127`, `apps/web/src/app/api/search/semantic/route.ts:173-184`, `apps/web/src/lib/rate-limit.ts:175-205`
- Failure scenario: the probe sends `text/plain`, is rejected before `getClientIp()`, and can pass while spoofed/collapsed `X-Forwarded-For` behavior remains untested.
- Suggested fix: either narrow the script claim or add a probe/diagnostic that actually exercises selected client-IP behavior.

### C13-AGG-03 - Proxy topology checker accepts unexpected non-500 statuses as success

- Severity: Low
- Confidence: High
- Cross-agent agreement: `code-reviewer`, `verifier`
- Source findings: `CR-C13-03`, `VER-C13-03`
- Citation: `scripts/check-proxy-topology.mjs:51-69`
- Failure scenario: unexpected `200`, `204`, `302`, `401`, or similar statuses fall through as success even though the probe is supposed to fail before mutation/expensive work.
- Suggested fix: make classifiers allowlist-only and throw on every unrecognized status.

### C13-AGG-04 - npm security overrides leave the dependency tree invalid under `npm ls`

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: `code-reviewer`, `security-reviewer`
- Source findings: `CR-C13-04`, `C13-SEC-03`
- Citation: `package.json:7-15`, `package-lock.json` transitive `postcss`/`esbuild` declarations
- Failure scenario: `npm audit` is green, but tooling or future installer behavior that treats `npm ls` as health evidence reports/fails the workspace as invalid.
- Suggested fix: prefer upstream-compatible releases when available; otherwise document and test the exact expected override-invalid edges.

### C13-AGG-05 - Quality workflow does not exercise the production Docker build path

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `verifier`
- Source finding: `VER-C13-04`
- Citation: `.github/workflows/quality.yml:62-109`, `apps/web/Dockerfile:1-120`, `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:13-18`
- Failure scenario: source lint/type/build/tests pass while native Linux optional dependency or Dockerfile regressions are missed until deploy.
- Suggested fix: add a production image build/smoke gate or equivalent non-mutating Docker build verification.

### C13-AGG-06 - Batch image deletion repeatedly scans derivative directories

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-01`
- Citation: `apps/web/src/app/actions/images.ts:860-884`, `apps/web/src/lib/process-image.ts:588-660`
- Failure scenario: deleting many images on NAS-backed storage walks the same derivative directories hundreds of times after DB rows are gone.
- Suggested fix: add a batch cleanup helper that scans each derivative directory once and deletes selected filename variants.

### C13-AGG-07 - Live queue and in-app backfill reserve DB pool headroom independently

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-02`
- Citation: `apps/web/src/db/index.ts:21-41`, `apps/web/src/lib/image-queue.ts:120-140`, `apps/web/src/lib/admin-backfill-runner.ts:96-141`
- Failure scenario: uploads and admin backfill both believe they left enough pool headroom, but together can consume most pool slots and starve requests.
- Suggested fix: introduce a shared background DB/CPU budget or weighted semaphore across background lanes.

### C13-AGG-08 - Sidecar color backfill concurrency is not pool-budget clamped

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-03`
- Citation: `apps/web/scripts/backfill-color-pipeline.ts:383-387`, `apps/web/src/db/index.ts:31-41`
- Failure scenario: `BACKFILL_CONCURRENCY=8` can drive a separate 10-connection pool during live traffic.
- Suggested fix: reuse the in-app pool-budget helper or add an operator override that explicitly requires maintenance-window intent.

### C13-AGG-09 - Homepage on-this-day query is non-sargable on every dynamic render

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-04`
- Citation: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/lib/data-timeline.ts:102-130`
- Failure scenario: every homepage request scans/group-sorts dated rows using `MONTH()`/`DAY()` as the archive grows.
- Suggested fix: add generated month/day keys and covering indexes, or a durable summary/cache backed by sargable columns.

### C13-AGG-10 - Timeline year list uses non-sargable `YEAR(capture_date)`

- Severity: Low
- Confidence: Medium
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-05`
- Citation: `apps/web/src/app/[locale]/(public)/timeline/page.tsx:72-80`, `apps/web/src/lib/data-timeline.ts:139-159`
- Failure scenario: large archives can require full processed/date scans before year selection.
- Suggested fix: add generated `capture_year` and an index, or maintain a year summary table after validation.

### C13-AGG-11 - Public listing queries aggregate tags before limiting page rows

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-06`
- Citation: `apps/web/src/lib/data.ts:786-828`, `apps/web/src/lib/data.ts:893-940`
- Failure scenario: broad listing requests group tag rows for many candidates before returning 30-31 images.
- Suggested fix: fetch page image IDs first, then aggregate tags only for those IDs.

### C13-AGG-12 - Public text search relies on multi-query substring scans

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-07`
- Citation: `apps/web/src/lib/data.ts:1574-1713`
- Failure scenario: short terms can scan large parts of images/tags/topic aliases per allowed public request.
- Suggested fix: validate with production-like `EXPLAIN`; consider FULLTEXT or normalized search indexes.

### C13-AGG-13 - Semantic search and similar-photo routes brute-force embedding blobs per request

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-08`
- Citation: `apps/web/src/lib/clip-embeddings.ts:188-235`, `apps/web/src/app/api/search/semantic/route.ts:263-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:177-214`
- Failure scenario: each semantic request decodes and scores many embedding blobs in-process, consuming CPU/memory under repeated use.
- Suggested fix: validate scan limits with production row counts and move toward vector indexing or tighter candidate pruning.

### C13-AGG-14 - Lightroom upload route may materialize a max-size multipart file before disk streaming

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-09`
- Citation: `apps/web/src/app/api/admin/lr/upload/route.ts`, upload body limit configuration
- Failure scenario: large Lightroom uploads can consume substantial memory before disk streaming/backpressure takes over.
- Suggested fix: validate memory behavior under max-size uploads and move to streaming multipart parsing if material.

### C13-AGG-15 - Public map can hydrate up to 10,000 markers plus duplicate accessible list

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: `perf-reviewer`
- Source finding: `PERF-C13-10`
- Citation: `apps/web/src/app/[locale]/(public)/map/page.tsx`, `apps/web/src/components/map/*`
- Failure scenario: marker-heavy galleries hydrate thousands of markers and list rows, hurting mobile/low-power responsiveness.
- Suggested fix: cluster/window markers and virtualize or paginate the accessible list.

### C13-AGG-16 - Single-writer correctness remains warn-only while state is process-local

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `architect`, `security-reviewer`
- Source findings: `ARCH-C13-02`, `C13-SEC-01`
- Citation: `apps/web/src/lib/single-writer-guard.ts:7-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`, `apps/web/src/lib/upload-tracker-state.ts:15-20`, `apps/web/src/lib/rate-limit.ts:78-99`
- Failure scenario: an accidental second web process splits process-local upload quotas, rate-limit fast paths, queue state, and restore/admin mutation fences while startup continues after a warning.
- Suggested fix: add an enforcing production singleton mode or move correctness state to DB/shared coordination before allowing multiple instances.

### C13-AGG-17 - Public dynamic-page flood protection depends on manually applied nginx state

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `architect`, `security-reviewer`
- Source findings: `ARCH-C13-03`, related `C13-SEC-02`
- Citation: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`, `apps/web/nginx/default.conf:274-295`, `apps/web/deploy.sh:51-77`
- Failure scenario: if the active proxy misses the committed nginx limiter or real-IP posture, dynamic public pages can reach Next/MySQL without the intended navigation limiter or can collapse visitors into one bucket.
- Suggested fix: verify edge limiter/real-IP state during deployment/health checks or add app-layer fallback limiting.

### C13-AGG-18 - Timed-out DB child processes may never be force-killed

- Severity: High
- Confidence: High
- Cross-agent agreement: `debugger`
- Source finding: `DBG13-01`
- Citation: `apps/web/src/app/[locale]/admin/db-actions.ts:44-81`, `apps/web/src/app/[locale]/admin/db-actions.ts:243-249`, `apps/web/src/app/[locale]/admin/db-actions.ts:818-820`, `apps/web/src/app/[locale]/admin/db-actions.ts:929-934`
- Failure scenario: backup/restore/migration timeout handlers can call the watchdog clear function, mark the child settled before real exit/close, and prevent the SIGKILL grace timer from killing a hung child.
- Suggested fix: separate actual child settlement from watchdog cleanup, or arm SIGKILL before invoking timeout handlers; add behavioral timer tests.

### C13-AGG-19 - DB pool init timeout releases a still-busy connection back to the pool

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `debugger`
- Source finding: `DBG13-02`
- Citation: `apps/web/src/db/index.ts:68-75`, `apps/web/src/db/index.ts:102-119`, `apps/web/src/db/index.ts:126-142`
- Failure scenario: a timed-out session-init query can continue running after the connection is released back to the pool, poisoning later app queries.
- Suggested fix: destroy the connection on init timeout and add a behavioral mocked-pool test.

### C13-AGG-20 - Runtime-critical failure modes are protected by source-contract tests only

- Severity: Low
- Confidence: High
- Cross-agent agreement: `debugger`, related `test-engineer`
- Source finding: `DBG13-03`
- Citation: `apps/web/src/__tests__/cycle-20-source-contracts.test.ts:9-16`, `apps/web/src/__tests__/db-pool-connection-handler.test.ts:33-43`
- Failure scenario: source-string tests pass while timer/process/pool behavior is broken.
- Suggested fix: add behavioral tests for child-process watchdog timeout/SIGKILL and DB pool init timeout disposal.

### C13-AGG-21 - Byte-impacting settings commit before derivative generation catches up

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `architect`
- Source finding: `ARCH-C13-01`
- Citation: `apps/web/src/app/actions/settings.ts:168-239`, `apps/web/src/lib/settings-hash.ts:14-19`, `apps/web/src/lib/serve-upload.ts:252-258`, `apps/web/src/lib/process-image.ts:1187-1198`
- Failure scenario: public/admin configuration reflects a new byte policy while existing static derivatives continue serving old bytes until a backfill completes.
- Suggested fix: version derivative generation or persist/enforce pending-backfill state before presenting the new byte policy as fully applied.

### C13-AGG-22 - Shared-group reads own one half of view-recording semantics

- Severity: Low
- Confidence: High
- Cross-agent agreement: `architect`
- Source finding: `ARCH-C13-04`
- Citation: `apps/web/src/lib/data.ts:1318-1407`, `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:137-142`, `apps/web/src/app/actions/public.ts:517-558`
- Failure scenario: future previews or cached read calls can accidentally increment denormalized view counts without an actual public view.
- Suggested fix: make shared-group retrieval pure and move counting into explicit view-recording service.

### C13-AGG-23 - Docker native dependency pins can drift from package versions

- Severity: Low
- Confidence: High
- Cross-agent agreement: `architect`
- Source finding: `ARCH-C13-05`
- Citation: `apps/web/Dockerfile:50-62`, `apps/web/Dockerfile:76-85`, `apps/web/package.json:58-83`
- Failure scenario: dependency updates pass macOS tests while Linux container native packages stay stale and break image processing/build.
- Suggested fix: derive native versions from lockfile or add a source-contract test that catches Dockerfile/package drift.

### C13-AGG-24 - Cycle 13 plans point at a stale Cycle 12 aggregate

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `document-specialist`
- Source finding: `DOC-C13-01`
- Citation: `.context/plans/*cycle13*`
- Failure scenario: implementers work from stale review provenance and miss current cycle findings.
- Suggested fix: update current cycle plans to cite this aggregate.

### C13-AGG-25 - Active plan index still says Cycle 10 is current

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `document-specialist`
- Source finding: `DOC-C13-02`
- Citation: `.context/plans/README.md`
- Failure scenario: future agents start from the wrong active plan set.
- Suggested fix: update the plan index to the current active plan(s).

### C13-AGG-26 - Top-level review slots mix multiple cycles

- Severity: Low-Medium
- Confidence: High
- Cross-agent agreement: `document-specialist`
- Source finding: `DOC-C13-03`
- Citation: `.context/reviews/*.md`
- Failure scenario: top-level review files represent different cycles, making aggregate/provenance confusing.
- Suggested fix: archive or namescope old top-level review slots after current aggregate/plan migration.

### C13-AGG-27 - nginx multi-hop remediation guidance is split across incompatible contracts

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `document-specialist`, related `security-reviewer`
- Source finding: `DOC-C13-04`
- Citation: `CLAUDE.md`, `apps/web/nginx/default.conf`, `scripts/check-proxy-topology.mjs`
- Failure scenario: operators follow conflicting XFF/real-IP guidance and deploy a topology that passes docs but fails rate-limit/IP attribution assumptions.
- Suggested fix: consolidate multi-hop guidance around one tested contract and make the checker match it.

### C13-AGG-28 - Carry-forward has duplicate runtime-site-config rows for one decision

- Severity: Low
- Confidence: High
- Cross-agent agreement: `document-specialist`
- Source finding: `DOC-C13-05`
- Citation: `.context/plans/*carry*`
- Failure scenario: future cycles treat one product decision as two separate backlog items.
- Suggested fix: merge duplicate carry-forward rows while preserving history.

### C13-AGG-29 - Playwright browser/device coverage is too narrow for the UI risk profile

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-01`
- Citation: `apps/web/playwright.config.ts`, `apps/web/e2e/*.spec.ts`
- Failure scenario: mobile/tablet/browser-specific UI regressions escape default e2e coverage.
- Suggested fix: add selected mobile/tablet projects or high-value responsive specs without requiring extra long-lived DB containers.

### C13-AGG-30 - Nav visual checks capture screenshots but do not assert visual diffs

- Severity: Low
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-02`
- Citation: `apps/web/e2e/nav-visual-check.spec.ts`
- Failure scenario: screenshots are written but CI does not fail on visual regressions.
- Suggested fix: add assertions or rename the spec to avoid implying visual diff coverage.

### C13-AGG-31 - Admin password-change UI has no browser-level regression test

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-03`
- Citation: `apps/web/e2e/admin.spec.ts`, `apps/web/src/app/[locale]/admin/(protected)/password/*`
- Failure scenario: password validation/focus/toast regressions pass unit/source tests but fail in browser.
- Suggested fix: add admin-authenticated browser coverage where credentials are available.

### C13-AGG-32 - Service-worker registration can disappear while SW logic tests stay green

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-04`
- Citation: `apps/web/src/components/service-worker-registration.tsx`, `apps/web/src/__tests__/service-worker*.test.ts`
- Failure scenario: generated SW logic remains tested while the client registration component disappears or stops mounting.
- Suggested fix: add a source or component test that proves registration is wired into the app tree.

### C13-AGG-33 - Client component behavior is over-represented by source-string tests

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `test-engineer`, related `debugger`
- Source finding: `TE13-05`
- Citation: `apps/web/src/__tests__/*source*.test.ts`
- Failure scenario: component behavior regresses while string-contract tests still pass.
- Suggested fix: convert high-risk source contracts to behavioral tests over time.

### C13-AGG-34 - Timeline/year-in-review tests partly reimplement behavior

- Severity: Low
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-06`
- Citation: `apps/web/src/__tests__/data-timeline*.test.ts`, `apps/web/src/lib/data-timeline.ts`
- Failure scenario: tests duplicate logic and pass while runtime query behavior changes.
- Suggested fix: test exported helpers/queries directly with representative fixtures.

### C13-AGG-35 - Test-only request mocks erase route contract types

- Severity: Low
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-07`
- Citation: route tests using request mocks
- Failure scenario: tests pass with mock shapes that real `NextRequest` would not provide.
- Suggested fix: use real `Request`/`NextRequest` construction helpers.

### C13-AGG-36 - Real HEIF/AVIF/HDR fixture gap remains open

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-08`
- Citation: color/HDR tests and fixture directories
- Failure scenario: synthetic fixtures miss parser/encoder edge cases in real camera assets.
- Suggested fix: add minimal real-file fixtures with documented licensing/provenance.

### C13-AGG-37 - No coverage report, threshold, or changed-file coverage ratchet exists

- Severity: Low
- Confidence: High
- Cross-agent agreement: `test-engineer`
- Source finding: `TE13-09`
- Citation: `apps/web/package.json`, Vitest config surface
- Failure scenario: coverage can regress silently across large codebase changes.
- Suggested fix: add a focused coverage report/ratchet for critical modules.

### C13-AGG-38 - Admin category, tag, and SEO save failures are toast-only

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `designer`
- Source finding: `DES-C13-01`
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx`
- Failure scenario: server validation failures disappear with a toast and leave no field-level or form-level error state for keyboard/screen-reader users.
- Suggested fix: persist inline `role="alert"` errors, `aria-invalid`, `aria-describedby`, focus target, and pending state.

### C13-AGG-39 - Tag autocomplete popovers can be clipped inside the admin image table scroller

- Severity: Medium
- Confidence: Medium
- Cross-agent agreement: `designer`
- Source finding: `DES-C13-02`
- Citation: `apps/web/src/components/image-manager.tsx:427-534`, `apps/web/src/components/tag-input.tsx:183-234`
- Failure scenario: suggestions render inside an overflow table wrapper and can be partially hidden.
- Suggested fix: portal/popover the suggestions outside the clipping ancestor.

### C13-AGG-40 - Production GA beacons are CSP-blocked on `www.google.com/g/collect`

- Severity: Low
- Confidence: High
- Cross-agent agreement: `designer`
- Source finding: `DES-C13-03`
- Citation: `apps/web/src/lib/content-security-policy.ts:99-104`, `apps/web/src/lib/content-security-policy.ts:153-169`, `apps/web/src/__tests__/content-security-policy.test.ts:21-27`
- Failure scenario: GA script loads but beacons are blocked, undercounting analytics and creating console noise.
- Suggested fix: include `https://www.google.com` in analytics-only `connect-src` and test the observed endpoint.

### C13-AGG-41 - Map and timeline are marketed but effectively undiscoverable

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `product-marketer-reviewer`
- Source finding: `PMR-C12-01`
- Citation: `README.md:36`, `apps/web/src/components/nav-client.tsx:128-191`, `apps/web/src/components/footer.tsx:41-61`, `apps/web/src/app/sitemap.ts:129-135`
- Failure scenario: visitors see map/timeline positioned in docs but have no visible home/footer/nav path to those pages.
- Suggested fix: add persistent public affordances, at least footer links and sitemap inclusion where appropriate.

### C13-AGG-42 - Production semantic search is hidden behind icon-only affordance

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `product-marketer-reviewer`
- Source finding: `PMR-C12-02`
- Citation: `README.md:48`, `apps/web/src/components/search.tsx:371-386`, `apps/web/src/components/search.tsx:521-555`
- Failure scenario: the demo's strongest differentiator is active but not visibly discoverable before opening an icon-only search button.
- Suggested fix: show visible search copy at desktop widths and add empty-state semantic examples when production semantic search is enabled.

### C13-AGG-43 - Similar photos is absent from the mobile photo info surface

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `product-marketer-reviewer`
- Source finding: `PMR-C12-03`
- Citation: `README.md:48`, `apps/web/src/components/photo-viewer.tsx:747-800`, `apps/web/src/components/info-bottom-sheet.tsx:353-608`
- Failure scenario: mobile visitors cannot access an advertised similar-photo discovery feature.
- Suggested fix: render `<SimilarPhotos>` inside `InfoBottomSheet` when semantic search is production-enabled, or scope docs to desktop.

### C13-AGG-44 - Mobile header focus order jumps to the far-right menu before left-side controls

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `ui-ux-designer-reviewer`
- Source finding: `UIUX-C13-01`
- Citation: `apps/web/src/components/nav-client.tsx:106-125`, `apps/web/src/components/nav-client.tsx:167-190`
- Failure scenario: keyboard focus moves brand -> far-right menu -> search/theme/language, violating spatial predictability.
- Suggested fix: align DOM and visual order and add a mobile tab-order assertion.

### C13-AGG-45 - Mobile home puts the full tag-filter wall before the first photo

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `ui-ux-designer-reviewer`
- Source finding: `UIUX-C13-02`
- Citation: `apps/web/src/components/home-client.tsx:287-330`, `apps/web/src/components/tag-filter.tsx:62-122`
- Failure scenario: mobile visitors and keyboard users traverse many tag chips before reaching the first photo.
- Suggested fix: compact/collapse mobile filters while preserving active filter and accessibility semantics.

### C13-AGG-46 - Admin navigation remains a flat ten-link wrap

- Severity: Low-Medium
- Confidence: High
- Cross-agent agreement: `ui-ux-designer-reviewer`
- Source finding: `UIUX-C13-03`
- Citation: `apps/web/src/components/admin-nav.tsx:15-49`, `apps/web/src/components/admin-header.tsx:13-27`
- Failure scenario: admin destinations wrap unpredictably on narrow/Korean layouts.
- Suggested fix: group navigation into stable sections or a sectioned narrow-width menu.

### C13-AGG-47 - Admin recent uploads remains table-first instead of photo-workbench-first

- Severity: Medium
- Confidence: Medium-High
- Cross-agent agreement: `ui-ux-designer-reviewer`
- Source finding: `UIUX-C13-04`
- Citation: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:135-143`, `apps/web/src/components/image-manager.tsx:427-553`
- Failure scenario: admins doing visual metadata cleanup must work in a horizontally scrolling table.
- Suggested fix: add a photo workbench mode with inspector while keeping dense table as optional.

### C13-AGG-48 - Category and tag delete confirmations do not name the target

- Severity: Medium
- Confidence: High
- Cross-agent agreement: `ui-ux-designer-reviewer`
- Source finding: `UIUX-C13-05`
- Citation: `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:141-147`, `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:327-333`, `apps/web/messages/en.json:93-94`, `apps/web/messages/en.json:128-129`
- Failure scenario: an interrupted admin returns to a generic destructive confirmation and must rely on memory of which tag/category was selected.
- Suggested fix: interpolate the selected tag/category name into the confirmation title/description.

### C13-AGG-49 - Long Settings form has only a top save action

- Severity: Low-Medium
- Confidence: Medium
- Cross-agent agreement: `ui-ux-designer-reviewer`
- Source finding: `UIUX-C13-06`
- Citation: `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:316-330`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx:731-858`
- Failure scenario: admins changing bottom settings must scroll back to the top to save and may miss the action on mobile.
- Suggested fix: add a sticky bottom action bar or repeated final save/cancel action with dirty-state text.
