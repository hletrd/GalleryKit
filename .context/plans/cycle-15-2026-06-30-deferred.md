# Cycle 15/100 Deferred Findings

Date: 2026-06-30 KST
Status: OPEN

Repo rules reviewed before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, current `.context` review/plan history. These deferrals do not alter repo policies for future work: commits remain GPG-signed Conventional Commits with gitmoji, pushes require `git pull --rebase`, and all quality gates remain blocking.

## Deferred Items

### C15-D01 - Checked-in demo canonical URL can become self-hosted deploy identity

- Finding: AGG-C15-13
- Citation: `README.md:8`, `README.md:148`, `apps/web/src/site-config.json:4`, `apps/web/scripts/ensure-site-config.mjs:12-40`
- Original severity/confidence: High / High
- Reason for deferral: The orchestrator explicitly selected the live `gallery.atik.kr` deployment target for this workspace, and this cycle must deploy to that target. Replacing or rejecting the checked-in `gallery.atik.kr` config could break the requested per-cycle deploy path. This is product-packaging/configuration risk, not a security, correctness, or data-loss defect in the current target.
- Re-open criterion: Re-open before publishing generic self-hosted distribution artifacts, changing deploy identity handling, or if `BASE_URL` is not guaranteed in a non-`gallery.atik.kr` production deployment.

### C15-D02 - Fresh-gallery empty state is not operational

- Finding: AGG-C15-20
- Citation: `apps/web/src/components/home-client.tsx:424-440`
- Original severity/confidence: Low / High
- Reason for deferral: Low-severity UX polish; adding owner-only empty-state behavior requires authenticated public-shell state design and is outside the correctness/gate fixes selected for this cycle.
- Re-open criterion: Re-open when first-run/onboarding UX is planned or when public shell already has safe admin-session awareness.

### C15-D03 - Photo-page swipe navigation is attached globally to `window`

- Finding: AGG-C15-21
- Citation: `apps/web/src/components/photo-navigation.tsx:43-60`, `apps/web/src/components/photo-navigation.tsx:96-133`, `apps/web/src/components/photo-viewer.tsx:688-695`
- Original severity/confidence: Medium / High
- Reason for deferral: Requires interaction design and browser/touch regression coverage across image, metadata, bottom sheet, browser-edge gestures, and lightbox states. Not security, data loss, or server correctness.
- Re-open criterion: Re-open with a mobile touch-e2e task or if users report accidental photo navigation while interacting outside the media surface.

### C15-D04 - Public-route browser validation blocked by local DB/schema failures

- Finding: AGG-C15-22
- Citation: `apps/web/src/app/[locale]/(public)/page.tsx:149-166`, `apps/web/src/app/[locale]/(public)/page.tsx:221-223`
- Original severity/confidence: Medium review risk / High
- Reason for deferral: Validation-environment gap. This cycle still runs the required repo gates; seeded browser fixture design is broader test infrastructure work.
- Re-open criterion: Re-open before relying on browser-based public UI review as a release gate or when adding deterministic public fixture mode.

### C15-D05 - Public map can serialize and render up to 10k markers and links

- Finding: AGG-C15-23
- Citation: `apps/web/src/lib/data.ts:1640-1676`, `apps/web/src/app/[locale]/(public)/map/page.tsx:31-79`, `apps/web/src/components/map/map-client.tsx:76-143`
- Original severity/confidence: High / High
- Reason for deferral: Recurring scale/performance architecture item requiring API shape, marker clustering/bounds design, DB indexes, and production-like `EXPLAIN` evidence. This is not data loss or auth/security.
- Re-open criterion: Re-open when GPS-enabled public galleries approach the current cap, when map performance is measured as poor, or when map API/index work is scheduled.

### C15-D06 - Aborted semantic searches still occupy CLIP inference and scoring

- Finding: AGG-C15-24
- Citation: `apps/web/src/components/search.tsx:181-190`, `apps/web/src/app/api/search/semantic/route.ts:248-305`, `apps/web/src/lib/clip-model.ts:53-160`
- Original severity/confidence: Medium / High
- Reason for deferral: Requires API changes through the CLIP inference slot, model invocation, queue cancellation, and scoring loop behavior. Not a current correctness/security/data-loss failure.
- Re-open criterion: Re-open when tuning semantic latency/resource use, increasing `SEMANTIC_SCAN_LIMIT`, or observing stale CLIP inference pressure.

### C15-D07 - Upload-processing contract lock pins a DB connection across slow work

- Finding: AGG-C15-25
- Citation: `apps/web/src/lib/upload-processing-contract-lock.ts:9-55`, `apps/web/src/app/actions/images.ts:175-613`, `apps/web/src/app/api/admin/lr/upload/route.ts:240-545`
- Original severity/confidence: Medium / High
- Reason for deferral: Concurrency architecture change touching upload correctness invariants, settings writes, and restore locks. Needs separate design and regression suite.
- Re-open criterion: Re-open when upload/admin contention is observed or when redesigning upload-processing settings locks.

### C15-D08 - Image queue can pin most of the shared DB pool during Sharp work

- Finding: AGG-C15-26
- Citation: `apps/web/src/db/index.ts:23-33`, `apps/web/src/lib/image-queue.ts:87-90`, `apps/web/src/lib/image-queue.ts:446-657`, `apps/web/src/lib/image-queue.ts:812-815`
- Original severity/confidence: Medium / High
- Reason for deferral: Requires lease/claim redesign or dedicated lock-pool work; current default queue concurrency remains conservative.
- Re-open criterion: Re-open before raising `QUEUE_CONCURRENCY`, after pool saturation evidence, or when reworking queue claims.

### C15-D09 - GPS stripping re-materializes whole originals after streaming save

- Finding: AGG-C15-27
- Citation: `apps/web/src/lib/process-image.ts:887-910`, `apps/web/src/lib/process-image.ts:1738-1786`
- Original severity/confidence: Medium / High
- Reason for deferral: Memory/performance improvement requiring semaphore or streaming scrubber evaluation and large-file fixture validation.
- Re-open criterion: Re-open when upload OOM/GC pressure is observed, when upload size limits change, or when GPS stripping becomes default/high-volume.

### C15-D10 - Public view analytics can consume DB pool/write capacity on every page view

- Finding: AGG-C15-28
- Citation: `apps/web/src/app/actions/public.ts:324-451`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Requires analytics batching/deduplication semantics and possibly DB schema or operational tradeoffs. No current gate or correctness failure.
- Re-open criterion: Re-open with traffic evidence, before scaling analytics, or when introducing shared/edge rate limits.

### C15-D11 - Sidecar backfill scripts materialize and enqueue the full candidate set

- Finding: AGG-C15-29
- Citation: `apps/web/scripts/backfill-color-pipeline.ts:342-357`, `apps/web/scripts/backfill-color-pipeline.ts:474-511`, `apps/web/scripts/backfill-cicp-recheck.ts:57-93`
- Original severity/confidence: Medium / High
- Reason for deferral: Sidecar performance improvement; not part of normal live request correctness and needs script-level batch refactor.
- Re-open criterion: Re-open before running sidecar backfills on very large libraries or when memory growth is observed.

### C15-D12 - Publication-time feed ordering lacks matching indexes

- Finding: AGG-C15-30
- Citation: `apps/web/src/lib/data.ts:828-853`, `apps/web/src/db/schema.ts:114-120`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Requires migration and production-like `EXPLAIN` validation to avoid adding unproven indexes.
- Re-open criterion: Re-open when feed query performance is measured, when large galleries are targeted, or during planned index tuning.

### C15-D13 - Dynamic first listing pages still do count-window work on hot requests

- Finding: AGG-C15-31
- Citation: `apps/web/src/lib/data.ts:878-907`, `apps/web/src/lib/data.ts:1438-1453`, `CLAUDE.md:400`
- Original severity/confidence: Medium / Medium
- Reason for deferral: Product/API tradeoff around exact counts versus hot-path speed; needs UX and data-layer design.
- Re-open criterion: Re-open with slow-query evidence or when redesigning pagination/count display.

### C15-D14 - Admin failed-image recovery can become unbounded and unindexed

- Finding: AGG-C15-32
- Citation: `apps/web/src/lib/data.ts:999-1013`, `apps/web/src/db/schema.ts:114-120`
- Original severity/confidence: Medium / High
- Reason for deferral: Requires pagination UI plus migration-backed index work. Performance/recovery UX issue, not data-loss or auth/security.
- Re-open criterion: Re-open before large import/retry workflows or if failed-image counts grow beyond a dashboard-safe size.

### C15-D15 - Batch delete repeats derivative-directory scans per image and format

- Finding: AGG-C15-33
- Citation: `apps/web/src/lib/process-image.ts:586-643`, `apps/web/src/app/actions/images.ts:688-698`, `apps/web/src/app/actions/images.ts:807-845`
- Original severity/confidence: Medium / High
- Reason for deferral: Admin I/O performance refactor with filesystem failure aggregation semantics. Not a security/correctness/data-loss bug in ordinary delete volume.
- Re-open criterion: Re-open for high-volume batch deletion work or if deletion latency becomes operationally significant.

### C15-D16 - Production semantic search silently searches newest capped embedding window

- Finding: AGG-C15-34
- Citation: `apps/web/src/lib/clip-embeddings.ts:36-44`, `apps/web/src/app/api/search/semantic/route.ts:261-273`, `apps/web/src/components/search.tsx:460-494`
- Original severity/confidence: Medium / High
- Reason for deferral: Product honesty/vector-search architecture item. Fix requires route metadata/UI copy or full vector index design.
- Re-open criterion: Re-open when embedded corpus exceeds the scan limit in production, when changing semantic UX, or when implementing vector index support.

### C15-D17 - Real CLIP/offline-load tests are skipped by default

- Finding: AGG-C15-35
- Citation: `apps/web/src/__tests__/clip-semantic-integration.test.ts:8-31`, `apps/web/src/__tests__/clip-offline-load.test.ts:15-41`
- Original severity/confidence: Medium / High
- Reason for deferral: CI/workflow/model-cache task requiring external weights/cache policy and possibly longer-running jobs. Not deferrable as code correctness, but acceptable as validation-infrastructure risk.
- Re-open criterion: Re-open before dependency/model upgrades touching CLIP, before requiring semantic-search release validation, or when scheduled CI capacity is available.

### C15-D18 - Nav visual e2e tests save screenshots but do not compare them

- Finding: AGG-C15-36
- Citation: `apps/web/e2e/nav-visual-check.spec.ts:51`, `apps/web/e2e/nav-visual-check.spec.ts:65`, `apps/web/e2e/nav-visual-check.spec.ts:78`
- Original severity/confidence: Low / High
- Reason for deferral: Visual-baseline work requires baseline artifact policy and anti-flake strategy; existing metric assertions still cover touch/overlap.
- Re-open criterion: Re-open when adopting Playwright screenshot baselines or renaming visual specs to layout-metric specs.

### C15-D19 - Production must preserve documented single-instance trusted-proxy topology

- Finding: AGG-C15-37
- Citation: `CLAUDE.md:228`, `apps/web/docker-compose.yml:21`, `apps/web/nginx/default.conf:67-70`, `apps/web/src/lib/request-origin.ts:55-68`, `apps/web/src/lib/rate-limit.ts:164-191`
- Original severity/confidence: High if scaled or directly exposed / High for repo assumption, medium for live state
- Reason for deferral: Manual production-topology validation item. This cycle does not change infrastructure topology, and repo docs explicitly state the single-instance/process-local constraint.
- Re-open criterion: Re-open before horizontal scaling, changing proxy topology, or exposing the app directly with `TRUST_PROXY=true`.

### C15-D20 - SQL backups are plaintext and DB-only by design

- Finding: AGG-C15-38
- Citation: `CLAUDE.md:209`, `apps/web/src/app/[locale]/admin/db-actions.ts:138-172`, `apps/web/src/app/api/admin/db/download/route.ts:44-75`
- Original severity/confidence: Low-Medium / High
- Reason for deferral: Manual operator storage-control validation; current behavior is explicitly documented as the product boundary.
- Re-open criterion: Re-open when threat model requires encrypted app-level backups or when filesystem snapshot pairing is added.

### C15-D21 - Admin authorization is all-root by product decision

- Finding: AGG-C15-39
- Citation: `CLAUDE.md:5`, `CLAUDE.md:229`, representative admin actions cited in aggregate
- Original severity/confidence: Medium if admins are not equally trusted / High
- Reason for deferral: Explicit product/security model rather than an implementation bug. Role design would materially expand scope.
- Re-open criterion: Re-open if GalleryKit needs lower-trust admin roles, step-up auth, or delegated operator accounts.

### C15-D22 - Historical secrets still require operator rotation validation

- Finding: AGG-C15-40
- Citation: `CLAUDE.md:80-85`, `README.md:122-145`, `apps/web/.env.local.example:20-30`, `apps/web/src/lib/session.ts:19-35`
- Original severity/confidence: Medium if reused / High current HEAD clean, unknown production provenance
- Reason for deferral: Manual incident-response/operator validation. Current HEAD secret examples are clean and tests cover tracked secrets.
- Re-open criterion: Re-open if any production secret provenance is uncertain, if historical examples were copied, or during a coordinated secret-rotation task.
