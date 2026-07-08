# Run-10 Cycle 35/100 Deferred Findings

Status: OPEN
Aggregate: `.context/reviews/_aggregate.md`
Date: 2026-07-08 KST

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, `.context/plans/run10-cycle34/{plan,deferred}.md`, README files, docs under `docs/superpowers/`, and Cycle 35 review artifacts. No confirmed security, correctness, or data-loss finding is deferred here; `C35-07` is scheduled in `plan.md`.

## Deferred Items

### C35-01 - Shared background DB/CPU capacity is not enforced across subsystems

- Original severity/confidence: High / High.
- Citations: `apps/web/src/db/index.ts:31-42`; `apps/web/src/lib/image-queue.ts:121-153`; `apps/web/src/lib/admin-backfill-runner.ts:97-143`; `apps/web/src/lib/background-db-writes.ts:8-75`; `.context/reviews/perf-reviewer.md:99-123`; `.context/reviews/architect.md:52-78`.
- Reason for deferral: broad resource-governor architecture across foreground traffic, image queue, color backfill, semantic work, maintenance, and analytics. This cycle schedules the contained correctness and docs/test fixes first; no data-loss or security issue was confirmed.
- Exit criterion: schedule when implementing a shared background resource coordinator, changing pool/concurrency formulas, adding DB pool observability, or seeing production pool queue-limit/timeout evidence.

### C35-02 - Color sidecar can exceed live DB/CPU admission controls

- Original severity/confidence: Medium / High.
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:416-420`; `apps/web/scripts/backfill-color-pipeline.ts:557-623`; `apps/web/src/lib/process-image.ts:36-57`; `.context/reviews/perf-reviewer.md:125-145`.
- Reason for deferral: operator-sidecar admission policy overlaps with the broader capacity-governor work in `C35-01`; changing it safely needs an explicit live-traffic-safe maintenance policy.
- Exit criterion: schedule when touching color sidecar concurrency, adding maintenance/admission locks, or documenting/enforcing live-traffic-safe sidecar mode.

### C35-03 - Service-worker cached images can still block on synchronous HEAD probes

- Original severity/confidence: Medium / High.
- Citations: `apps/web/public/sw.template.js:31-39`; `apps/web/public/sw.template.js:350-438`; `.context/reviews/perf-reviewer.md:147-167`.
- Reason for deferral: performance policy tradeoff between immediate cached paint and the existing freshness contract after derivative/settings changes. No correctness break was confirmed in this cycle.
- Exit criterion: schedule when modifying service-worker image cache freshness, adding derivative-version manifests, or measuring warm-gallery LCP/INP regressions caused by HEAD probes.

### C35-04 - Photo/share viewer initial bundle includes optional panels

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/components/photo-viewer.tsx:15-29`; `apps/web/src/components/photo-viewer.tsx:807-956`; `.context/reviews/perf-reviewer.md:169-191`.
- Reason for deferral: component-splitting and route-bundle measurement work can touch lightbox, histogram, color details, similar photos, and hydration behavior. This cycle does not otherwise refactor viewer architecture.
- Exit criterion: schedule when optimizing route bundles, editing photo/share viewer optional panels, or setting bundle-size budgets.

### C35-05 - Semantic embedding work has multiple active owners

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/lib/image-queue.ts:501-637`; `apps/web/scripts/backfill-clip-embeddings.ts:114-130`; `apps/web/src/app/actions/embeddings.ts:113-131`; `apps/web/src/lib/clip-model.ts:53-173`; `.context/reviews/architect.md:30-50`.
- Reason for deferral: resource-ownership design work across live bootstrap, admin action, and sidecar. The DB upsert converges, and no corruption/data-loss finding was confirmed.
- Exit criterion: schedule when changing semantic activation/backfill ownership, CLIP model-version handling, or production semantic-search automation.

### C35-06 - Color sidecar batching weakens per-image claim ownership

- Original severity/confidence: Low / Medium.
- Citations: `apps/web/scripts/backfill-color-pipeline.ts:471-527`; `apps/web/scripts/backfill-color-pipeline.ts:557-603`; `.context/reviews/architect.md:101-120`.
- Reason for deferral: low-severity invariant hardening after Cycle 34 already added sidecar per-image locks. The current global color-backfill lock and processed-row filter reduce current corruption risk.
- Exit criterion: schedule when modifying color sidecar batching, adding another processed-row writer, or strengthening per-image lock ownership tests.

### C35-11 - Mobile masonry metadata overlays permanently cover photos

- Original severity/confidence: Low-Medium / High.
- Citations: `apps/web/src/components/masonry-card.tsx:155-166`; `.context/reviews/designer.md:56-74`.
- Reason for deferral: public gallery visual-layout change requires photographer/design validation across seeded and real mobile galleries. It is not a correctness, security, or data-loss issue.
- Exit criterion: schedule during mobile gallery design work, if photographer feedback confirms overlay obstruction, or when changing masonry-card metadata display.

### C35-12 - SEO settings mark every field invalid for one field error

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/app/[locale]/admin/(protected)/seo/seo-client.tsx:75-209`; `apps/web/src/app/actions/seo.ts:85-139`; `.context/reviews/designer.md:76-94`.
- Reason for deferral: authenticated admin form redesign requiring structured server-action field errors and browser-flow validation. No data corruption or auth/security issue was confirmed.
- Exit criterion: schedule when editing SEO settings validation, introducing structured action errors, or running an authenticated admin accessibility pass.

### C35-13 - Public photo/search surfaces expose visible shortcut tutorial copy

- Original severity/confidence: Low / High.
- Citations: `apps/web/src/components/photo-viewer.tsx:580-585`; `apps/web/src/components/search.tsx:524-530`; `.context/reviews/designer.md:96-114`.
- Reason for deferral: low-severity copy/UX polish with possible discoverability tradeoff; scheduled work already touches search ARIA but not the broader public-help pattern.
- Exit criterion: schedule when revising public photo/search help affordances or adding tooltip/help-menu discovery for shortcuts.

### C35-15 - Checked-in Atik site config can brand fresh self-hosted builds

- Original severity/confidence: Medium / High.
- Citations: `apps/web/src/site-config.json:2-10`; `apps/web/scripts/ensure-site-config.mjs:4-42`; `README.md`; `apps/web/README.md`; `.context/reviews/product-marketer-reviewer.md:108-136`.
- Reason for deferral: product/distribution decision. This invocation explicitly targets the configured `gallery.atik.kr` deployment, and `CLAUDE.md` documents build-time-inlined file-backed defaults. Replacing/rejecting the tracked Atik config could affect the active deployment without an explicit release-packaging decision.
- Exit criterion: schedule when preparing public distribution packaging, changing static config policy, or deciding to require an explicit allow flag for deployment-specific `site-config.json`.

### C35-16 - No coverage metric or ratchet exists for high-risk code

- Original severity/confidence: Medium / High.
- Citations: `package.json:17-30`; `apps/web/package.json:8-30`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-83`; `.context/reviews/test-engineer.md:26-35`.
- Reason for deferral: broad CI/test-infra program. Adding coverage ratchets should start as non-blocking and be calibrated to avoid noisy source-contract coverage inflation.
- Exit criterion: schedule during test-infra hardening or when CI policy is ready to introduce coverage reporting/ratchets.

### C35-18 - Nav visual e2e captures screenshots without comparing them

- Original severity/confidence: Medium / High.
- Citations: `apps/web/e2e/nav-visual-check.spec.ts:40-86`; `apps/web/playwright.config.ts:63-77`; `.context/reviews/test-engineer.md:48-57`.
- Reason for deferral: visual baseline introduction has stability/storage implications and needs masking strategy. No product bug was observed.
- Exit criterion: schedule when adding visual regression infrastructure or changing nav/mobile panel layout.

### C35-19 - Production CLIP proof is outside PR/push gates

- Original severity/confidence: Medium / High.
- Citations: `apps/web/package.json:21-23`; `.github/workflows/quality.yml:69-83`; `.github/workflows/clip-preflight.yml:3-46`; `apps/web/src/__tests__/clip-offline-load.test.ts:32-41`; `.context/reviews/test-engineer.md:59-68`; `.context/reviews/verifier.md:92-120`.
- Reason for deferral: CI policy and model-weight availability decision. Normal unit gates intentionally skip real CLIP weights; production activation remains operator-gated.
- Exit criterion: schedule when CLIP/model/semantic-production files change, when model weights are available to CI, or when requiring path-filtered CLIP preflight checks.

### C35-20 - Sidecar backfill scripts have mostly indirect/source coverage

- Original severity/confidence: Medium / Medium-High.
- Citations: `apps/web/scripts/backfill-alt-text.ts:55-160`; `apps/web/scripts/backfill-cicp-recheck.ts:51-157`; `.context/reviews/test-engineer.md:70-79`.
- Reason for deferral: behavioral runner extraction across operator scripts is larger than this cycle's scheduled fixes and does not correspond to a confirmed product bug.
- Exit criterion: schedule when editing sidecar scripts, adding injectable runners, or addressing operator-script reliability.

### C35-21 - Migration reconcile tests are not structural validation

- Original severity/confidence: Medium / Medium.
- Citations: `apps/web/src/__tests__/migrate-reconcile-coverage.test.ts:13-226`; `.context/reviews/test-engineer.md:81-90`.
- Reason for deferral: disposable MySQL structural-diff tests require heavier integration setup and high-risk table metadata modeling. Existing source tripwires remain active.
- Exit criterion: schedule when adding migrations/reconcile logic, improving database integration tests, or seeing schema drift despite current tripwires.

### C35-22 - Hydration e2e uses `networkidle` as hydration oracle

- Original severity/confidence: Low-Medium / Medium.
- Citations: `apps/web/e2e/hydration-photo-page.spec.ts:20-49`; `.context/reviews/test-engineer.md:92-101`.
- Reason for deferral: test reliability hardening that requires adding an app-level client-ready marker and reevaluating e2e semantics. No current flake or product bug was observed.
- Exit criterion: schedule when editing hydration/photo-viewer e2e, adding client-ready markers, or seeing hydration-test flake.

### C35-23 - Browser-flow matrix is single-project Desktop Chromium

- Original severity/confidence: Medium / High.
- Citations: `apps/web/playwright.config.ts:48-77`; `.github/workflows/quality.yml:75-80`; `.context/reviews/test-engineer.md:103-112`.
- Reason for deferral: CI matrix expansion has runtime/cost/flakiness tradeoffs and may require admin spec isolation. No browser-specific product regression was confirmed.
- Exit criterion: schedule during e2e infrastructure expansion, mobile WebKit/Chromium work, or display-capability regression work.

### C35-24 - Public edge/proxy/upload operational proofs remain manual

- Original severity/confidence: Medium / High for nginx/proxy, Medium / Medium for upload RSS.
- Citations: `apps/web/nginx/default.conf:1-29`; `apps/web/nginx/default.conf:254-306`; `scripts/check-proxy-topology.mjs:7-16`; `CLAUDE.md:657-663`; `.context/reviews/verifier.md:69-140`; `.context/reviews/critic.md:70-120`; `.context/reviews/test-engineer.md:114-123`.
- Reason for deferral: live host nginx, real client-IP buckets, and large-upload RSS require operator/runtime evidence. The cycle will still perform the required non-destructive production `/api/live` and missing-upload 404 smokes after deploy.
- Exit criterion: schedule when operator credentials/context are available for active edge probes, when proxy topology changes, or when upload memory measurements become part of release acceptance.

## Carry-Forward Note

Earlier deferred findings remain in their authoritative home registers and `.context/plans/deferred-carry-forward.md`. Cycle 35 repeats only findings produced or re-raised by the Cycle 35 reviews. Medium items deferred here must be re-justified or reclassified if they cross the 16-cycle checkpoint defined in `.context/plans/README.md`.
