# Cycle 10/100 Deferred Findings

Date: 2026-06-29
Source: `.context/reviews/_aggregate.md`
Status: TODO / deferred

Repo rules read before deferral: `CLAUDE.md`, `AGENTS.md`, `.context/plans/README.md`, committed `.context` plan/review history, and `docs/superpowers/**`. No `.cursorrules` or `CONTRIBUTING.md` files exist in this repo.

Security, correctness, and data-loss findings are not deferred here. Deferred items are performance/scale, coverage, documentation/manual-validation, or product-roadmap risks. Deferred work remains bound by repo policy: signed Conventional Commit + gitmoji commits, no `--no-verify`, no force-push, current toolchain requirements, and required gates.

## Deferred Items

### C10-06 - Admin actions authenticate before same-origin rejection

- File+line: `apps/web/src/app/actions/settings.ts:40-47`, `seo.ts:54-61`, `collections.ts:15-118`, `topics.ts:85-189`, `tags.ts:42-106`, `sharing.ts:84-91`, `admin-users.ts:75-190`.
- Original severity/confidence: Low / High on pattern, Medium on exploitability.
- Reason for deferral: The review classifies this as a maintainability/guardrail risk, not a confirmed CSRF bypass; `npm run lint:action-origin` currently enforces the required same-origin check. Broad scanner/prologue ordering work is larger than this cycle's scheduled correctness/data-loss fixes.
- Exit criterion: Re-open when touching any listed action prologue, when adding stronger action-origin scanner ordering, or if a same-origin ordering bypass/side effect before origin rejection is confirmed.

### C10-07 - Image queue jobs can starve the shared DB pool while holding advisory locks

- File+line: `apps/web/src/lib/image-queue.ts:86-89`, `:430-447`, `:503-621`, `:797-799`; `apps/web/src/db/index.ts:23-33`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Performance/scale issue requiring queue/lock architecture changes. Current production policy is a single web process on a personal-gallery deployment; no immediate correctness/data-loss defect is confirmed.
- Exit criterion: Re-open before raising `QUEUE_CONCURRENCY`, before scale-out, or if request latency/DB pool saturation is observed during image processing.

### C10-08 - GPS stripping reintroduces whole-file heap pressure

- File+line: `apps/web/src/lib/process-image.ts:1673-1699`, `apps/web/src/app/api/admin/lr/upload/route.ts:137-145`, `:344-358`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Requires streaming/container-aware EXIF rewriting or a new memory budget policy. This is performance/memory pressure, not a confirmed public GPS leak; public GPS privacy remains guarded by `data.ts`.
- Exit criterion: Re-open before increasing upload limits, when adding streaming EXIF rewrite support, or if large GPS-stripped uploads cause RSS/GC failures.

### C10-10 - CLIP inference has a concurrency cap but no backlog cap or timeout

- File+line: `apps/web/src/lib/clip-model.ts:53-70`, `apps/web/src/app/api/search/semantic/route.ts:181-239`.
- Original severity/confidence: Medium / Medium-High.
- Reason for deferral: Requires a bounded global inference queue and operator observability. This is a scale/backpressure risk; C10-09 addresses the cheaper stale-request source this cycle.
- Exit criterion: Re-open before increasing semantic-search traffic, when queue depth/latency grows, or when adding shared inference queue metrics.

### C10-11 - Infinite masonry keeps every loaded card mounted

- File+line: `apps/web/src/components/home-client.tsx:127-360`, `apps/web/src/components/load-more.tsx:41-132`.
- Original severity/confidence: Low-Medium / Medium-High.
- Reason for deferral: Requires virtualization/windowing design for CSS masonry. Current gallery size is personal-scale and this is a long-session responsiveness risk, not a correctness defect.
- Exit criterion: Re-open when public galleries exceed thousands of loaded cards per session or if browser traces show scroll jank/memory pressure.

### C10-12 - Archive and smart-collection predicates can become CPU scan paths

- File+line: `apps/web/src/lib/data-timeline.ts:88-207`, `apps/web/src/lib/smart-collections.ts:217-266`, `apps/web/src/lib/data.ts:1437-1451`.
- Original severity/confidence: Low-Medium / High.
- Reason for deferral: Scale/performance risk explicitly tied to growth beyond personal-gallery scale. Requires query/index/materialization design.
- Exit criterion: Re-open before promoting broad public archives/smart collections at large scale, or when query plans show scans/temp-table pressure.

### C10-13 - Playwright visual checks generate screenshots without assertions

- File+line: Playwright visual nav checks referenced by `.context/reviews/test-engineer.md`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Quality-gate improvement, not an application bug. Needs visual-baseline policy and artifact ownership before adding snapshot thresholds.
- Exit criterion: Re-open when introducing visual regression baselines or when a browser-visible regression escapes non-visual tests.

### C10-14 - No coverage reporting or threshold gate exists

- File+line: package/Vitest gate configuration referenced by `.context/reviews/test-engineer.md`.
- Original severity/confidence: Low / High.
- Reason for deferral: Quality-process improvement. Adding coverage thresholds without calibration risks noisy gates unrelated to this cycle's fixes.
- Exit criterion: Re-open during dedicated test-infrastructure work or after identifying critical files without behavioral coverage.

### C10-15 - Some behavior is source-contract tested rather than behavior-tested

- File+line: `backfillClipEmbeddings` action and Atom route tests referenced by `.context/reviews/test-engineer.md`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: TDD opportunity for future changes; not a confirmed runtime defect.
- Exit criterion: Re-open when modifying embedding backfill or Atom feed route behavior.

### C10-19 - Playwright is Chromium-only and real CLIP tests are skipped by default

- File+line: Playwright and CLIP test configuration referenced by `.context/reviews/test-engineer.md`.
- Original severity/confidence: Low/Medium / High.
- Reason for deferral: Manual/scheduled validation risk requiring browser matrix resources and real model weights; not suitable for every local cycle gate.
- Exit criterion: Re-open before browser-support releases, semantic-search production changes, or when adding scheduled CI jobs with required resources.

### C10-20 - Semantic scan caps can reduce recall for large galleries

- File+line: semantic scan limit paths referenced by `.context/reviews/tracer.md`.
- Original severity/confidence: Medium / High.
- Reason for deferral: Product/scale tradeoff already bounded by configured scan limits. Current production is personal-gallery scale; no correctness breach is confirmed for galleries below the cap.
- Exit criterion: Re-open when embedding rows exceed `SEMANTIC_SCAN_LIMIT`, when recall complaints occur, or before adopting vector indexing.

### C10-21 - In-app embedding backfill can report success after one capped candidate set

- File+line: `apps/web/src/app/actions/embeddings.ts` candidate processing referenced by `.context/reviews/tracer.md`.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Operational completeness risk for a dark/admin path. C10-04 fixes the bootstrap missing-embedding drain for runtime queue recovery.
- Exit criterion: Re-open before exposing or relying on the in-app embedding backfill as a complete operator workflow.

### C10-22 - Process-local coordination depends on single-instance topology

- File+line: process-local queues/rate limits/buffers cited by tracer and architect.
- Original severity/confidence: Medium / High.
- Reason for deferral: Repo rule permits this operational constraint. `CLAUDE.md` states: "Run one GalleryKit per MySQL server — or prefix advisory-lock names with a per-instance identifier if multi-tenant co-location is required." The current deployment is documented as a single web instance.
- Exit criterion: Re-open before horizontal scaling, multi-instance deployment, or multi-tenant MySQL co-location.

### C10-23 - SQL-only restore does not restore filesystem state

- File+line: DB restore docs and UI copy cited by architect/product review.
- Original severity/confidence: Medium / High.
- Reason for deferral: Repo documentation explicitly defines the current scope: DB backups are SQL rows only and media/resources require host-level backups. Product copy was reviewed as not overpromising full-site backups.
- Exit criterion: Re-open if restore UI/copy starts implying full-site backup, or when designing a filesystem-inclusive backup/restore feature.

### C10-24 - Production semantic search has a manual rollout invariant

- File+line: semantic-search setup paths in `CLAUDE.md`, config, env, and DB mode.
- Original severity/confidence: Low / Medium.
- Reason for deferral: Operational setup risk; existing docs intentionally require operator opt-in, model seeding, DB mode, and populated embeddings.
- Exit criterion: Re-open when adding semantic-search health automation or changing production activation flow.

### C10-26 - Custom modal surfaces need real AT validation

- File+line: `apps/web/src/components/search.tsx`, `lightbox.tsx`, `info-bottom-sheet.tsx`.
- Original severity/confidence: Medium / Medium.
- Reason for deferral: Manual validation risk, not confirmed failure. C10-25 fixes the confirmed lightbox initial-focus bug.
- Exit criterion: Re-open when VoiceOver/NVDA testing shows background virtual-cursor leakage, or during a modal infrastructure pass.

### C10-27 - Authenticated admin browser coverage remains incomplete

- File+line: protected admin workflows cited by `.context/reviews/designer.md`.
- Original severity/confidence: Low / High.
- Reason for deferral: Requires seeded DB/admin auth state or a non-production reviewer account. Not a confirmed product defect.
- Exit criterion: Re-open when browser auth state is available or when adding admin E2E smoke coverage.

## Carry-forward

Prior deferred items in existing plan/archive files remain unchanged unless a later cycle closes them explicitly.
