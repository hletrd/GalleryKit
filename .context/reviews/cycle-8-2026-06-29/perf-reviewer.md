# Cycle 8 Performance Review

Date: 2026-06-29
Repo: `/Users/hletrd/flash-shared/gallery`
Reviewed HEAD: `d43f9fc5`
Reviewer: perf-reviewer

## Scope And Inventory

Read first: `AGENTS.md`, `CLAUDE.md`, and the code-review workflow instructions. I inventoried the tracked repository with `git ls-files`, then reviewed the performance-relevant source, tests, scripts, configs, docs, and prior review context rather than sampling.

Primary areas inspected:
- Runtime data paths: `apps/web/src/lib/data.ts`, `data-timeline.ts`, `analytics-data.ts`, `clip-embeddings.ts`, `clip-model.ts`, `image-queue.ts`, `process-image.ts`, `view-retention.ts`, rate-limit and restore helpers.
- Public/admin routes and UI hot paths: public gallery, topic, smart collection, timeline, year, share, semantic/similar search, upload dropzone, home grid, grid picture fallback, photo viewer.
- DB/schema/migrations: `apps/web/src/db/schema.ts`, Drizzle migrations/journal, migration/reconcile script.
- Build/runtime/deploy: `apps/web/Dockerfile`, `docker-compose.yml`, `next.config.ts`, nginx config, service worker template/generated worker, package scripts.
- Tests/source contracts: Cycle 7 contract tests, queue/embedding tests, privacy/touch-target/build-boundary tests where relevant.
- Prior context: `.context/reviews/perf-reviewer.md`, `.context/reviews/_aggregate.md`, `.context/reviews/run9-cycle8/*`, `.context/plans/cycle-7-2026-06-29-plan.md`, `.context/plans/cycle-7-2026-06-29-deferred.md`.

## Findings

### PERF-C8-01 - CLIP image preprocessing and side-effect admission still bypass the concurrency governor

Severity: Medium
Confidence: Medium-High
Status: Likely issue, confirmed code path

Evidence:
- `apps/web/src/lib/clip-model.ts:52-67` defines the process-wide `withInferenceSlot` limiter.
- `apps/web/src/lib/clip-model.ts:167-202` runs Sharp decode/resize/raw conversion and allocates the 512x512x3 `Float32Array` before entering `withInferenceSlot`.
- `apps/web/src/lib/image-queue.ts:611-670` starts the production image embedding as a tracked fire-and-forget side effect after `processed=true`; the queue job does not wait for the side effect before it can move to later images.

Why this is not a duplicate: Cycle 7 C7-07 asked for a process-wide governor around real CLIP inference. The current implementation serializes the `model(...)` call, but the expensive image decode/preprocess work and the side-effect admission path are still outside that governor.

Failure scenario: With `semantic_search_mode=production`, a batch upload or bootstrap reprocess can complete Sharp derivative jobs faster than real CLIP image embedding drains. Each completed image launches an embedding side effect, and every side effect can concurrently read/decode the original file, resize to 512x512 raw pixels, and allocate/normalize the float tensor before waiting for the model slot. On the documented single web instance this competes with upload processing, public requests, and MySQL work for CPU, memory, and disk IO. A burst can also leave many tracked side effects draining during shutdown/restore even though model inference itself is serialized.

Concrete fix: Put admission for the whole real embedding job behind a bounded queue/slot, not only the final `model(...)` call. For image embeddings, acquire the CLIP slot before Sharp decode/preprocess and release it after storing or returning the embedding. Alternatively introduce a dedicated `clipEmbeddingQueue` with default concurrency 1 and submit both text/image real encodes through it; for the image queue, enqueue the side effect into that queue so the number of in-flight preprocessing tasks is bounded. Add a regression test that invokes concurrent `embedImageReal` calls with stubbed Sharp/model and asserts the Sharp preprocess section is not entered concurrently at default concurrency.

### PERF-C8-02 - Stateful grid fallback hydrates every archive/share image card

Severity: Low-Medium
Confidence: Medium
Status: Risk, confirmed code path

Evidence:
- `apps/web/src/components/grid-picture.tsx:1-3` makes the grid picture helper a client component and imports React state.
- `apps/web/src/components/grid-picture.tsx:34-59` builds a key and allocates `useState`/`onError` for every rendered card.
- `apps/web/src/lib/data-timeline.ts:159` allows up to 500 images in a timeline/year page.
- `apps/web/src/app/[locale]/(public)/timeline/page.tsx:12` imports `GridPicture`, and `apps/web/src/app/[locale]/(public)/timeline/page.tsx:213-257` renders it for every month photo.
- `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:13` imports `GridPicture`, and `apps/web/src/app/[locale]/(public)/year/[year]/page.tsx:174-215` renders it for every year-review photo.
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:12` imports `GridPicture`, and `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:177-221` renders it for every shared image; `apps/web/src/lib/data.ts:1278-1282` caps shared groups at 100 images.

Failure scenario: The fallback correctly fixes AVIF/WebP 404 behavior, but server-rendered archive/share pages now ship and hydrate a client boundary with React state per image card solely to handle rare source failures. A full timeline or year page can hydrate 500 `GridPicture` instances before interaction becomes responsive on low-end mobile devices, while shared groups can hydrate 100. The cost is avoidable because the steady-state markup is static and the fallback only needs to react when an image errors.

Concrete fix: Keep the server-rendered `<picture>` markup static and move fallback handling to a single delegated client island per grid, or a tiny client wrapper around the grid that listens for capture-phase `error` events and removes/marks failed `<source>` nodes for the affected picture. That preserves the 404 fallback without allocating one React state cell and one hydrated component per card. Add a source contract or browser smoke test for a grid with a broken AVIF/WebP source to prove the delegated fallback still reaches the base JPEG.

## Known Carried-Forward Items Not Re-Filed

These are still visible in source, but they are already recorded in `.context/plans/cycle-7-2026-06-29-deferred.md` and are not counted as new Cycle 8 findings:
- C7-04 initial listing query shape: `apps/web/src/lib/data.ts:877-905` and `apps/web/src/lib/data.ts:1437-1451` still combine `GROUP_CONCAT` tag aggregation with `COUNT(*) OVER()` across the matched set. Deferred at `.context/plans/cycle-7-2026-06-29-deferred.md:19-26`.
- C7-05 analytics top-table indexes: `apps/web/src/lib/analytics-data.ts:28-46`, `apps/web/src/lib/analytics-data.ts:62-79`, and schema index coverage remain mismatched for bot/time/entity grouping. Deferred at `.context/plans/cycle-7-2026-06-29-deferred.md:28-35`.
- C7-06 retention range deletes: `apps/web/src/lib/view-retention.ts:64-81` deletes by `viewed_at`, while topic/share event indexes remain entity-leading. Deferred at `.context/plans/cycle-7-2026-06-29-deferred.md:37-44`.
- C7-08 upload preview virtualization/cap: `apps/web/src/components/upload-dropzone.tsx` now has immediate lazy/async image decoding, but the larger visible-window cap remains deferred. Deferred at `.context/plans/cycle-7-2026-06-29-deferred.md:46-53`.
- C7-12 bounded semantic scan disclosure/vector-index work remains a product/search scope decision. Deferred at `.context/plans/cycle-7-2026-06-29-deferred.md:55-62`.
- C7-20/C7-21/C7-22 deployment topology risks remain manual topology validation items. Deferred at `.context/plans/cycle-7-2026-06-29-deferred.md:64-89`.

## Missed-Issue Sweep

I re-swept for N+1 queries, unbounded maps/queues, large in-memory buffers, blocking request hot paths, race pressure around processing cleanup, cache invalidation, service-worker versioning, Docker/runtime hazards, and public UI responsiveness. No additional new performance findings survived deduplication against Cycle 7 and the run9-cycle8 clean reports.

Notable non-findings:
- Queue bootstrap now persists processing snapshots and excludes durable failed rows; this addresses the Cycle 7 snapshot/failed-row loop concerns.
- Image derivative generation now waits for all encoder branches before cleanup and uses fresh metadata width for normal sizing.
- Public share image reads batch tags once for up to 100 images, avoiding an N+1 read path.
- The generated service worker remains a build-time artifact and was not changed during this review.

Validation: Source inspection and prior-review deduplication only. I did not run runtime load tests, `EXPLAIN` plans, or the full quality gate because this was a review-only task with no implementation changes.
