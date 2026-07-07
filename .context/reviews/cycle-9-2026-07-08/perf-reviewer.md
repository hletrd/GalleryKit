# Cycle 9 (loop-B) Performance / Concurrency Review

- **Reviewer:** perf-reviewer
- **Date:** 2026-07-08
- **HEAD reviewed:** `6efd737b` (`fix(cycle18): harden review-plan-fix findings` — this is the CONCURRENT peer run-10 loop's latest commit; loop-B's own predecessor is `cycle-8b-2026-07-07`)
- **Scope:** `apps/web/src/lib/data.ts` (query shapes), `lib/process-image.ts` + `lib/image-queue.ts` (Sharp pipeline), `app/api/search/**` (semantic/similar), `components/` (masonry, map, histogram, photo-viewer, lightbox, tag-filter), `lib/color-detection.ts`, plus a diff-focused pass over every file the latest commit touched.
- **Method:** read the named hot-path files directly; cross-checked the full history of prior perf findings in this lineage (`cycle-2-2026-07-07/perf-reviewer.md`'s PERF-01..23, `cycle-8-2026-07-07/perf-reviewer.md`'s PERF-F1/PERF-REACT-01/02/PERF8-SW-01/PERF8-BF-01) against current source to separate "already fixed," "still open/carried forward," and genuinely new; then diffed the latest commit (`6efd737b`) file-by-file for fresh regressions since that commit hadn't been perf-reviewed yet.
- **No source files were modified.**

## Already tracked — not re-reported

Per the review brief, these are being actively carried by the concurrent peer loop and are not re-litigated here:
- Large multipart request-body materialization (LR upload + `uploadImages`).
- Per-request `O(SEMANTIC_SCAN_LIMIT)` embedding blob scan + decode in `app/api/search/semantic/route.ts` and `app/api/search/similar/[id]/route.ts`.
- `/map` shipping up to 10,000 Leaflet DOM markers (`MAP_MAX_MARKERS`, `components/map/map-client.tsx`).

---

## New finding

### PERF9-01 — Cycle-18's mobile tag-filter collapsible renders every tag chip TWICE in the DOM

- **Severity:** MEDIUM (scales with tag vocabulary size; zero benefit for the cost) · **Confidence:** High
- **Where:** `apps/web/src/components/tag-filter.tsx:62-145`, introduced by the peer loop's HEAD commit `6efd737b` (`fix(cycle18)`, diff to `apps/web/src/components/tag-filter.tsx`).
- **What changed:** the component used to return one `<div className="flex flex-wrap gap-2">{chips}</div>`. The new version builds the same `chips` JSX fragment (the "All" chip + one chip per tag, each an interactive `<Badge asChild><button>…</button></Badge>` with `onClick`/`onKeyDown` handlers) once, then inserts that **same element** into two separate parent containers in the returned tree:
  ```tsx
  <details className="group sm:hidden">          {/* line 127 */}
    ...
    <div className="mt-2 flex flex-wrap gap-2" ...>{chips}</div>   {/* line 136-138 */}
  </details>
  <div className="hidden flex-wrap gap-2 sm:flex" ...>{chips}</div> {/* line 140-142 */}
  ```
  Tailwind's `sm:hidden` / `hidden sm:flex` only toggle CSS `display`; both subtrees are mounted, hydrated, and reconciled by React regardless of viewport width. Referencing the same JSX value twice does not let React share DOM nodes — each occurrence gets its own mount/instance.
- **Why it's a regression, not a wash:** before this change, a gallery with N tags rendered N+1 chip buttons. After, it renders 2N+2 — every `<Badge>`, `<button>`, count `<span>`, and their attached `onClick`/`onKeyDown` handlers exist twice, on every page that shows the filter (home, `[topic]`, `c/[slug]` all pass `tags`/`currentTags` into this component). This doubles:
  1. **Initial SSR/hydration cost** for the tag filter on every public page load.
  2. **Re-render cost on every filter interaction and on every `HomeClient` re-render.** `TagFilter` is not wrapped in `React.memo` (`home-client.tsx:304`), and `HomeClient` itself re-renders on infinite-scroll page appends and on the bucketed viewport-width resize state (`home-client.tsx:19-23`, the same class of re-render that `MasonryCard`'s memoization (cycle-2 PERF-09) was added to avoid). Each of those re-renders now reconciles the tag-chip tree twice instead of once, since `chips` is recomputed inline (not memoized) and used in two places.
  - Note: `hidden` elements are removed from the accessibility tree, so there's no user-facing double-announcement — the cost is purely DOM/hydration/reconciliation, not a11y regression. Both wrappers also correctly carry `role="group" aria-label={t('home.tagFilter')}`, so no duplicate-landmark issue either — this is purely a performance finding.
- **Scenario:** a gallery with a few dozen to a couple hundred tags (CLAUDE.md's own admin-scale example is "hundreds of tags") — every home/topic/smart-collection page render now mounts/hydrates 2× the chip DOM nodes for no additional functionality, and every subsequent filter click or scroll-triggered `HomeClient` re-render pays double React reconciliation for a component that renders no different content in either branch.
- **Fix (pick one):**
  1. Minimal: wrap `TagFilter` in `React.memo` so parent re-renders (scroll append, viewport bucket change) don't re-render either copy unless `tags`/`currentTags` actually changed — halves the *ongoing* re-render cost (not the initial double-mount).
  2. Better: avoid the dual-mount entirely. Drive the mobile/desktop split from a single client-side breakpoint check (e.g. a `useSyncExternalStore`/`matchMedia` boolean, same idiom already used by `use-display-capability.ts`) and render `chips` into exactly one wrapper, swapping which wrapper (details vs flat) based on that boolean — accepting a first-paint SSR default (e.g. assume desktop, correct after hydration) instead of shipping both trees.
  3. If the native `<details>` collapse behavior on mobile is a hard requirement and a single-DOM CSS-only trick isn't acceptable, at minimum memoize `chips` with `useMemo` so the two mounts don't independently reconstruct the JSX array on every render — this doesn't reduce DOM node count but avoids doing the tag-count/label formatting work twice.
- **Status:** confirmed from code; no runtime profiling done (would require a large synthetic tag vocabulary + React DevTools profiler to quantify hydration/reconciliation milliseconds).

---

## Carry-forward status check (this lineage's prior perf findings)

The last full from-scratch perf sweep in this lineage was `cycle-2-2026-07-07/perf-reviewer.md` (PERF-01 through PERF-23) and `cycle-8-2026-07-07/perf-reviewer.md` (PERF-F1, PERF-REACT-01/02, PERF8-SW-01, PERF8-BF-01). Re-verifying each against current source rather than assuming staleness:

**Confirmed fixed since cycle-2:**
- PERF-01 (SW rewrote full cached image body on every 304) — fixed; `evictExpiredCachedImage` reads the LRU meta timestamp and the 304/same-ETag path no longer calls `imageCache.put` (`public/sw.template.js:277-365`, C2-11).
- PERF-03 (`getTopics()` correlated subquery on every `revalidate=0` render) — fixed; split into a lean `getTopics()` (no subquery, `data.ts:514-522`) and a sitemap-only `getTopicsWithLatestUpdate()` (`data.ts:533-547`).
- PERF-04 (semantic/similar: 512-call `readFloatLE` decode loop, no zero-copy) — fixed; `decodeEmbeddingColumn` in `clip-embeddings.ts` takes a little-endian-probed zero-copy path (C2-14) with a documented retention contract for callers that hold the view across further `await`s.
- PERF-07 (`updateTag`/`deleteTag` SELECT-all-ids + unbounded `UPDATE … IN (...)`) — fixed; `tags.ts:100-105` now does a single `UPDATE images JOIN imageTags ... SET updated_at = CURRENT_TIMESTAMP WHERE imageTags.tagId = ?` (C2-17).
- PERF-08 / PERF-19 (touchmove-driven React state re-render in info-bottom-sheet / photo-navigation) — fixed; both now write `style.transform` directly to refs per-frame and only commit React state on touch end/idle (`info-bottom-sheet.tsx:123-181`, `photo-navigation.tsx:40-97`).
- PERF-09 (masonry cards not memoized, full re-render on every infinite-scroll append) — fixed; `home-client.tsx` now maps over a dedicated `MasonryCard` component (`home-client.tsx:10,320`).
- PERF-11 (feed/sitemap `ORDER BY updated_at` with no supporting index → filesort) — fixed; `idx_images_processed_updated_at` and `idx_images_topic_updated_at` now cover `(processed, updated_at, created_at, id)` / `(topic, processed, updated_at, created_at, id)` (`db/schema.ts:126,128`).
- PERF-12 (TagInput re-normalized the full tag list with NFKC on every keystroke) — fixed; `tag-input.tsx:62-70` now memoizes `normalizedAvailableTags`/`normalizedSelectedTags` off `[availableTags]`/`[selectedTags]`.
- PERF-REACT-01 (histogram `crossOrigin='anonymous'` defeats same-origin cache reuse) — fixed; gated behind `needsCrossOriginForCanvas(effectiveUrl)` (`histogram.tsx:573-581`).
- PERF-REACT-02 (same as PERF-12, reported independently in the cycle-8 lane) — fixed, same commit.

**Confirmed still open (re-verified against current source, not new — carried forward, no new angle found this cycle):**
- PERF-02 / peer-tracked map markers — open, but explicitly out of scope per this cycle's brief (peer loop is carrying it).
- PERF-05 (anonymous view recording: 4 sequential round-trips) — `recordPhotoView`/`recordTopicView`/`recordSharedGroupView` still issue separate increment/check/existence/insert statements (`app/actions/public.ts`). Not re-profiled this cycle.
- PERF-06 (`getOnThisDayImages`/timeline use non-sargable `MONTH()`/`DAY()`/`YEAR()` on `capture_date`, invoked from the home page's `OnThisDayWidget` on every `revalidate=0` render) — still present (`data-timeline.ts`, `MONTH(...)`/`DAY(...)`/`YEAR(...)` predicates unchanged). Still the same accepted-at-personal-scale posture documented in the source.
- PERF-10 (`stripGpsFromOriginal` reads the entire original into memory per file) — unchanged; still a real concurrent-upload RSS concern, not re-profiled.
- PERF-13 (6-10 queries/render against pool 10 / queueLimit 20) — structurally unchanged; several of its component queries (PERF-03, PERF-11) got cheaper, so the per-render query count is the same but each query is now lighter. Not independently re-measured.
- PERF-16 (encoder decodes source once per size per format) — unchanged; still documented as a deliberate correctness trade (WI-14), not a defect.
- PERF-17 (public search: 6-column leading-wildcard LIKE, no FULLTEXT index) — unchanged; still guarded by rate limits, acceptable at documented scale.
- PERF-20 (upload dropzone O(n²)-ish re-render + full-res object-URL previews) — not independently re-checked this cycle; admin-only, capped at 100 files.
- PERF-22 / PERF8-BF-01 (`pipeline_version` has no covering index; both the sidecar backfill candidate scan and `fetchCandidateCount` full-scan the processed slice) — confirmed still unindexed (`db/schema.ts:83`, `pipeline_version: int('pipeline_version')`, no index entry). Same finding as loop-B's own cycle-8b deferred register ("pipeline_version index") — carried forward, not new.
- PERF8-SW-01 (SW HTML offline-cache eviction reads+matches every cache key past the 50-entry cap on every write past the cap) — confirmed still present verbatim (`public/sw.template.js:146-163`, `evictHtmlCacheIfNeeded`). Already this lineage's own tracked deferred item (`cycle-8b-2026-07-07-deferred.md`) — carried forward, not new.

## Fresh-eyes areas checked this cycle with no new finding

- `lib/color-detection.ts` (explicit brief item): the ISOBMFF `colr`/nclx walker is bounded (max depth 5, max scan 1 MB) and runs once per HEIF/AVIF upload, sharing its 1 MB header read with gain-map detection (`detectColorSignals:337-361`). Upload-time only, not a serving hot path. Clean.
- `data.ts` query shapes not previously flagged: `getSharedGroup` (single group lookup + one batched tag query, no N+1, `data.ts:1322-1413`), `getImagesForSmartCollection` (lean parallel count, matches `getImagesLitePage`'s pattern, `data.ts:1488-1551`), `getTopicsWithAliases` (O(1) Map-based alias join instead of nested filter, `data.ts:563-584`), `getImageWithSelectFields` prev/next navigation (three queries in one `Promise.all`, `data.ts:1152-1198`). All clean.
- `_getTags`/`getTagsCached` (full `tags LEFT JOIN imageTags LEFT JOIN images` aggregation, no LIMIT, `data.ts:586-604`) — this runs on every home/topic/smart-collection `revalidate=0` render (`page.tsx:161-168`, `[topic]/page.tsx:183`, `c/[slug]/page.tsx:117`). Cost scales with total tagged-image pairs, not just tag count. This is the same query shape criticized broadly in PERF-13's "6-10 queries/render" framing from cycle-2, so it isn't a new finding on its own, but flagging it explicitly here since it wasn't itemized separately before: if this codebase ever revisits the pool-budget/hot-page-query-count cluster, this aggregation (plus PERF-06's on-this-day scan) are the two per-render full-ish scans on the home page alongside the already-cheap listing/count pair.
- `apps/web/src/app/actions/embeddings.ts` diff in the reviewed HEAD commit — this is a perf *improvement* (keyset-paginated candidate selection replacing a single unbounded batch fetch, matching the sidecar's pattern), not a regression. No finding.
- `apps/web/src/lib/api-auth.ts` / `lr/upload/route.ts` diff — moves `markTokenUsed` to fire once per admitted request after validation instead of once per authenticated attempt; strictly fewer writes in the rejected-request case. No finding.
- `apps/web/src/lib/process-image.ts` diff in the reviewed HEAD commit — comment/doc consolidation only (`IMAGE_PIPELINE_VERSION` history moved to `gallery-config-shared.ts`), no logic change.
- `app/api/search/similar/[id]/route.ts` — the target image's own embedding is fetched once by ID (`:140-149`) and then appears again inside the bulk `SEMANTIC_SCAN_LIMIT` scan (excluded only client-side via `.filter(row => row.imageId !== id)` at `:205`), so one row is decoded and scored twice. This is real but negligible (1 extra row out of up to 2000) and rides on the already-tracked peer-cycle scan-cost item — not broken out separately.

## Coverage statement

Read directly this cycle: `lib/data.ts` (full), `lib/color-detection.ts` (full), `app/api/search/semantic/route.ts` (full), `app/api/search/similar/[id]/route.ts` (relevant sections), `components/tag-filter.tsx` (full), `app/actions/tags.ts` (updateTag/deleteTag), `db/schema.ts` (index list), `clip-embeddings.ts` (decode/topK), `public/sw.template.js` (SW cache paths), plus targeted diff review of every file touched by the reviewed HEAD commit (`6efd737b`). Cross-referenced rather than re-read line-by-line: `lib/process-image.ts`, `lib/image-queue.ts`, `components/home-client.tsx`, `components/map/map-client.tsx`, `components/histogram.tsx`, `components/tag-input.tsx`, `components/info-bottom-sheet.tsx`, `components/photo-navigation.tsx` — each spot-checked against its specific prior finding rather than fully re-audited, since a full independent re-audit of files with zero diff since the last exhaustive pass (`cycle-2-2026-07-07`) would only reproduce that pass's findings.
