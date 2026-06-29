# Cycle 11/100 Deferred Findings

Date: 2026-06-29
Source: `.context/reviews/_aggregate.md`
Status: TODO / deferred

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, committed `.context` plan/review history, and `docs/superpowers/**`. No `.cursorrules` or `CONTRIBUTING.md` files exist in this repo.

Security, correctness, privacy, and data-loss findings are not deferred here unless a repo rule explicitly permits it. Deferred work remains bound by repo policy: signed Conventional Commit + gitmoji commits, no `--no-verify`, no force-push, current toolchain requirements, and required gates.

## Deferred Items

### C11-D01 - Image queue can starve the shared DB pool while holding locks across Sharp work

- File+line: `apps/web/src/lib/image-queue.ts:86-89`, `:440-456`, `:616-631`; `apps/web/src/db/index.ts:23-33`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires queue/lock architecture work or a dedicated lock pool. Current production is documented as a single web-instance/personal-gallery topology, and this cycle schedules the more direct unbounded embedding bootstrap and sidecar concurrency defects.
- Exit criterion: Re-open before raising `QUEUE_CONCURRENCY`, before scale-out, or if request latency/DB pool saturation appears during image processing.

### C11-D02 - GPS stripping reintroduces whole-file heap pressure

- File+line: `apps/web/src/lib/process-image.ts:887-910`, `:1738-1786`; `apps/web/src/app/actions/images.ts:381-388`; `apps/web/src/app/api/admin/lr/upload/route.ts:139-145`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires streaming/container-aware EXIF rewriting or a new memory budget policy. This is memory-pressure risk, not a confirmed public GPS leak; C11-11 fixes the public GPS disclosure copy.
- Exit criterion: Re-open before increasing upload limits, when adding streaming EXIF rewrite support, or if large GPS-stripped uploads cause RSS/GC failures.

### C11-D03 - CLIP inference has no global backlog cap or timeout

- File+line: `apps/web/src/lib/clip-model.ts:53-70`; `apps/web/src/app/api/search/semantic/route.ts:243-300`.
- Original severity/confidence: Medium / Medium-High.
- Reason for deferral: Requires a bounded global inference queue, timeout semantics, and operator observability. This cycle fixes bootstrap-side unbounded scheduling and pre-body semantic abort charging first.
- Exit criterion: Re-open before increasing semantic-search exposure, if inference latency/backlog grows, or when adding CLIP queue metrics.

### C11-D04 - Quarantined storage backend maps private originals under public upload root

- File+line: `apps/web/src/lib/storage/local.ts:14-20`, `:40-84`; `apps/web/src/lib/storage/types.ts:11-14`.
- Original severity/confidence: Medium / High.
- Repo rule permitting deferral: `CLAUDE.md` "Storage Backend (Not Yet Integrated)" says the module exists as an internal abstraction, local filesystem is the only supported product storage, and S3/MinIO switching must not be documented/exposed until the pipeline is wired end-to-end.
- Reason for deferral: The abstraction is quarantined and not live in the upload/processing/serving pipeline. Fix should happen before integration, not as an unrelated storage rewrite inside this cycle.
- Exit criterion: Re-open before relaxing the storage quarantine, integrating `@/lib/storage`, or adding any non-local storage backend.

### C11-D05 - Browser and Lightroom upload ingest logic is duplicated

- File+line: `apps/web/src/app/actions/images.ts:114-612`; `apps/web/src/app/api/admin/lr/upload/route.ts:62-531`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Full shared-ingest extraction is broad and high-risk. This cycle schedules related concrete correctness/copy fixes and keeps source/route contracts in place; a dedicated refactor should start with tests.
- Exit criterion: Re-open before adding a new ingest invariant, processing setting, privacy scrub, or third ingest path.

### C11-D06 - Semantic search recall is bounded to most-recent embeddings

- File+line: `apps/web/src/lib/clip-embeddings.ts:36-44`; `apps/web/src/app/api/search/semantic/route.ts:256-268`; `apps/web/src/app/api/search/similar/[id]/route.ts:141-150`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Product/scale tradeoff tied to the documented brute-force scan cap. Requires vector index, full paginated scan, or product disclosure work beyond this fix cycle.
- Exit criterion: Re-open when active embeddings exceed `SEMANTIC_SCAN_LIMIT`, when recall complaints appear, or before adopting vector indexing.

### C11-D07 - Dark in-app CLIP backfill can report success after one capped candidate set

- File+line: `apps/web/src/app/actions/embeddings.ts:79-80`, `:103-172`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: The action is currently unwired/dark and the sidecar remains the documented operator path. This cycle fixes runtime bootstrap missing-embedding boundedness.
- Exit criterion: Re-open before exposing the action in UI or relying on it as a complete operator workflow.

### C11-D08 - Correctness guards depend on single web-instance topology

- File+line: `apps/web/src/lib/restore-maintenance.ts:1-55`; `apps/web/src/lib/image-queue.ts:250-323`; `apps/web/src/lib/upload-tracker-state.ts:7-79`; `apps/web/src/app/actions/public.ts:323-341`.
- Original severity/confidence: Medium / High.
- Repo rule permitting deferral: `CLAUDE.md` "Runtime topology" documents a single web-instance / single-writer topology and warns not to horizontally scale until coordination state moves to a shared store.
- Reason for deferral: The current deployment follows the documented topology; shared-state migration is a scale-out project.
- Exit criterion: Re-open before horizontal scaling, multi-instance deployment, or multi-tenant MySQL co-location.

### C11-D09 - Upload tag records can be created before any image is accepted

- File+line: `apps/web/src/app/actions/images.ts:295-323`; `apps/web/src/lib/tag-records.ts:66-68`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Low-impact admin hygiene risk; zero-count tags are visible/manageable and do not create data loss, privacy leak, or public correctness failure.
- Exit criterion: Re-open when changing upload tag resolution, adding tag cleanup, or if admins report surprising zero-count tags from rejected uploads.

### C11-D10 - Infinite masonry keeps all loaded cards mounted

- File+line: `apps/web/src/components/home-client.tsx:124-130`, `:286-360`; `apps/web/src/components/load-more.tsx:41-132`.
- Original severity/confidence: Low-Medium / Medium-High.
- Reason for deferral: Requires virtualization/windowing design for CSS masonry. Current use is personal-gallery scale and no trace-backed jank regression is confirmed.
- Exit criterion: Re-open if large-gallery browser traces show scroll jank/memory pressure or if loaded cards routinely exceed thousands per session.

### C11-D11 - Public archive and smart-collection predicates can become CPU scan paths

- File+line: `apps/web/src/lib/data-timeline.ts:92-207`; `apps/web/src/lib/smart-collections.ts:217-266`; `apps/web/src/lib/data.ts:1437-1451`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: Scale/performance risk that requires generated columns, materialization, or search indexing. Current personal-gallery scale is accepted by existing comments.
- Exit criterion: Re-open before promoting broad public archives/smart collections at large scale, or when query plans show scans/temp-table pressure.

### C11-D12 - Playwright visual nav checks only write screenshots

- File+line: `apps/web/e2e/nav-visual-check.spec.ts:40-79`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Quality-gate improvement requiring visual baseline ownership and stabilization. Not a product runtime defect.
- Exit criterion: Re-open when adding visual regression baselines or if a nav visual regression escapes existing DOM/touch/overlap tests.

### C11-D13 - No coverage report/threshold gate exists

- File+line: `package.json:11-22`; `apps/web/package.json:8-26`; `apps/web/vitest.config.ts:16-39`; `.github/workflows/quality.yml:54-80`.
- Original severity/confidence: Low / High.
- Reason for deferral: Test-infrastructure project; thresholds need calibration to avoid noisy gates unrelated to this cycle.
- Exit criterion: Re-open during coverage-infrastructure work or when changing critical security/privacy/upload/migration surfaces without behavior coverage.

### C11-D14 - Lightroom upload route lacks behavior tests

- File+line: `apps/web/src/app/api/admin/lr/upload/route.ts:62-531`; `apps/web/src/__tests__/lr-upload-hdr-gate.test.ts`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Valuable but large mocking surface. This cycle keeps LR source contracts and schedules higher-risk runtime defects first.
- Exit criterion: Re-open before refactoring LR upload, extracting ingest service, or adding new LR-specific behavior.

### C11-D15 - `backfillClipEmbeddings` action has only source-order coverage

- File+line: `apps/web/src/app/actions/embeddings.ts:55-180`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: The action is currently unwired; C11-D07 covers its completion semantics.
- Exit criterion: Re-open before UI wiring or when changing embedding backfill behavior.

### C11-D16 - Atom feed route behavior lacks route-level tests

- File+line: `apps/web/src/app/feed.xml/route.ts:29-166`; `apps/web/src/app/[locale]/(public)/[topic]/feed.xml/route.ts:28-165`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Helper-level tests cover feed composition/conditional logic; this is route wiring coverage, not a confirmed runtime bug. C11-10 fixes the stale author comments.
- Exit criterion: Re-open when modifying feed route headers/status/link behavior.

### C11-D17 - Production CLIP/offline tests are gated out of default CI

- File+line: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`; `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`; `.github/workflows/quality.yml:27-80`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires model-weight caching and scheduled/label-triggered CI resources; not suitable for every local cycle gate.
- Exit criterion: Re-open before CLIP dependency/model-path changes or semantic production rollout changes.

### C11-D18 - Browser E2E is Chromium-only

- File+line: `apps/web/playwright.config.ts:72-77`; `.github/workflows/quality.yml:72-74`.
- Original severity/confidence: Low / High.
- Reason for deferral: Cross-browser CI adds runtime and environment cost. No browser-specific confirmed defect is tied to this finding in Cycle 11.
- Exit criterion: Re-open before browser-specific color/HDR/UI releases or when adding scheduled WebKit/Firefox smoke jobs.
