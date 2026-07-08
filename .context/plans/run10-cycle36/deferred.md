# Run-10 Cycle 36/100 Deferred Findings

Status: OPEN
Aggregate: `.context/reviews/_aggregate.md`
Date: 2026-07-08 KST

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `.context/plans/run10-cycle35/{plan,deferred}.md`, current `.context/**` plan/review artifacts, README files, and docs under `docs/superpowers/`. No confirmed security, data-loss, or authz finding is deferred here.

## Deferred Items

### AGG-C36-01 - Background DB/CPU capacity is budgeted locally, not globally

- Original severity/confidence: High / High.
- Citations: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`; `apps/web/src/lib/background-db-writes.ts:8-75`; `apps/web/src/lib/clip-model.ts:53-173`; `.context/reviews/_aggregate.md`.
- Reason for deferral: broad resource-governor architecture across foreground traffic, image queue, color backfill, semantic work, maintenance, and analytics. The reviews classify it as an operational performance/capacity risk, not a confirmed security, authz, data-loss, or data-corruption defect. A safe fix needs design, shared admission tests, and careful concurrency semantics beyond this cycle's contained UI/docs/hygiene fixes.
- Exit criterion: schedule when implementing a shared background resource coordinator, changing pool/concurrency formulas, adding DB pool observability, or seeing production pool queue-limit/timeout evidence.

### AGG-C36-02 - Semantic embedding/retrieval ownership is fragmented

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/image-queue.ts:501-637`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130`; `apps/web/src/app/actions/embeddings.ts:113-210`; `apps/web/src/lib/clip-model.ts:53-173`; `apps/web/src/app/api/search/semantic/route.ts:247-330`; `apps/web/src/app/api/search/similar/[id]/route.ts:177-280`.
- Reason for deferral: service-boundary/resource-ownership design across upload, bootstrap, admin action, sidecar, and public routes. Upserts converge data and no duplicate-row/data-loss bug was confirmed.
- Exit criterion: schedule when changing semantic activation/backfill ownership, CLIP model-version handling, semantic route ranking, or production semantic-search automation.

### AGG-C36-03 - Color sidecar batch flushing can persist another worker's claimed image

- Original severity/confidence: Low-Medium / Medium.
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:471-527`; `apps/web/scripts/backfill-color-pipeline.ts:557-603`.
- Reason for deferral: low-to-medium invariant hardening in an operator sidecar with an existing global color-backfill lock and processed-row filters. No current data corruption was confirmed.
- Exit criterion: schedule when modifying color sidecar batching, adding another processed-row writer, or strengthening per-image lock ownership tests.

### AGG-C36-05 - Checked-in Atik deployment config can ship as another operator's production metadata

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/site-config.json:1-10`; `apps/web/src/site-config.example.json:1-12`; `apps/web/scripts/ensure-site-config.mjs:11-42`; `README.md:60-77`; `apps/web/src/app/[locale]/layout.tsx:15-48`; `apps/web/src/components/footer.tsx:33-37`.
- Reason for deferral: product/distribution packaging decision. This invocation explicitly deploys the Atik target via configured deploy env; rejecting the Atik URL in production could break the active deployment unless the deployment env is first updated with an explicit allow flag.
- Exit criterion: schedule when preparing distribution packaging, changing static config policy, or deciding to require an explicit allow flag for deployment-specific `site-config.json`.

### AGG-C36-06 - Live nginx limiter/client-IP behavior is not proven by repo gates

- Original severity/confidence: Medium / High.
- Citations: `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:59-71`; `apps/web/nginx/default.conf:274-307`; `apps/web/deploy.sh:51-108`; `scripts/check-proxy-topology.mjs:12-16`; `CLAUDE.md:514-526`.
- Reason for deferral: requires live host nginx/topology evidence and potentially host config reloads. Repo rules require deploys through `npm run deploy` and document that host nginx is operator-applied; this cycle will still perform non-destructive `/api/live` and missing-upload smokes after deploy.
- Exit criterion: schedule when proxy topology changes, nginx template security blocks change, operator context is available for `nginx -T`/reload/burst proof, or production evidence shows limiter/client-IP drift.

### AGG-C36-07 - CLIP production readiness is outside standard release evidence

- Original severity/confidence: Medium / High.
- Citations: `apps/web/package.json:21-23`; `.github/workflows/quality.yml:69-83`; `.github/workflows/clip-preflight.yml:3-46`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`; `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`; `CLAUDE.md:558-626`.
- Reason for deferral: CI policy/model-weight availability decision. Normal gates intentionally skip real CLIP weights; production semantic mode remains operator-gated.
- Exit criterion: schedule when CLIP/model/semantic-production files change, model weights become available to CI, or path-filtered CLIP preflight becomes release policy.

### AGG-C36-08 - Fresh/reconciled DB schema parity is not structurally proven

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-225`; `apps/web/scripts/migrate.js:877-897`.
- Reason for deferral: disposable MySQL structural-diff harness requires heavier integration setup and high-risk table metadata modeling. Existing migration journal and source tripwires remain active.
- Exit criterion: schedule when adding migrations/reconcile logic, improving DB integration tests, or seeing schema drift despite current tripwires.

### AGG-C36-09 - Max-size multipart upload RSS remains unmeasured

- Original severity/confidence: Medium / High.
- Citations: `CLAUDE.md:657-663`; `apps/web/nginx/default.conf:132-147`; `apps/web/src/app/actions/images.ts:87-262`; `apps/web/src/app/api/admin/lr/upload/route.ts:143-191`.
- Reason for deferral: requires controlled production-like upload load/RSS measurement and possibly large test media. It is operational capacity evidence, not a source-code defect.
- Exit criterion: schedule when operator capacity-testing context exists, upload limits/concurrency change, or memory pressure/restart evidence appears.

### AGG-C36-10 - No coverage metric or risk-based ratchet exists

- Original severity/confidence: Medium / High.
- Citations: `package.json:17-30`; `apps/web/package.json:13-30`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`.
- Reason for deferral: broad CI/test-infra program. Coverage should start non-blocking and be calibrated to avoid noisy source-contract inflation.
- Exit criterion: schedule during test-infra hardening or when CI policy is ready for coverage reporting/ratchets.

### AGG-C36-11 - Browser-flow coverage is desktop-Chromium-only and visual checks lack a visual oracle

- Original severity/confidence: Medium / High.
- Citations: `apps/web/playwright.config.ts:48-77`; `.github/workflows/quality.yml:75-80`; `apps/web/e2e/nav-visual-check.spec.ts:40-87`; `CLAUDE.md:708-721`.
- Reason for deferral: Playwright matrix/baseline expansion has runtime, artifact, masking, and flake tradeoffs. The scheduled nav/footer work may use targeted checks, but full browser-matrix policy is separate.
- Exit criterion: schedule when adding visual regression infrastructure, expanding e2e matrix, or changing mobile/Safari-sensitive flows.

### AGG-C36-12 - Hydration E2E uses `networkidle` as readiness oracle

- Original severity/confidence: Low-Medium / Medium.
- Citations: `apps/web/e2e/hydration-photo-page.spec.ts:20-50`; `apps/web/playwright.config.ts:59-67`.
- Reason for deferral: test reliability hardening requiring an app-owned client-ready marker and e2e semantics review. No current flake or product bug was observed.
- Exit criterion: schedule when editing hydration/photo-viewer e2e, adding client-ready markers, or seeing hydration-test flake.

### AGG-C36-13 - Operator sidecars rely mostly on source-contract tests

- Original severity/confidence: Medium / Medium-High.
- Citations: `apps/web/scripts/backfill-alt-text.ts:55-160`; `apps/web/scripts/backfill-cicp-recheck.ts:51-157`; `apps/web/src/__tests__/cycle-71-source-contracts.test.ts:34-53`; `apps/web/src/__tests__/cycle-11-source-contracts.test.ts:20-31`.
- Reason for deferral: behavioral runner extraction across operator scripts is larger than this cycle's scheduled fixes and no current sidecar bug was confirmed.
- Exit criterion: schedule when editing those sidecar scripts, adding injectable runners, or addressing operator-script reliability.

### AGG-C36-14 - Map route loads and hydrates up to 10,000 markers/list items

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/data.ts:1766-1816`; `apps/web/src/app/[locale]/(public)/map/page.tsx:13-111`; `apps/web/src/components/map/map-client.tsx:78-142`.
- Reason for deferral: map clustering/bbox API and accessible list virtualization are product/architecture work touching data contracts, public UX, and tests. No current correctness or privacy issue was confirmed.
- Exit criterion: schedule during map performance work, when gallery marker counts approach the cap, or when adding bbox/clustered map loading.

### AGG-C36-15 - Public image projection ownership is hand-mirrored

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/data.ts:368-475`; `apps/web/src/lib/data-timeline.ts:17-80`.
- Reason for deferral: architectural refactor of public projection helpers with broad data-layer test impact. The current sensitive-field guard prevents privacy leakage; this finding is about drift/maintainability.
- Exit criterion: schedule when adding/removing public image fields, changing timeline/year/on-this-day projections, or extracting shared public projection helpers.

### AGG-C36-18b - Future RTL and product-copy affordances are not fully ready

- Original severity/confidence: Low / Medium-High.
- Citations: `apps/web/src/app/[locale]/layout.tsx:101-107`; `apps/web/src/components/nav-client.tsx:100-180`; `apps/web/src/components/footer.tsx:42-44`; `apps/web/messages/en.json:824-840`; `apps/web/src/components/search.tsx:380-397`.
- Reason for deferral: the cycle schedules the search-label overlap in WP2. Remaining RTL and "GalleryKit" product-copy decisions are future-locale/product-positioning work; current shipped locales are EN/KO, both LTR.
- Exit criterion: schedule before adding any RTL locale, when changing footer product attribution, or during product-copy/portfolio-about IA work.

## Scheduled Elsewhere In This Cycle

- `AGG-C36-04` is scheduled in `plan.md` WP1.
- `AGG-C36-16` is scheduled in `plan.md` WP2.
- `AGG-C36-17` is scheduled in `plan.md` WP3.
- `AGG-C36-19` is scheduled in `plan.md` WP4.

## Carry-Forward Note

Earlier deferred findings remain in their authoritative home registers and `.context/plans/deferred-carry-forward.md`. Cycle 36 repeats only findings produced or re-raised by Cycle 36 reviews. Medium items deferred here must be re-justified or reclassified if they cross the 16-cycle checkpoint defined in `.context/plans/README.md`; the High item must be revisited under the 8-cycle age budget if it remains unchanged.
