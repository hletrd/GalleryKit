# Run-10 Cycle 10/100 Deferred Findings

Date: 2026-07-07
Aggregate source: `.context/reviews/_aggregate.md`

Deferred items preserve original severity/confidence. Security, correctness, and data-loss issues are not deferred unless an explicit repository rule or current upstream/operator blocker is recorded.

## Deferred Items

### DEF-C10-04 - On This Day month/day query needs schema or cache design

- Aggregate: AGG-C10-04.
- Citation: `apps/web/src/lib/data-timeline.ts:97-116`, `apps/web/src/components/on-this-day-widget.tsx:15-22`, `apps/web/src/app/[locale]/(public)/page.tsx:234`.
- Original severity/confidence: Low / High.
- Reason for deferral: performance optimization requiring a generated-column/index migration or an explicit cache invalidation plan for image metadata changes. No current SLO breach or slow-query evidence was supplied, and WP3 addresses the higher-signal archive hot path first.
- Exit criterion: homepage traces or MySQL profiling show the widget as a measurable public-page bottleneck, or image metadata/index work touches `capture_date` query strategy.

### DEF-C10-05 - Public map marker corpus needs measured clustering/index work

- Aggregate: AGG-C10-05.
- Citation: `apps/web/src/lib/data.ts:1741-1768`, `apps/web/src/app/[locale]/(public)/map/page.tsx:42-66`, `apps/web/src/components/map/map-client.tsx:120-139`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: performance/product redesign requiring `EXPLAIN ANALYZE`, clustering or viewport pagination, and browser-performance validation. The current implementation is bounded by a 10,000-marker cap, and no production trace showed an active regression.
- Exit criterion: map-visible photos approach the cap, mobile map traces show main-thread stalls, or map UI/indexing is otherwise modified.

### DEF-C10-08 - Real CLIP default-gate coverage still depends on model weights

- Aggregate: AGG-C10-08.
- Citation: `apps/web/src/__tests__/clip-offline-load.test.ts:15-18`, `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-10`, `apps/web/package.json:21-24`, `.github/workflows/quality.yml:66-80`.
- Original severity/confidence: Medium / High.
- Reason for deferral: repository policy makes real-model proof operator-gated rather than default CI-gated. `CLAUDE.md` states the env-gated CLIP suites "are permanently skipped in CI (CI has no model weights), so this manual pre-flight is the ONLY verification that the real encoder loads offline and ranks semantically." Cycle 9 added `npm run test:clip:preflight`; this cycle does not change CLIP activation or model-loading code.
- Exit criterion: CLIP model weights become available in CI, production activation code changes, or product policy changes to require a runtime preflight marker before enabling production semantic search.

### DEF-C10-09 - Bottom-sheet dropdown browser regression coverage

- Aggregate: AGG-C10-09.
- Citation: `apps/web/src/__tests__/bottom-sheet-dropdown-portal.test.ts:14-26`, `apps/web/src/components/info-bottom-sheet.tsx:558-595`, `apps/web/e2e/test-fixes.spec.ts:56-65`.
- Original severity/confidence: Medium / High.
- Reason for deferral: test-depth expansion for an unchanged UI flow. Adding the Playwright mobile interaction is valuable but not necessary to close a confirmed runtime defect in this cycle; browser-flow coverage remains required when the sheet/dropdown behavior changes.
- Exit criterion: `info-bottom-sheet.tsx`, Radix select/dropdown wiring, or mobile sheet focus behavior changes, or a manual/browser report reproduces dropdown clipping/focus breakage.

### DEF-C10-10 - DOM-level touch-target audit for bare text links

- Aggregate: AGG-C10-10.
- Citation: `apps/web/src/__tests__/touch-target-audit.test.ts:457-465`, `apps/web/src/__tests__/touch-target-audit.test.ts:1053-1059`.
- Original severity/confidence: Medium / High.
- Reason for deferral: broad test-infrastructure expansion from source scanning to rendered DOM measurement. The repository already enforces the 44 px touch-target rule in AGENTS.md, and this cycle schedules narrower confirmed UI defects first.
- Exit criterion: a page/component change adds or modifies bare public links, a touch-target regression is found manually, or the Playwright audit harness is expanded for other UI coverage.

### DEF-C10-11 - Nav screenshot spec has no visual oracle

- Aggregate: AGG-C10-11.
- Citation: `apps/web/e2e/nav-visual-check.spec.ts:40-87`.
- Original severity/confidence: Low / High.
- Reason for deferral: low-severity test-quality improvement. Converting screenshots to stable baselines requires managing visual-diff artifacts and CI pixel tolerance; no nav behavior or styling change is scheduled in this cycle.
- Exit criterion: navigation CSS/layout changes, CI gains stable screenshot baselines, or a nav visual regression reaches production.

### DEF-C10-13 - Shared-group view-count buffer should move out of data layer

- Aggregate: AGG-C10-13.
- Citation: `apps/web/src/lib/data.ts:13-249`, `apps/web/src/instrumentation.ts:49-57`.
- Original severity/confidence: Low / High.
- Reason for deferral: architectural cleanup without a confirmed behavior defect. WP6 addresses the concrete lifecycle/shutdown asymmetry; moving the shared-group buffer can be done when data-layer modularization resumes.
- Exit criterion: `data.ts` is split, shared-group analytics changes, or another process-lifecycle timer is added to the data layer.

### DEF-C10-14 - Host nginx drift remains operator-owned

- Aggregate: AGG-C10-14.
- Citation: `CLAUDE.md:483-495`, `apps/web/deploy.sh:51-55`, `apps/web/nginx/default.conf:1-29`.
- Original severity/confidence: Medium / High.
- Reason for deferral: explicit repository operational contract. `CLAUDE.md` says, "Deploys do NOT touch host nginx" and that committed nginx templates are inert until an operator applies and verifies them by hand; this cycle's per-cycle deploy rebuilds the container and must not silently mutate host nginx.
- Exit criterion: nginx template changes, deploy tooling is explicitly expanded to verify host-nginx hashes, or an operator requests a host-nginx apply/check workflow.
