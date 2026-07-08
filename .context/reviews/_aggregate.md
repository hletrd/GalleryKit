# Run-10 Cycle 36 Aggregate Review

Date: 2026-07-08 KST
Repo: `/Users/hletrd/flash-shared/gallery`
Scope: Prompt 1 aggregate over all cycle-36 review lanes.

## Agent Coverage

Completed review files:

- `code-reviewer.md`
- `critic.md`
- `perf-reviewer.md`
- `architect.md`
- `security-reviewer.md`
- `debugger.md`
- `verifier.md`
- `test-engineer.md`
- `tracer.md`
- `document-specialist.md`
- `designer.md`
- `ui-ux-designer-reviewer.md`
- `product-marketer-reviewer.md`

Additional reviewer-style agents discovered and included: `ui-ux-designer-reviewer`, `product-marketer-reviewer`.

AGENT FAILURES: none. One UI/UX/product spawn initially failed due to the active agent thread limit, then succeeded after a completed worker was closed.

## Deduplicated Findings

### AGG-C36-01 - Background DB/CPU capacity is budgeted locally, not globally

- Severity: High
- Confidence: High
- Status: likely operational correctness/performance issue
- Cross-agent agreement: code-reviewer, critic, perf-reviewer, architect, tracer
- Source findings: CR36-02, CRT36-02, PERF-C36-01, ARCH-C36-01, TRC-C36-01
- Regions: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`; `apps/web/src/lib/background-db-writes.ts:8-75`; `apps/web/src/lib/clip-model.ts:53-173`
- Failure scenario: image processing, admin color backfill, semantic embedding work, analytics writes, and maintenance can each obey a local cap while collectively exhausting the 10-connection pool and CPU. Foreground gallery/admin requests can queue behind background work during upload/backfill/search overlap.
- Suggested fix: add a shared background resource coordinator or admission policy for DB-bearing and CPU-heavy background work. Gate image queue, in-app color backfill, semantic embedding work, maintenance, and analytics through one budget, and add overlap regression coverage.

### AGG-C36-02 - Semantic embedding/retrieval ownership is fragmented

- Severity: Medium
- Confidence: High
- Status: likely resource ownership and maintainability risk
- Cross-agent agreement: code-reviewer, critic, architect, perf-reviewer, tracer
- Source findings: CR36-03, CRT36-03, ARCH-C36-03, PERF-C36-03, TRC-C36-02
- Regions: `apps/web/src/lib/image-queue.ts:501-637`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130`; `apps/web/src/app/actions/embeddings.ts:113-210`; `apps/web/src/lib/clip-model.ts:53-173`; `apps/web/src/app/api/search/semantic/route.ts:247-330`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-280`
- Failure scenario: upload-time embedding, bootstrap embedding, admin action embedding, sidecar backfill, semantic search, and similar-photo routes share model/DB/CPU resources without one owner. Upserts prevent duplicate-row corruption, but production activation can contend with public semantic requests and duplicate inference.
- Suggested fix: centralize embedding writes and semantic retrieval behind a service or durable queue/lease table. Make scan-limit semantics explicit and preserve public query capacity during backfills.

### AGG-C36-03 - Color sidecar batch flushing can persist another worker's claimed image

- Severity: Low-Medium
- Confidence: Medium
- Status: ownership-invariant risk
- Cross-agent agreement: code-reviewer, tracer
- Source findings: CR36-04, TRC-C36-03
- Regions: `apps/web/scripts/backfill-color-pipeline.ts:471-527`; `apps/web/scripts/backfill-color-pipeline.ts:557-603`
- Failure scenario: process-global `updateBatch` / `derivativeBatch` allow worker A to flush worker B's row while B owns the per-image claim. Current global sidecar locking limits blast radius, but claim release is no longer strictly tied to the transaction committing that image.
- Suggested fix: make batches caller-owned or attach per-item completion/release callbacks. Add a two-worker regression proving a claim is held until the transaction containing that item commits.

### AGG-C36-04 - Root Playwright runtime state is tracked

- Severity: Low
- Confidence: High
- Status: confirmed repository hygiene/provenance issue
- Cross-agent agreement: code-reviewer, critic
- Source findings: CR36-01, CRT36-01
- Regions: `test-results/.last-run.json:1-4`; `.gitignore:126-127`; `apps/web/playwright.config.ts:63-77`
- Failure scenario: committed Playwright `.last-run.json` reports stale failure state and root-level Playwright runs can dirty the worktree with mutable runtime artifacts.
- Suggested fix: untrack `test-results/.last-run.json` and ignore root `test-results/` and `playwright-report/`. Keep intentional screenshots in `.context/`.

### AGG-C36-05 - Checked-in Atik deployment config can ship as another operator's production metadata

- Severity: Medium
- Confidence: High
- Status: distribution/product risk
- Cross-agent agreement: critic, document-specialist, product-marketer-reviewer
- Source findings: CRT36-04, DOC-C36-02, PMR-C36-01
- Regions: `apps/web/src/site-config.json:1-10`; `apps/web/src/site-config.example.json:1-12`; `apps/web/scripts/ensure-site-config.mjs:11-42`; `README.md:60-77`; `apps/web/src/app/[locale]/layout.tsx:15-48`; `apps/web/src/components/footer.tsx:33-37`
- Failure scenario: a self-hosted production build that forgets to replace `site-config.json` can emit Atik branding, canonical URL, footer/nav text, OpenGraph metadata, and sitemap/feed origin.
- Suggested fix: track only a generic example config, or fail production builds using `gallery.atik.kr` unless an explicit deployment opt-in is present.

### AGG-C36-06 - Live nginx limiter/client-IP behavior is not proven by repo gates

- Severity: Medium
- Confidence: High
- Status: manual validation risk
- Cross-agent agreement: code-reviewer, critic, security-reviewer, debugger, verifier
- Source findings: RISK36-01, MAN36-01, security manual risk, debugger manual risk, VER-C36-01
- Regions: `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:59-71`; `apps/web/nginx/default.conf:274-307`; `apps/web/deploy.sh:51-108`; `scripts/check-proxy-topology.mjs:12-16`; `CLAUDE.md:514-526`
- Failure scenario: normal deploys rebuild the container but do not apply/reload host nginx. Production can run stale limiter/body-size/real-IP behavior, or bucket all visitors by a load balancer IP.
- Suggested fix: keep this as an ops proof requirement: `nginx -t`, reload, burst 429 proof for `/` and `/_next/image`, normal non-429 proof, and effective client-IP validation.

### AGG-C36-07 - CLIP production readiness is outside standard release evidence

- Severity: Medium
- Confidence: High
- Status: confirmed/manual gate gap
- Cross-agent agreement: code-reviewer, critic, verifier, test-engineer
- Source findings: RISK36-03, MAN36-03, VER-C36-02, TE-C36-04
- Regions: `apps/web/package.json:21-23`; `.github/workflows/quality.yml:69-83`; `.github/workflows/clip-preflight.yml:3-46`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`; `CLAUDE.md:558-626`
- Failure scenario: semantic/CLIP changes can pass normal CI while offline real-model loading or ranking fails on the production volume.
- Suggested fix: run the CLIP preflight on PR/push for CLIP/model/semantic files and lockfile changes, or require a recorded activation artifact before enabling production semantic mode.

### AGG-C36-08 - Fresh/reconciled DB schema parity is not structurally proven

- Severity: Medium
- Confidence: Medium
- Status: test-depth risk
- Cross-agent agreement: verifier
- Source finding: VER-C36-03
- Regions: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-225`; `apps/web/scripts/migrate.js:877-897`
- Failure scenario: a migration changes type/default/nullability/FK/index details while `reconcileLegacySchema` still mentions the same names. Source tripwires pass, fresh DB baselines, and migrated vs reconciled schemas diverge.
- Suggested fix: add a disposable MySQL parity harness comparing `information_schema` columns, indexes, and FKs for high-risk tables after migrate-vs-reconcile bootstraps.

### AGG-C36-09 - Max-size multipart upload RSS remains unmeasured

- Severity: Medium
- Confidence: High
- Status: manual capacity risk
- Cross-agent agreement: code-reviewer, critic, verifier
- Source findings: RISK36-02, MAN36-02, VER-C36-04
- Regions: `CLAUDE.md:657-663`; `apps/web/nginx/default.conf:132-147`; `apps/web/src/app/actions/images.ts:87-262`; `apps/web/src/app/api/admin/lr/upload/route.ts:143-191`
- Failure scenario: framework multipart buffering plus Sharp processing can exceed container memory during concurrent near-200 MiB uploads even when logical app/nginx limits pass.
- Suggested fix: run a production-like RSS measurement and tune upload limits, concurrency, or memory from the observed safe envelope.

### AGG-C36-10 - No coverage metric or risk-based ratchet exists

- Severity: Medium
- Confidence: High
- Status: confirmed test strategy gap
- Cross-agent agreement: critic, test-engineer
- Source findings: CRT36-05, TE-C36-01
- Regions: `package.json:17-30`; `apps/web/package.json:13-30`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`
- Failure scenario: behavioral coverage around actions, API routes, migrations, restore, upload, or image processing can drop while lint/typecheck/unit/e2e remain green.
- Suggested fix: add non-blocking coverage reporting, then ratchet changed-code or high-risk module coverage with explicit waivers for exceptional cases.

### AGG-C36-11 - Browser-flow coverage is desktop-Chromium-only and visual checks lack a visual oracle

- Severity: Medium
- Confidence: High
- Status: confirmed e2e coverage gap
- Cross-agent agreement: critic, test-engineer
- Source findings: MAN36-04, TE-C36-02, TE-C36-03
- Regions: `apps/web/playwright.config.ts:48-77`; `.github/workflows/quality.yml:75-80`; `apps/web/e2e/nav-visual-check.spec.ts:40-87`; `CLAUDE.md:708-721`
- Failure scenario: mobile WebKit/Safari, touch, service-worker, focus, color-gamut, or visual hierarchy regressions can pass CI. The nav spec saves screenshots but does not compare them.
- Suggested fix: add a small mobile WebKit smoke project and either rename the nav spec as geometry-only or add stable screenshot assertions with masks.

### AGG-C36-12 - Hydration E2E uses `networkidle` as its readiness oracle

- Severity: Low-Medium
- Confidence: Medium
- Status: flake/reliability risk
- Cross-agent agreement: test-engineer
- Source finding: TE-C36-06
- Regions: `apps/web/e2e/hydration-photo-page.spec.ts:20-50`; `apps/web/playwright.config.ts:59-67`
- Failure scenario: hydration warnings can arrive after `networkidle`, or unrelated background requests can make the test slow/flaky.
- Suggested fix: expose an app-owned hydrated marker and assert console/page errors for a bounded interval after that marker.

### AGG-C36-13 - Operator sidecars rely mostly on source-contract tests

- Severity: Medium
- Confidence: Medium-High
- Status: likely coverage gap
- Cross-agent agreement: test-engineer
- Source finding: TE-C36-05
- Regions: `apps/web/scripts/backfill-alt-text.ts:55-160`; `apps/web/scripts/backfill-cicp-recheck.ts:51-157`; `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-53`; `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:20-31`
- Failure scenario: sidecar behavior can regress around disabled/force gates, restore-maintenance checks, advisory locks, tuple unwrapping, missing originals, queue drains, counters, and exit codes while source text pins stay green.
- Suggested fix: extract pure runners with injected dependencies and add behavior tests for lock held, disabled setting, `--force`, restore markers, row failures, tuple unwrap, missing originals, and queue drain.

### AGG-C36-14 - Map route loads and hydrates up to 10,000 markers/list items

- Severity: Medium
- Confidence: High
- Status: likely performance/architecture issue
- Cross-agent agreement: perf-reviewer, architect
- Source findings: PERF-C36-02, ARCH-C36-04
- Regions: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:13-111`; `apps/web/src/components/map/map-client.tsx:78-142`
- Failure scenario: a large gallery can force each uncached `/map` request to query, serialize, server-render, hydrate, and keep thousands of markers/list entries resident, hurting mobile responsiveness.
- Suggested fix: split map shell, viewport/cluster data source, and accessible list. Add bbox/cluster loading or lower the initial cap and defer heavy work.

### AGG-C36-15 - Public image projection ownership is hand-mirrored

- Severity: Medium
- Confidence: High
- Status: confirmed architectural drift risk
- Cross-agent agreement: architect
- Source finding: ARCH-C36-02
- Regions: `apps/web/src/lib/data.ts:368-475`; `apps/web/src/lib/data-timeline.ts:17-80`
- Failure scenario: a public-safe field change in the canonical projection can fail to reach timeline/year/on-this-day projections because the guard only rejects sensitive leakage, not parity drift.
- Suggested fix: share projection construction from one module and add an explicit parity test with documented route-specific omissions.

### AGG-C36-16 - Footer and primary navigation hide or break secondary browse routes

- Severity: Medium
- Confidence: High
- Status: confirmed UI/IA issue
- Cross-agent agreement: designer, ui-ux-designer-reviewer, product-marketer-reviewer
- Source findings: DES-C36-01, DES-C36-02, UIUX-C36-01, UIUX-C36-04, PMR-C36-04
- Regions: `apps/web/src/components/footer.tsx:41-68`; `apps/web/src/components/nav-client.tsx:91-194`; `apps/web/src/app/[locale]/(public)/map/page.tsx:69-115`; `apps/web/src/app/[locale]/(public)/timeline/page.tsx:151-299`
- Failure scenario: at 320px the footer link row overflows horizontally, and Timeline/Map are footer-only despite being core browse modes. Visitors on long galleries may miss them entirely.
- Suggested fix: wrap/footer links for 320px and promote Timeline/Map into primary nav or a compact Browse menu, including mobile expanded nav.

### AGG-C36-17 - Admin mobile UX and SEO field errors are too coarse

- Severity: Medium
- Confidence: High
- Status: confirmed/source-backed UI issue
- Cross-agent agreement: designer, ui-ux-designer-reviewer
- Source findings: DES-C36-03, UIUX-C36-02, UIUX-C36-03
- Regions: `apps/web/src/components/image-manager.tsx:427-620`; `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:34-209`; `apps/web/src/app/actions/seo.ts:85-140`
- Failure scenario: admin image management requires horizontal table scrolling for core actions on mobile/small laptops, and SEO save failures mark every field invalid for one server-side error.
- Suggested fix: add a responsive image-card/workbench layout below `lg`; return structured field errors from `updateSeoSettings` and mark/focus only affected controls.

### AGG-C36-18 - Future RTL and product-copy affordances are not ready

- Severity: Low
- Confidence: Medium-High
- Status: future-locale/product clarity risk
- Cross-agent agreement: designer, ui-ux-designer-reviewer, product-marketer-reviewer
- Source findings: DES-C36-04, UIUX-C36-05, PMR-C36-02, PMR-C36-03
- Regions: `apps/web/src/app/[locale]/layout.tsx:101-107`; `apps/web/src/components/nav-client.tsx:100-180`; `apps/web/src/components/footer.tsx:42-44`; `apps/web/messages/en.json:824-840`; `apps/web/src/components/search.tsx:380-397`
- Failure scenario: adding an RTL locale can expose physical left/right layout utilities, the footer `GalleryKit` link can surprise portfolio visitors with product-marketing copy, and keyword search is icon-only unless semantic production is enabled.
- Suggested fix: before adding RTL, replace physical utilities with logical/direction-aware classes and add RTL browser checks. Clarify GalleryKit footer wording and show a compact Search label for all modes where space allows.

### AGG-C36-19 - Cycle 35 plan status is stale after signed push

- Severity: Medium
- Confidence: High
- Status: confirmed documentation/provenance mismatch
- Cross-agent agreement: document-specialist
- Source finding: DOC-C36-01
- Regions: `.context/plans/run10-cycle35/plan.md:1-3`; `.context/plans/run10-cycle35/plan.md:154-162`; `.context/plans/README.md:34-38`; git commit `c62c8c1e`
- Failure scenario: the previous plan says signed push/deploy are pending even though the signed push landed. Future planners can duplicate release work or misread the cycle state.
- Suggested fix: update the status to "implemented, signed push complete, deploy evidence absent/pending" unless deploy evidence is added.

## Final Sweep Summary

The review set covered auth/admin boundaries, action-origin and mutation barriers, public route rate limits, upload/restore races, advisory lock ownership, background capacity, semantic search, migrations/reconcile, privacy projections, service worker behavior, Docker/nginx/deploy contracts, CI gate shape, browser/UX surfaces, i18n, and product positioning.

No confirmed code-level auth bypass, public PII leak, route-rate-limit miss, migration cursor bug, image derivative corruption race, or restore-over-live-write bug was identified in this cycle.
