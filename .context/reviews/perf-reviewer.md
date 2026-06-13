# Performance Review — Cycle 7/100 (review-plan-fix)

**Date:** 2026-06-13
**Repo:** /Users/hletrd/flash-shared/gallery (GalleryKit — Next.js 16 / React 19 / TS6 / MySQL+Drizzle / Sharp photo gallery)
**HEAD:** `d0920957` (clean tree; only `.context/` review-artifact deltas since the last cycle — no `.ts/.tsx/.js` source changes)
**Reviewer:** perf-reviewer (read-only; this file persisted by the orchestrator from the agent's inline-returned report — the spawned reviewer's `Write` tool was disabled in its read-only context, mirroring the recovery pattern used for prior read-only reviewers).

## Verdict: No new actionable perf defect/regression worth a code change this cycle.

Near-converged, heavily-iterated codebase. Every hot surface is already optimized, documented with rationale, and locked by fixture tests. Every candidate traced to either a documented-intentional tradeoff (not to be re-flagged) or a prior-cycle deferral with explicit exit criteria. The valuable result is the **negative confirmation** — the perf surface is stable.

Files reviewed (15 perf-relevant surfaces): the cached data layer (`lib/data.ts`), Sharp pipeline (`lib/process-image.ts`), image queue (`lib/image-queue.ts`), backfill runner (`lib/admin-backfill-runner.ts` + `scripts/backfill-color-pipeline.ts`), schema/index coverage (`db/schema.ts`), masonry/photo-viewer/histogram/load-more components, SW cache (`public/sw.template.js` + `lib/sw-cache.ts`), timeline/analytics/atom (`lib/data-timeline.ts`, `lib/analytics-data.ts`, `lib/atom-feed.ts`), and the semantic-search route.

---

## NEW (for aggregation)

| id | severity | confidence | one-line | file:line |
|---|---|---|---|---|
| PERF-C7-OBS-1 | LOW (observation, **no fix recommended**) | Medium | Semantic-search scores up to `SEMANTIC_SCAN_LIMIT=5000` 512-dim vectors **synchronously on the event loop** (base64 decode + Float32Array alloc + cosine, no yield). Bounded by a HARD cap, default-`disabled` admin opt-in, rate-limited 30/min/IP, deliberate stub-demo design. Single-digit-to-low-tens-ms stall worst case. | `app/api/search/semantic/route.ts:247-274`; cap `lib/clip-embeddings.ts:14` |

**NEW findings requiring a code change: 0.** PERF-C7-OBS-1 is an observation with deferred exit criteria (revisit only if a real `production` CLIP encoder ships AND the embeddings table holds the full 5000-row cap), not a fix request.

---

## RE-CONFIRMED record-only (documented-intentional — NOT findings, do NOT re-flag)

| id | one-line | evidence at HEAD |
|---|---|---|
| RC-1 | SW metadata lost-update (best-effort cache by design) | `lib/sw-cache.ts` `recordAndEvict` |
| RC-2 | Bootstrap `notInArray` over ≤1000 IDs (happy-path zero-cost) | `lib/image-queue.ts:609-611` (gated on size>0; cap 1000) |
| RC-3 | Decode-per-format ~18/image (WI-14 correctness tradeoff) | `lib/process-image.ts:1109-1115` (fresh `sharp()` per format to avoid cross-format state contamination; same-size variants reuse via `fs.link`) |
| RC-4 | Atom feed filesort (bounded by FEED_LIMIT+cache) | `lib/data.ts:771-794` (`updated_at DESC`, limit ≤101) |
| RC-5 | Timeline non-sargable `YEAR()/MONTH()` (bounded by LIMIT) | `lib/data-timeline.ts:184-205` (cap 501); `getTimelineYears` distinct-year set tiny |
| RC-6 | Single pool/10 + single-writer topology | `admin-backfill-runner.ts` budget math + CLAUDE.md runtime-topology note |

## RE-CONFIRMED record-only (prior-cycle deferrals — already adjudicated)

| id | one-line | disposition |
|---|---|---|
| RC-7 | `getMapImages()` unbounded (no LIMIT) | = **PERF-R4C15-B**, LOW/Medium, DEFERRED w/ exit criteria (markers ≳2k or payload complaints). `lib/data.ts:1565-1592`. Bounded in practice by per-topic `map_visible` opt-in |
| RC-8 | Analytics 'all'-window covering-index temp-table aggregation | = **PERF-R5C2-01**, documented inline `lib/analytics-data.ts:93-111,188-191`; bounded by retention; predicate reorder deferred pending EXPLAIN (plan-322) |

---

## Clean-surface highlights (evidence the optimizations hold at HEAD)

- **Unbounded sweep:** only `from(images)` without `.limit` are `getImageCount` (scalar `count(*)`), `getFailedImages` (admin-only), and `getMapImages` (RC-7). All `inArray` are bounded — admin batch ops explicitly capped at `ids.length > 100` (`images.ts:652,882,896`).
- **Sharp memory:** `sharp.cache(false)`, concurrency÷3, `.toFile()` streaming, `sequentialRead` mmap input, WI-15 50 MP downscale gate, original **streamed** to disk (not heap). `stripGpsFromOriginal` full-file read is bounded (once/upload, single-writer) — not a finding.
- **React:** masonry is pure CSS `columns-N` (no JS reorder); histogram O(n) in a **Web Worker** w/ zero-copy transfer + clean abort/terminate lifecycle; load-more is IntersectionObserver + keyset cursor + stale-response guards; photo-viewer single-format idle prefetch (R4C8 double-fetch already fixed).
- **Feed `adminUsers` JOIN:** join key is PK; `uploaded_by` indexed (`idx_images_uploaded_by`). No unindexed path.

## Recommendation

**COMMENT** — no blocking perf concerns; no code change required this cycle. PERF-C7-OBS-1 is an observation with deferred exit criteria, not a fix request. The two prior-cycle deferrals (RC-7/RC-8) remain correctly deferred with unchanged exit criteria.
