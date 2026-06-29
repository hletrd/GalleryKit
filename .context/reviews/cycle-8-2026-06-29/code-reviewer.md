# Cycle 8 Code Review - 2026-06-29

Role: `code-reviewer`  
Repository: `/Users/hletrd/flash-shared/gallery`  
Reviewed HEAD: `d43f9fc5`  
Constraint: review-only; no implementation files edited.

## Scope And Inventory

Read first:

- `AGENTS.md`
- `CLAUDE.md`
- `/Users/hletrd/.agents/skills/code-review/SKILL.md`

Inventory before review:

- Active source: 484 files under `apps/web/src/**/*.{ts,tsx,js,jsx}`.
- Broader review-relevant surface: 2677 source, test, script, schema, config, doc, review, and plan files under `apps/web/src`, `apps/web/scripts`, `apps/web/drizzle`, `.context/reviews`, and `.context/plans`.
- Source inspected across public pages, admin routes, API routes, server actions, queue/processing, data access, auth/origin/rate-limit helpers, upload/storage/path handling, semantic search, analytics, UI components, and config modules.
- Tests/scripts/config inspected across `apps/web/src/__tests__`, lint guards, Drizzle migrations/journal, `scripts/migrate.js`, package manifests, deploy-related docs, and prior/current review reports.
- Prior context read to avoid duplicates: current Cycle 7 aggregate/plan/deferred files, run9-cycle8 reports, and current Cycle 8 peer reports already present in this directory (`critic`, `perf-reviewer`, `security-reviewer`).

Skipped as non-review-relevant: generated `.next`, `node_modules`, binary/image assets, uploaded media/resources, local env files, and raw build/runtime artifacts.

Validation evidence:

- `npm run lint:api-auth --workspace=apps/web` passed.
- `npm run lint:action-origin --workspace=apps/web` passed.
- `npm run lint:public-route-rate-limit --workspace=apps/web` passed.
- `npm test --workspace=apps/web -- cycle-7-source-contracts gallery-config privacy-fields semantic-search-route similar-search-route process-image-metadata` passed: 7 files, 71 tests.
- Node spot-check confirmed current `Math.max(1, Number(value) || fallback)` parsing yields `Infinity` for `Infinity` / `1e309`, preserves fractions such as `2.5`, and preserves very large numbers.

## Findings

### CODE-C8-01 - Bounded concurrency env knobs accept Infinity, fractions, and unbounded values

Severity: Medium  
Confidence: High  
Status: Confirmed code-quality / operational reliability risk.

Evidence:

- The CLIP limiter parses `CLIP_INFERENCE_CONCURRENCY` with `Math.max(1, Number(...) || 1)`: `apps/web/src/lib/clip-model.ts:52-67`.
- The image processing queue passes `Number(process.env.QUEUE_CONCURRENCY) || 1` directly to `PQueue`: `apps/web/src/lib/image-queue.ts:289-297`.
- Bulk image deletion parses `IMAGE_CLEANUP_CONCURRENCY` with the same unbounded `Math.max(1, Number(...) || 5)` shape before chunking cleanup promises: `apps/web/src/app/actions/images.ts:796-810`.
- The repo already has a safer integer/clamp helper for semantic limits: `apps/web/src/lib/clip-embeddings.ts:36-44`.
- `p-queue` accepts `Infinity` and fractional numbers because its runtime validation only checks `typeof number && >= 1`; see local dependency validation at `node_modules/p-queue/dist/index.js:296-300`.

Concrete failure scenario:

An operator mistypes `QUEUE_CONCURRENCY=1e309` or `QUEUE_CONCURRENCY=Infinity` while enabling production semantic search or recovering a backlog. `Number(...)` becomes `Infinity`, `PQueue` accepts it, and bootstrap can start every pending image job concurrently instead of the documented default one-at-a-time processing. Each job can fan out AVIF/WebP/JPEG encoders and a semantic embedding side effect, competing for CPU, libvips workers, disk I/O, memory, and MySQL connections. The same typo on `CLIP_INFERENCE_CONCURRENCY` disables the real CLIP model governor entirely, and `IMAGE_CLEANUP_CONCURRENCY=Infinity` makes one delete request launch cleanup for all selected images at once. Fractional values such as `2.5` also produce surprising behavior: the queue/limiter effectively permits three concurrent tasks, and cleanup chunks are sliced at coerced fractional indexes.

Concrete fix:

Centralize env parsing for positive bounded integers and reuse it for every concurrency knob. Require `Number.isFinite`, floor or reject fractional values intentionally, and clamp to a documented maximum per subsystem. For example, add a shared helper equivalent to the existing `envPositiveInt` pattern and use:

- `CLIP_INFERENCE_CONCURRENCY`: default 1, small upper cap such as 4 unless measured otherwise.
- `QUEUE_CONCURRENCY`: default 1, cap based on deployment sizing.
- `IMAGE_CLEANUP_CONCURRENCY`: default 5, cap based on safe filesystem pressure.

Add unit/source-contract coverage for `Infinity`, `1e309`, `2.5`, `0`, negative values, and large integers so future concurrency knobs cannot reintroduce the unbounded parse shape.

Why this is not a duplicate:

The current performance report flags that CLIP image preprocessing starts outside the model-inference slot. This finding is separate: even the slots that do exist can be disabled or inflated by accepted env values, and the same parser shape appears in queue and cleanup paths outside CLIP.

## Non-Findings Checked

- Browser and Lightroom upload write paths now use `getGalleryConfigStrict`, persist `processing_settings_json`, and enqueue jobs with the same snapshot; queue bootstrap restores valid snapshots and skips durable failed rows.
- `retryFailedImage` clears `processing_error`, `failed_at`, and `processing_settings_json`, so explicit retries intentionally use current settings rather than stale failed-row snapshots.
- Image derivative generation now uses fresh post-save metadata width, waits for all encoder branches to settle before cleanup, and removes partial sized variants on failure.
- Public image privacy projections omit the new `processing_settings_json` field across public/list/map/search surfaces and the compile-time/test fixtures know the field.
- Public tag filtering uses server-provided canonical `currentTags`, avoiding the previous URL-case mismatch.
- Grid fallback wiring is present across home, timeline, year, and shared group pages; the hydration cost is already covered by the current performance report and not duplicated here.
- Semantic and similar search routes return HTTP errors on enrichment failure instead of silently emitting incomplete private-field projections.
- Current Cycle 8 peer findings on analytics indexes, referrer link-local sanitization, tracked secrets, and CLIP preprocessing admission were not re-filed here.

## Final Missed-Issue Sweep

Re-swept for unwrapped admin APIs, mutating actions without origin guards, public mutating routes without rate limiting, raw SQL hazards, privacy projection drift, upload cleanup gaps, queue/bootstrap state drift, migration/journal omissions, stale settings contracts, and prior deferred issues. No additional code-quality finding survived the evidence threshold without duplicating Cycle 7 deferred items or current Cycle 8 peer reports.
