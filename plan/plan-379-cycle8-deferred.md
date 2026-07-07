# Run-10 Cycle 8/100 Deferred Findings

Date: 2026-07-07
Review aggregate: `.context/reviews/_aggregate.md`

## Deferral Policy

Repo rules were read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, relevant `.context/**`, no `.cursorrules`, no `CONTRIBUTING.md`, and `docs/superpowers/**`. Deferred work remains bound by repo policy: GPG-signed commits, conventional commit + gitmoji, no `Co-Authored-By`, no `--no-verify`, no force-push, `git pull --rebase` before push, required gates, and current language/toolchain policy.

No security, correctness, or data-loss finding is deferred here. Those findings are scheduled in `plan/plan-378-cycle8-fixes.md`.

## Deferred Items

### D-C8-01 - Production CLIP sidecar resume/skip mechanism
- Original: `AGG-C8-08`
- Citation: `apps/web/scripts/backfill-clip-embeddings.ts:150-248`, `apps/web/README.md:80-82`
- Original severity/confidence: Medium / Medium
- Reason: operational resilience improvement; WP9 documents the current behavior this cycle, while durable checkpoint/resume needs CLI design and operator compatibility.
- Exit criterion: production backfill repeatedly fails on a low-id prefix, or CLIP sidecar CLI work is scheduled.

### D-C8-02 - Full disposable LR PAT upload integration environment
- Original: residual from `AGG-C8-09`
- Citation: `apps/web/src/app/api/admin/lr/upload/route.ts:84-92`, `apps/web/src/__tests__/lr-upload-route-behavior.test.ts:44-47`
- Original severity/confidence: Medium / High
- Reason: WP10 schedules the code-level proof this cycle; a true DB/filesystem/browser-like disposable integration may need a dedicated isolated MySQL profile and must not touch the cycle-7 MySQL container.
- Exit criterion: route wrapper/context tests still cannot prove token scope/context and multipart success together, or a disposable e2e DB profile is available.

### D-C8-03 - Admin e2e destination coverage
- Original: `AGG-C8-10`
- Citation: `apps/web/e2e/admin.spec.ts:6-165`, `apps/web/src/components/admin-nav.tsx:15-26`
- Original severity/confidence: Medium / High
- Reason: test coverage broadening; not a current source behavior defect. Requires disposable admin e2e environment and should not reuse the cycle-7 MySQL container.
- Exit criterion: admin nav/page work changes, release requires browser-flow proof, or a disposable e2e profile is provisioned.

### D-C8-04 - Coverage ratchet
- Original: `AGG-C8-12`
- Citation: `apps/web/package.json:13`, `apps/web/vitest.config.ts:16-39`
- Original severity/confidence: Medium / High
- Reason: repository-wide quality-strategy change with threshold calibration risk; not suitable to bolt on without baseline design.
- Exit criterion: new critical branches repeatedly ship without tests, or a coverage baseline task is approved.

### D-C8-05 - Zoom/swipe combined browser tests
- Original: `AGG-C8-13`
- Citation: `apps/web/src/components/image-zoom.tsx:198-258`, `apps/web/src/components/photo-viewer.tsx:400-420`, `apps/web/e2e/swipe-visual-reset.spec.ts:59-131`
- Original severity/confidence: Medium / Medium-High
- Reason: browser-flow coverage expansion; no confirmed current runtime defect.
- Exit criterion: zoom/swipe code changes or a mobile/WebKit e2e expansion is scheduled.

### D-C8-06 - WebKit/Mobile Safari Playwright smoke
- Original: `AGG-C8-14`
- Citation: `apps/web/playwright.config.ts:48-77`
- Original severity/confidence: Low-Medium / High
- Reason: matrix expansion with runtime cost and host-browser dependencies.
- Exit criterion: mobile/touch code changes, Safari-specific bug report, or e2e runtime budget is expanded.

### D-C8-07 - Visual screenshot assertions
- Original: `AGG-C8-15`
- Citation: `apps/web/e2e/nav-visual-check.spec.ts:6-85`
- Original severity/confidence: Low / High
- Reason: visual baseline adoption needs deterministic masking/theme strategy; existing metric assertions still catch target-size/overlap regressions.
- Exit criterion: nav visual regressions recur or visual snapshot infra is adopted.

### D-C8-08 - Derivative setting invalidation model
- Original: `AGG-C8-18`
- Citation: `apps/web/next.config.ts:56-73`, `apps/web/src/lib/serve-upload.ts:240-258`, `apps/web/src/app/actions/settings.ts:168-239`
- Original severity/confidence: Medium / High
- Reason: architectural product decision; current docs already disclose static-path behavior and backfill requirement.
- Exit criterion: byte-impacting settings UX changes, content-addressed derivatives are planned, or operators report stale derivative confusion.

### D-C8-09 - Enforceable single-writer mode
- Original: `AGG-C8-19`
- Citation: `apps/web/src/lib/single-writer-guard.ts:6-16`, `apps/web/src/lib/single-writer-guard.ts:218-235`
- Original severity/confidence: Medium / High
- Reason: operational topology hardening; current shipped topology is single instance with loud warn-only guard.
- Exit criterion: multi-instance deployment is attempted or ops asks for fail-readiness enforcement.

### D-C8-10 - Shared-group read/write separation
- Original: `AGG-C8-20`
- Citation: `apps/web/src/lib/data.ts:1322-1407`, `apps/web/src/lib/data.ts:1796-1800`
- Original severity/confidence: Low / High
- Reason: design/coupling cleanup; not a currently confirmed user-visible bug.
- Exit criterion: new shared-group read callers are added or view-count inaccuracies matter beyond best-effort analytics.

### D-C8-11 - Storage abstraction atomic contract
- Original: `AGG-C8-21`
- Citation: `apps/web/src/lib/storage/index.ts:1-12`, `apps/web/src/lib/storage/local.ts:98-156`, `apps/web/src/lib/process-image.ts:1164-1224`
- Original severity/confidence: Low / Medium
- Reason: future-integration risk only; abstraction is documented as not wired to the live pipeline.
- Exit criterion: storage backend integration work starts.

### D-C8-12 - Admin field-associated errors for category/tag/SEO
- Original: `AGG-C8-23`
- Citation: `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx:90-221`, `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx:52-181`, `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:42-184`
- Original severity/confidence: Medium / High
- Reason: accessibility/UX improvement across several admin forms; not a security/correctness/data-loss issue.
- Exit criterion: those forms are touched, admin a11y sprint starts, or screen-reader issue is reported.

### D-C8-13 - Tag autocomplete portal/popover
- Original: `AGG-C8-24`
- Citation: `apps/web/src/components/image-manager.tsx:424-531`, `apps/web/src/components/tag-input.tsx:183-275`
- Original severity/confidence: Medium / Medium
- Reason: likely UI clipping issue requiring interactive verification and component refactor.
- Exit criterion: tag input/table work changes or clipping is reproduced in browser tests.

### D-C8-14 - Configurable public product/footer chrome
- Original: `AGG-C8-25`
- Citation: `apps/web/src/components/footer.tsx:32-64`, `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx:21-45`
- Original severity/confidence: Low-Medium / High
- Reason: product customization decision, not a defect in current open-source demo posture.
- Exit criterion: photographer-branded deployments request hiding project chrome.

### D-C8-15 - Upload-token expiry control
- Original: `AGG-C8-26`
- Citation: `apps/web/messages/en.json:867-894`, `apps/web/src/app/[locale]/admin/(protected)/tokens/tokens-client.tsx:70-246`
- Original severity/confidence: Low / High
- Reason: UI/copy mismatch with low operational risk; tokens can still be revoked.
- Exit criterion: token UI is changed or external-client credential lifecycle is revisited.

### D-C8-16 - Mobile tag filter IA
- Original: `AGG-C8-28`
- Citation: `apps/web/src/components/tag-filter.tsx:62-123`, `apps/web/src/components/home-client.tsx:232-342`
- Original severity/confidence: Medium / High
- Reason: public UX optimization; not a correctness defect.
- Exit criterion: mobile public homepage redesign or tag taxonomy growth causes first-photo visibility complaints.

### D-C8-17 - Admin photo workbench redesign
- Original: `AGG-C8-29`
- Citation: `apps/web/src/app/[locale]/admin/(protected)/dashboard/dashboard-client.tsx:140-144`, `apps/web/src/components/image-manager.tsx:321-600`
- Original severity/confidence: High / High-likely
- Reason: broad product/UI redesign, not safe to bundle with security/correctness fixes.
- Exit criterion: admin bulk photo workflow becomes a product priority or table friction is reported.

### D-C8-18 - Grouped admin IA
- Original: `AGG-C8-30`
- Citation: `apps/web/src/components/admin-nav.tsx:15-29`, `apps/web/src/components/admin-header.tsx:13-27`
- Original severity/confidence: Medium / High
- Reason: IA refactor that should be coordinated with admin navigation/product work.
- Exit criterion: adding another admin nav destination or admin redesign starts.

### D-C8-19 - Photo viewer shortcut help
- Original: `AGG-C8-31`
- Citation: `apps/web/src/components/photo-viewer.tsx:400-584`, `apps/web/src/components/lightbox.tsx:316-368`, `apps/web/src/components/photo-navigation.tsx:306-329`
- Original severity/confidence: Medium / Medium-High
- Reason: usability improvement; current shortcuts function.
- Exit criterion: photo viewer controls are touched or keyboard-help feature is planned.

### D-C8-20 - Critical photo-viewer chrome
- Original: `AGG-C8-32`
- Citation: `apps/web/src/components/photo-viewer.tsx:483-542`, `apps/web/src/components/photo-viewer.tsx:697`
- Original severity/confidence: Low-Medium / High-Medium
- Reason: visual/product tradeoff; lightbox exists as the immersive view.
- Exit criterion: photographer/fidelity review prioritizes normal viewer inspection mode.

### D-C8-21 - Korean settings content design
- Original: `AGG-C8-33`
- Citation: `apps/web/messages/en.json:765-815`, `apps/web/messages/ko.json:790-815`, `apps/web/src/app/[locale]/admin/(protected)/settings/settings-client.tsx`
- Original severity/confidence: Medium / Medium
- Reason: content/layout polish; no confirmed overflow failure.
- Exit criterion: settings page is redesigned or Korean admin screenshots show overload/overflow.

### D-C8-22 - Admin mobile touch-target governance
- Original: `AGG-C8-34`
- Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:42-88`, `apps/web/src/__tests__/touch-target-audit.test.ts:156-243`
- Original severity/confidence: Low-Medium / Medium
- Reason: governance/product support-scope decision; current primitive floor still enforces 44 px.
- Exit criterion: mobile admin support becomes explicit.

### D-C8-23 - Public map marker/list virtualization
- Original: `AGG-C8-35`
- Citation: `apps/web/src/lib/data.ts:1732-1782`, `apps/web/src/app/[locale]/(public)/map/page.tsx:13-110`, `apps/web/src/components/map/map-client.tsx:77-139`
- Original severity/confidence: Medium / High
- Reason: performance improvement on large GPS galleries; currently bounded and no production freeze evidence in this cycle.
- Exit criterion: map usage grows, production marker count approaches cap, or map route work starts.

### D-C8-24 - Timeline/On This Day sargability
- Original: `AGG-C8-36`
- Citation: `apps/web/src/lib/data-timeline.ts:7-207`, `apps/web/src/components/on-this-day-widget.tsx:10-22`
- Original severity/confidence: Medium / High
- Reason: performance/indexing work with migration implications.
- Exit criterion: timeline/home DB CPU shows up in production metrics, or date archive work starts.

### D-C8-25 - Smart collection query/index strategy
- Original: `AGG-C8-37`
- Citation: `apps/web/src/lib/smart-collections.ts:21-267`, `apps/web/src/lib/data.ts:1488-1550`
- Original severity/confidence: Medium / High
- Reason: smart collection authoring is not yet a first-class admin UI; indexing/materialization needs product choices.
- Exit criterion: smart-collection authoring UI ships or public collection traffic grows.

### D-C8-26 - Batch derivative delete scanning
- Original: `AGG-C8-38`
- Citation: `apps/web/src/app/actions/images.ts:778-884`, `apps/web/src/lib/process-image.ts:575-630`
- Original severity/confidence: Medium / High
- Reason: performance optimization for large deletes; current delete cap/concurrency bounds risk.
- Exit criterion: large batch deletes are slow on NAS or delete code changes.

### D-C8-27 - Upload route range support
- Original: `AGG-C8-39`
- Citation: `apps/web/src/app/uploads/[...path]/route.ts:4-15`, `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts:4-15`, `apps/web/src/lib/serve-upload.ts:268-369`
- Original severity/confidence: Medium / Medium
- Reason: likely fallback-route HTTP behavior/doc mismatch; static serving handles dominant path.
- Exit criterion: route-handler fallback serves large derivatives in production, CDN requires range support, or upload route comments are edited.

### D-C8-28 - Agent-thread fan-out constraint
- Original: `AGG-C8-41`
- Citation: `.context/reviews/_aggregate.md`
- Original severity/confidence: Low / High
- Reason: process observation, already recorded in aggregate; no repo code fix.
- Exit criterion: orchestration tooling changes or a future review requires stricter single-wave execution.

### D-C8-29 - Next-bundled PostCSS advisory awaiting stable upstream fix
- Original: `AGG-C8-04`
- Citation: `package.json:6-9`, `package-lock.json`, `node_modules/next/package.json`, `npm audit --json`
- Original severity/confidence: Medium / High
- Reason: latest stable `next@16.2.10` still declares exact nested `postcss@8.4.31`; npm overrides update top-level/tooling PostCSS to `8.5.16` but do not replace Next's nested exact dependency in this workspace. `next@canary` declares fixed `postcss@8.5.10`, but repo policy requires latest stable versions, not canary. This is a residual dependency warning, not an app-code suppression.
- Exit criterion: a stable Next release declares `postcss >= 8.5.10`, or npm supports replacing this exact nested dependency without moving to canary/unstable Next.
