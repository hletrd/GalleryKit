# Run-10 Cycle 37/100 Deferred Findings

Date: 2026-07-08 KST
Aggregate: `.context/reviews/_aggregate.md`
Status: OPEN

## Repo Rules Read Before Deferral

- `CLAUDE.md`
- `AGENTS.md`
- `.context/plans/README.md`
- Current Cycle 37 reviews under `.context/reviews/cycle37/`
- `README.md`
- `apps/web/README.md`
- `docs/superpowers/specs/2026-06-14-clip-semantic-search-design.md`
- `docs/superpowers/plans/2026-06-15-clip-semantic-search.md`

No `.cursorrules` or `CONTRIBUTING.md` file exists in this checkout.

Security, correctness, and data-loss findings are not deferred here. The confirmed typecheck breakage, navigation visibility mismatch, Lightroom upload restore-barrier timing, photo-page SW/docs mismatch, and OSM privacy-doc mismatch are scheduled in `plan.md`.

## Deferred Items

### AGG-C37-03 - Upload queue and in-app re-encode backfill oversubscribe the same DB/CPU budget

- Original severity/confidence: High / High.
- Citations: `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/image-queue.ts:447-456`; `apps/web/src/lib/admin-backfill-runner.ts:23-44`; `apps/web/src/lib/admin-backfill-runner.ts:120-143`; `apps/web/src/lib/admin-backfill-runner.ts:722-733`; `apps/web/src/lib/process-image.ts:1411-1418`; `.context/reviews/_aggregate.md`.
- Reason for deferral: broad performance/topology architecture requiring a shared process-wide resource coordinator across upload processing, in-app backfill, and future background consumers. This is not a confirmed security, correctness, or data-loss defect; it is already documented as an operational pool-headroom risk in `CLAUDE.md` and the run-10 carry-forward policy in `.context/plans/README.md` allows broad high-severity deferred items to remain only with explicit age tracking and reclassification pressure.
- Exit criterion: schedule when changing queue/backfill concurrency, seeing production DB pool wait/timeout/RSS evidence during upload plus re-encode overlap, or when the carry-forward age budget requires scheduling/reclassification.

### AGG-C37-05 - Public map can mount up to 10k markers and a 10k fallback list in one render

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:42-111`; `apps/web/src/components/map/map-client.tsx:78-95`; `apps/web/src/components/map/map-client.tsx:109-143`; `.context/reviews/_aggregate.md`.
- Reason for deferral: map clustering/viewport paging is a larger UX/performance change that needs browser measurement and library/API design. No current production freeze or correctness failure was proven in this cycle.
- Exit criterion: schedule when map gallery size approaches thousands of public GPS photos, performance traces show long tasks on `/map`, or map clustering/viewport paging is otherwise being implemented.

### AGG-C37-06 - Public map query has GPS predicates without a map-specific index

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/app/[locale]/(public)/map/page.tsx:13-15`; `apps/web/src/lib/data.ts:1784-1802`; `apps/web/src/db/schema.ts:49-50`; `apps/web/src/db/schema.ts:123-132`; `.context/reviews/_aggregate.md`.
- Reason for deferral: likely performance risk requiring production-sized `EXPLAIN ANALYZE` before adding a migration/index. Schema changes require migration, journal, and reconcile updates under AGENTS.md; no measured query regression was provided.
- Exit criterion: schedule after collecting EXPLAIN evidence on production-like cardinality or when adding map clustering/query pagination.

### AGG-C37-08 - Single-writer guard is advisory and starts after process-local schedulers

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/instrumentation.ts:7-30`; `apps/web/src/lib/single-writer-guard.ts:7-16`; `apps/web/src/lib/single-writer-guard.ts:218-235`; `apps/web/src/lib/single-writer-guard.ts:294-302`; `.context/reviews/_aggregate.md`.
- Reason for deferral: topology-policy decision. `CLAUDE.md` documents the shipped single web-instance/single-writer topology and the guard as warn-only; converting it to fail-fast production enforcement can affect rolling deploy availability and needs an explicit operator decision.
- Exit criterion: schedule when changing deployment topology, adding scale-out support, adding a strict singleton env flag, or seeing evidence of concurrent live web processes.

### AGG-C37-10 - Photo prev/next navigation loses source collection context

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/components/photo-navigation.tsx`; `apps/web/src/lib/data.ts`; public topic/share/smart-collection photo routes; `.context/reviews/_aggregate.md`.
- Reason for deferral: UX/product behavior change across global, topic, share, smart-collection, and search entry points. No data-loss/security issue is involved, and the desired contract needs design before changing navigation semantics.
- Exit criterion: schedule when editing photo navigation, adding source-context routing, or receiving user feedback that collection navigation unexpectedly exits the source set.

### AGG-C37-11 - Proxy-topology diagnostic consumes semantic-search rate-limit budget

- Original severity/confidence: Low-Medium / High.
- Citations: `scripts/check-proxy-topology.mjs:7-16`; `scripts/check-proxy-topology.mjs:106-134`; `apps/web/src/app/api/search/semantic/route.ts:173-200`; `apps/web/src/lib/rate-limit.ts:415-433`; `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:29-47`; `.context/reviews/_aggregate.md`.
- Reason for deferral: low-severity operator diagnostic side effect. The semantic limiter budget recovers naturally and the current cycle prioritizes blocking typecheck and user-visible contract mismatches.
- Exit criterion: schedule when changing proxy diagnostics, semantic route rate limits, or deploy preflight scripts.

### AGG-C37-12 - Proxy client-IP rate limits can collapse if deployment topology drifts

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/lib/rate-limit.ts:175-217`; `CLAUDE.md:97-98`; `CLAUDE.md:753`; `apps/web/nginx/default.conf:59-71`; `scripts/check-proxy-topology.mjs:7-16`; `scripts/check-proxy-topology.mjs:131-134`; `.context/reviews/_aggregate.md`.
- Reason for deferral: deployment-validation risk, not a confirmed vulnerability in the shipped topology. `README.md` and `CLAUDE.md` already require trusted proxy configuration and warn about the shared-bucket failure mode.
- Exit criterion: schedule when changing nginx/proxy topology docs or scripts, adding a diagnostic effective-client-IP proof, or deploying behind a new CDN/LB chain.

### AGG-C37-13 - Dynamic public page flood protection is edge-only in direct/custom proxy deployments

- Original severity/confidence: Low / Medium.
- Citations: `apps/web/src/app/[locale]/(public)/page.tsx:17-19`; `apps/web/src/app/[locale]/(public)/page.tsx:155-178`; `apps/web/nginx/default.conf:1-10`; `apps/web/nginx/default.conf:274-296`; `README.md:175-177`; `scripts/check-proxy-topology.mjs:79-91`; `.context/reviews/_aggregate.md`.
- Reason for deferral: unsupported/custom deployment topology risk. The repo's documented deployment keeps the app behind the shipped nginx/edge limiter and warns not to expose the app directly.
- Exit criterion: schedule when supporting custom proxy/direct deployments, adding app-layer public-page limiting, or changing deploy verification around the public limiter.

### AGG-C37-14 - Checked-in Atik deployment config can ship as another operator's metadata

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/site-config.json:2-10`; `apps/web/src/site-config.example.json:2-11`; `apps/web/scripts/ensure-site-config.mjs:11-42`; `README.md:60-77`; `README.md:118-122`; `README.md:171-172`; `apps/web/src/app/sitemap.ts:14-18`; `apps/web/src/app/sitemap.ts:70-107`; `.context/reviews/_aggregate.md`.
- Reason for deferral: product/distribution packaging decision. This invocation explicitly targets the configured `gallery.atik.kr` deployment, and replacing/rejecting the tracked Atik config could affect the active site without a separate release-packaging decision.
- Exit criterion: schedule when preparing public distribution packaging, changing static config policy, or adding an explicit allow flag for deployment-specific checked-in config.

### AGG-C37-15 - Public footer hardwires product/vendor surfaces into every gallery

- Original severity/confidence: Low-Medium / High.
- Citations: `apps/web/src/components/footer.tsx:32-68`; `apps/web/src/app/[locale]/(public)/about-gallerykit/page.tsx:21-45`; `apps/web/messages/en.json:838-846`; `apps/web/src/app/sitemap.ts:25`; `apps/web/src/app/sitemap.ts:100-107`; `.context/reviews/_aggregate.md`.
- Reason for deferral: product/branding policy decision. The current open-source demo/gallery policy intentionally exposes GalleryKit/GitHub/Admin links; changing attribution defaults should be a deliberate operator-config feature, not bundled into the nav-visibility bug fix.
- Exit criterion: schedule when adding configurable footer attribution/utility links or preparing a portfolio-safe distribution mode.

### AGG-C37-16 - Search is a core claim but remains easy to miss below large desktop

- Original severity/confidence: Low / Medium-High.
- Citations: `README.md:38-50`; `apps/web/src/components/nav-client.tsx:170-175`; `apps/web/src/components/search.tsx:381-398`; `apps/web/messages/en.json:420-436`; `.context/reviews/_aggregate.md`.
- Reason for deferral: low-severity product-discovery polish with no correctness/security impact. Cycle 36 already improved primary browse-route discoverability; broader search affordance changes need design validation.
- Exit criterion: schedule when editing public nav/search layout, search onboarding, or homepage discovery copy.

### AGG-C37-17 - Admin navigation is a flat wrapping strip across unrelated work areas

- Original severity/confidence: Low-Medium / High.
- Citations: `apps/web/src/components/admin-nav.tsx:15-49`; `apps/web/src/components/admin-header.tsx:13-27`; `.context/reviews/_aggregate.md`.
- Reason for deferral: admin IA redesign across many pages; no workflow-breaking issue was confirmed. Current cycle focuses on narrow confirmed contract mismatches.
- Exit criterion: schedule during admin navigation redesign, when adding another admin section, or if admin responsive/browser testing shows wrap-order confusion.

### AGG-C37-18 - No coverage metric or changed-code ratchet exists

- Original severity/confidence: Medium / High.
- Citations: `package.json:17-30`; `apps/web/package.json:8-30`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`; `.context/reviews/_aggregate.md`.
- Reason for deferral: broad CI/test-infrastructure policy. Coverage ratchets need calibration to avoid overvaluing existing source-contract tests or blocking historical low-coverage areas abruptly.
- Exit criterion: schedule during test-infra hardening or when introducing coverage reporting/ratchets as a CI policy.

### AGG-C37-19 - Browser-flow CI is still desktop Chromium only

- Original severity/confidence: Medium / High.
- Citations: `apps/web/playwright.config.ts:48-86`; `.github/workflows/quality.yml:75-80`; `CLAUDE.md:708-721`; `.context/reviews/_aggregate.md`.
- Reason for deferral: CI matrix expansion affects runtime cost and flake management. No current browser-specific regression was proven in this cycle.
- Exit criterion: schedule when adding mobile/WebKit smoke coverage, changing Playwright CI, or when browser-specific regressions recur.

### AGG-C37-20 - Nav visual E2E captures screenshots without a visual oracle

- Original severity/confidence: Medium / High.
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:40-87`; `apps/web/playwright.config.ts:63-77`; `.context/reviews/_aggregate.md`.
- Reason for deferral: visual-regression infrastructure requires baseline strategy, masking, and artifact policy. The current screenshot artifact remains useful for manual review but is not an automated oracle.
- Exit criterion: schedule when adding screenshot assertions, visual diffing, or structural/accessibility replacements for nav visual checks.

### AGG-C37-21 - CLIP production preflight is not required for CLIP-touching changes

- Original severity/confidence: Medium / High.
- Citations: `apps/web/package.json:21-23`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-65`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-80`; `.github/workflows/quality.yml:69-83`; `.github/workflows/clip-preflight.yml:3-46`; `apps/web/src/__tests__/cycle12-ops-contracts.test.ts:56-65`; `.context/reviews/_aggregate.md`.
- Reason for deferral: CI/model-weight availability decision. The repo intentionally keeps production CLIP activation operator-gated and normal CI has no seeded weights.
- Exit criterion: schedule when CLIP-touching source changes, when CI can access seeded weights, or when requiring path-filtered CLIP preflight.

### AGG-C37-22 - Operator sidecars still rely mostly on source-contract tests

- Original severity/confidence: Medium / Medium-High.
- Citations: `apps/web/scripts/backfill-alt-text.ts:47-160`; `apps/web/scripts/backfill-cicp-recheck.ts:51-157`; `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-53`; `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:20-31`; `apps/web/src/__tests__/advisory-lock-release-contract.test.ts:18-34`; `.context/reviews/_aggregate.md`.
- Reason for deferral: behavior-test extraction across operator scripts is broader than the narrow current fixes and does not correspond to a confirmed runtime failure.
- Exit criterion: schedule when editing sidecar scripts, adding injectable runners, or addressing operator-script reliability.

### AGG-C37-23 - Hydration E2E uses `networkidle` as completion oracle

- Original severity/confidence: Low-Medium / Medium.
- Citations: `apps/web/e2e/hydration-photo-page.spec.ts:20-50`; `apps/web/playwright.config.ts:59-67`; `.context/reviews/_aggregate.md`.
- Reason for deferral: low/medium test reliability hardening that needs an explicit app readiness marker. No active flake is proven in this cycle.
- Exit criterion: schedule when editing hydration e2e, adding readiness markers, or seeing flakes/false confidence around photo-page hydration.
