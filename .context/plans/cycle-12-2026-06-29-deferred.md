# Cycle 12/100 Deferred Findings

Date: 2026-06-29
Source: `.context/reviews/_aggregate.md`
Status: TODO / deferred

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, committed `.context` plan/review history, and `docs/superpowers/**`. No `.cursorrules` or `CONTRIBUTING.md` files exist in this repo.

Security, correctness, privacy, and data-loss findings are not deferred here unless the finding is explicitly a non-live risk or the repo's own rules allow the current topology. Deferred work remains bound by repo policy: signed Conventional Commit + gitmoji commits, no `--no-verify`, no force-push, current toolchain requirements, and required gates.

## Deferred Items

### C12-GW01 - Local build emits homepage-only sitemap fallback when MySQL is unavailable

- Gate: `npm run build --workspace=apps/web`.
- File+line: `apps/web/src/app/sitemap.ts` database-backed topic lookup; build log shows `connect ECONNREFUSED 127.0.0.1:3306`.
- Original severity/confidence: Warning / High.
- Reason for deferral: The production build completed successfully and the sitemap route intentionally falls back when the local build environment has no MySQL listener. This is an environment warning, not a code failure in the final tree.
- Exit criterion: Re-open if CI/prod builds run with an expected database and still fall back, or if the sitemap fallback starts failing the build.

### C12-D01 - Admin dashboard loads every permanently failed image in one query/render

- Aggregate finding: AGG-C12-06.
- File+line: `apps/web/src/lib/data.ts:1000`; admin dashboard failed-image surfaces under `apps/web/src/app/[locale]/admin/`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Performance/operability improvement, not a confirmed correctness or privacy failure. Requires admin pagination UX and data-access changes beyond the non-deferrable fixes scheduled this cycle.
- Exit criterion: Re-open if failed-image counts grow enough to make the admin dashboard slow, or before redesigning the failed-image admin surface.

### C12-D02 - Per-photo OG generation lacks conditional validation before expensive work

- Aggregate finding: AGG-C12-07.
- File+line: `apps/web/src/app/api/og/photo/[id]/route.tsx:38`, `apps/web/src/app/api/og/photo/[id]/route.tsx:227`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Performance optimization; current route is functionally correct and bounded by existing OG byte/time limits.
- Exit criterion: Re-open if crawler traffic causes CPU pressure or when touching OG caching/ETag behavior.

### C12-D03 - Image queue can starve the shared MySQL pool while Sharp work holds advisory-lock connections

- Aggregate finding: AGG-C12-08.
- File+line: `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/process-image.ts`, `apps/web/src/db/index.ts`.
- Original severity/confidence: Medium / High.
- Repo rule permitting deferral: `CLAUDE.md` "Runtime topology" documents a single web-instance / single-writer topology and warns not to horizontally scale until coordination state moves to a shared store.
- Reason for deferral: Requires queue/lock/pool architecture work. Current production uses the documented single-instance topology, and this cycle schedules direct request-boundary/security defects first.
- Exit criterion: Re-open before increasing `QUEUE_CONCURRENCY`, changing advisory-lock connection lifetimes, or scaling the web process.

### C12-D04 - GPS stripping materializes whole originals in memory

- Aggregate finding: AGG-C12-09.
- File+line: `apps/web/src/lib/gps-exif-strip.ts`, `apps/web/src/app/actions/images.ts`, `apps/web/src/app/api/admin/lr/upload/route.ts`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Memory-pressure risk, not a confirmed GPS privacy leak. Streaming/container-aware metadata rewriting is larger than this cycle's request-boundary fixes.
- Exit criterion: Re-open before raising upload limits, changing GPS stripping implementation, or if large GPS-stripped uploads cause RSS/GC failures.

### C12-D05 - CLIP inference admits an unbounded waiter queue

- Aggregate finding: AGG-C12-10.
- File+line: `apps/web/src/lib/clip-model.ts`, `apps/web/src/app/api/search/semantic/route.ts`.
- Original severity/confidence: Medium / Medium-High.
- Reason for deferral: Requires a queue/backpressure/timeout design for model inference. This cycle schedules the simpler semantic request-body boundary defect first.
- Exit criterion: Re-open before increasing semantic-search exposure, if inference latency/backlog grows, or when adding CLIP queue metrics.

### C12-D06 - Infinite gallery accumulates every loaded card and image element

- Aggregate finding: AGG-C12-11.
- File+line: `apps/web/src/components/masonry-gallery.tsx`; public gallery pages.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires virtualization/windowing design for CSS masonry and careful visual regression coverage. No current gate failure or production jank trace was produced.
- Exit criterion: Re-open if large-gallery browser traces show scroll jank/memory pressure or loaded card counts routinely reach thousands.

### C12-D07 - Semantic/similar search remains a bounded brute-force scan

- Aggregate finding: AGG-C12-12.
- File+line: `apps/web/src/app/api/search/semantic/route.ts`, `apps/web/src/app/api/search/similar/[id]/route.ts`, `README.md`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: The runtime scan cap is an intentional scale tradeoff; this cycle schedules product-copy clarification so user claims match the implementation.
- Exit criterion: Re-open when active embeddings exceed `SEMANTIC_SCAN_LIMIT`, before adopting vector indexing, or if semantic recall complaints appear.

### C12-D08 - Timeline and smart/search predicates retain non-sargable scan paths

- Aggregate finding: AGG-C12-13.
- File+line: `apps/web/src/lib/smart-collections.ts`, `apps/web/src/lib/data.ts`, `apps/web/src/app/actions/public.ts`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: Scale/performance risk requiring query-plan work, generated columns, indexes, or materialization. No confirmed current failure.
- Exit criterion: Re-open before promoting smart/timeline search at large scale or when query plans show scans/temp-table pressure.

### C12-D09 - Resolved-path stream tests overstate TOCTOU protection

- Aggregate finding: AGG-C12-18.
- File+line: resolved-path stream helper tests/comments.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Documentation precision issue in tests; no direct exploit path or product behavior failure identified.
- Exit criterion: Re-open when editing the resolved-path streaming helper or related traversal/symlink tests.

### C12-D10 - Failed image retry recovery is mostly source-text tested

- Aggregate finding: AGG-C12-20.
- File+line: `apps/web/src/app/actions/images.ts:1163`, `apps/web/src/__tests__/failed-image-retry.test.ts`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Test-quality improvement. Current retry behavior has existing source-contract coverage and no confirmed runtime regression in this cycle.
- Exit criterion: Re-open before refactoring failed-image retry, queue enqueue state, or persisted retry fields.

### C12-D11 - Navigation visual check records screenshots but does not assert them

- Aggregate finding: AGG-C12-21.
- File+line: visual/navigation test artifacts under `apps/web/e2e` or related screenshot scripts.
- Original severity/confidence: Medium / High.
- Reason for deferral: Visual-regression infrastructure work requiring baseline ownership and stabilization. Not a confirmed product runtime defect.
- Exit criterion: Re-open when adding visual baselines or if nav visual regressions escape existing DOM/touch/overlap tests.

### C12-D12 - Production CLIP semantic-search coverage is skipped in default CI

- Aggregate finding: AGG-C12-22.
- File+line: `apps/web/src/__tests__/clip-semantic-integration.test.ts`, `apps/web/src/__tests__/clip-offline-load.test.ts`, CI workflow files if present.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires model-weight caching or scheduled CI resources. Not suitable for every local cycle gate.
- Exit criterion: Re-open before CLIP dependency/model-path changes or semantic production rollout changes.

### C12-D13 - Public route rate-limit scanner ignores expensive GET handlers

- Aggregate finding: AGG-C12-23.
- File+line: `apps/web/scripts/check-public-route-rate-limit.mjs`, `apps/web/src/app/api/og/**`, other public GET API routes.
- Original severity/confidence: Medium / High.
- Reason for deferral: Gate-design improvement. Existing GET routes are manually bounded/reviewed, and this cycle schedules concrete request-size and cache/privacy defects first.
- Exit criterion: Re-open when adding new expensive public GET routes or revising public route lint policy.

### C12-D14 - Sitemap and robots metadata routes lack route-level regression tests

- Aggregate finding: AGG-C12-24.
- File+line: `apps/web/src/app/sitemap.ts`, `apps/web/src/app/robots.ts`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: SEO route coverage improvement, not a confirmed runtime defect.
- Exit criterion: Re-open when modifying sitemap/robots fallback, localized URLs, feed entries, or canonical base handling.

### C12-D15 - No coverage report or threshold gate exists

- Aggregate finding: AGG-C12-25.
- File+line: `apps/web/package.json`, Vitest config/test scripts.
- Original severity/confidence: Low / High.
- Reason for deferral: Test-infrastructure project; thresholds require calibration to avoid noisy gates unrelated to this cycle.
- Exit criterion: Re-open during coverage-infrastructure work or when changing critical modules without behavior coverage.

### C12-D16 - Restore and queue safety depend on documented single web-process topology

- Aggregate finding: AGG-C12-28.
- File+line: `apps/web/docker-compose.yml`, `apps/web/src/lib/image-queue.ts`, `apps/web/src/lib/restore-maintenance.ts`, `CLAUDE.md:227`.
- Original severity/confidence: Medium / Medium-High.
- Repo rule permitting deferral: `CLAUDE.md` "Runtime topology" documents the shipped deployment as a single web-instance / single-writer topology and explicitly says not to horizontally scale until those coordination states move to shared storage.
- Reason for deferral: The current deployment follows the repo's explicit topology. Shared-state migration or hard scale-out guardrails are a separate architecture project.
- Exit criterion: Re-open before horizontal scaling, multi-instance deployment, or multi-tenant MySQL co-location.

### C12-D17 - Browser and Lightroom upload paths duplicate ingest transaction boundaries

- Aggregate finding: AGG-C12-30.
- File+line: `apps/web/src/app/actions/images.ts:114`, `apps/web/src/app/api/admin/lr/upload/route.ts:62`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Broad refactor. This cycle schedules concrete LR boundary and copy fixes while preserving the existing duplicated contracts.
- Exit criterion: Re-open before adding a new ingest invariant, processing setting, privacy scrub, or third ingest path.

### C12-D18 - Quarantined local storage backend still maps `original/` under public upload root

- Aggregate finding: AGG-C12-31.
- File+line: `apps/web/src/lib/storage/local.ts:130`, `apps/web/src/lib/upload-paths.ts:25`, `CLAUDE.md`.
- Original severity/confidence: Medium / High.
- Repo rule permitting deferral: `CLAUDE.md` "Storage Backend (Not Yet Integrated)" says the storage module exists as an internal abstraction, but the product currently supports local filesystem storage only and must not expose S3/MinIO switching until the upload/processing/serving pipeline is wired end-to-end.
- Reason for deferral: Confirmed design mismatch in quarantined non-live code. Fix before integration, not as an unrelated storage rewrite this cycle.
- Exit criterion: Re-open before relaxing the storage quarantine, integrating `@/lib/storage`, or adding any non-local backend.

### C12-D19 - Mobile info sheet likely overstates modality in peek state

- Aggregate finding: AGG-C12-38.
- File+line: `apps/web/src/components/photo-viewer.tsx`, mobile info sheet/dialog components.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Likely UX/accessibility issue requiring interactive mobile sheet design and browser validation. This cycle schedules the confirmed landmark accessibility defect first.
- Exit criterion: Re-open before revising the mobile info sheet, when adding mobile sheet E2E coverage, or if screen-reader/focus bugs are reported.
