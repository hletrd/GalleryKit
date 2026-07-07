# Performance Review — Run-10 Cycle 8 (loop-B), 2026-07-07

**Provenance note:** the perf-reviewer lane agent completed its three sub-sweeps
(server-actions perf, React component perf, SW/analytics/CLIP perf) and delivered
findings, but the lane process was terminated before writing its own report file.
This file was reconstructed by the cycle orchestrator from the delivered sub-sweep
results, with every citation re-verified against the working tree (review baseline
HEAD `6256a988`). Treat severities as the lane's own ratings.

Reviewed surface: apps/web/src/lib/data.ts, image-queue.ts, process-image.ts,
app/actions/*, db pool config, semantic/CLIP scan loops, components
(histogram, tag-input, photo-viewer, masonry), public/sw.template.js +
lib/sw-cache.ts, analytics write queue, view-retention/maintenance scheduler.

## Findings

### PERF-F1 — Embedding bootstrap scan shares the live request pool without a budget clamp
- **Severity:** LOW · **Confidence:** Medium
- **Where:** `apps/web/src/lib/image-queue.ts` — `bootstrapMissingActiveEmbeddings`
  (~line 527) and the per-image embedding upsert (~line 505-525).
- **Problem:** the missing-embedding scan + per-row `onDuplicateKeyUpdate` writes run
  on the shared 10-connection pool on every queue bootstrap/continuation. Unlike the
  color backfill (`resolveBackfillConcurrency` budget clamp) there is no documented
  pool-budget reasoning for this path; in stub mode the embedding computation is cheap
  but the scan still issues up to `SEMANTIC_SCAN_LIMIT` row reads inter-leaved with
  live traffic.
- **Scenario:** operator flips stub→production with a large gallery; the model-version
  cursor reset makes every processed row "missing", and the scan+CLIP inference churn
  competes with live page renders for pool connections.
- **Fix:** either document the budget (scan is sequential, holds ≤1 connection at a
  time — verify) or fold the path into the same pool-budget note as the color
  backfill. Chains with deferred C6-04c (shared pool-budget semaphore) and C4-27
  (in-app scan vs sidecar coordination).

### PERF-REACT-01 — Histogram image fetch uses `crossOrigin='anonymous'`, defeating HTTP-cache reuse
- **Severity:** LOW-MED · **Confidence:** High
- **Where:** `apps/web/src/components/histogram.tsx:555` (`img.crossOrigin = 'anonymous'`).
- **Problem:** gallery/lightbox `<img>` tiles fetch derivatives in no-CORS mode. The
  histogram loads the same URL with `crossOrigin='anonymous'`, which is a different
  request mode; browsers key their HTTP cache entries on request mode/credentials, so
  the histogram's load frequently MISSES the just-fetched bytes and re-downloads the
  sized JPEG (hundreds of KB) over the network before computing.
- **Scenario:** visitor opens the lightbox color pip on a photo whose `_2048.jpg` is
  already rendered — the histogram re-downloads it; on same-origin deployments the
  CORS mode is unnecessary for canvas reads anyway (same-origin images are not
  tainted).
- **Fix:** only set `crossOrigin` when the resolved URL is actually cross-origin
  (IMAGE_BASE_URL CDN case); for same-origin URLs omit it so the cached response is
  reused.

### PERF-REACT-02 — TagInput re-normalizes the full availableTags list on every keystroke
- **Severity:** LOW · **Confidence:** High
- **Where:** `apps/web/src/components/tag-input.tsx:58-70` (`filteredTags` memo) and
  `hasSelectedTag`/`findCanonicalTag` helpers (lines 27-38).
- **Problem:** `normalizeTagInputValue` (trim + NFKC normalize + toLocaleLowerCase)
  runs for every available tag twice per filter pass (selected-exclusion + input
  match), on every keystroke. NFKC normalization is not free; with hundreds of tags
  this is O(2N) string normalizations per input event, recomputed although
  `availableTags` rarely changes.
- **Scenario:** admin bulk-edit dialog with a large tag vocabulary; typing lags on
  low-end devices.
- **Fix:** memoize a `Map<normalizedName, TagRecord>` keyed off `availableTags` once
  (useMemo on `[availableTags]`), and normalize the input once per keystroke.

### PERF8-SW-01 — HTML offline-cache eviction is O(N) match() reads per cached page write
- **Severity:** LOW · **Confidence:** High
- **Where:** `apps/web/public/sw.template.js` — `evictHtmlCacheIfNeeded`
  (~lines 146-165; mirrored in `apps/web/src/lib/sw-cache.ts`).
- **Problem:** on every HTML cache write past `MAX_HTML_ENTRIES` (50), eviction calls
  `htmlCache.keys()` then `match()` on EVERY key to read the `sw-cached-at` header,
  sorting all entries to delete the overflow. That is 50+ cache reads per page
  navigation once the cache is warm — needless main-thread SW work compared to the
  image cache's meta-map recency accounting.
- **Scenario:** long browsing session on a warm PWA; every navigation pays ~50
  cache.match() calls inside the SW.
- **Fix:** reuse the image-cache pattern: keep an IDB/meta recency map for HTML
  entries too, or only run the full O(N) sweep when `keys().length` exceeds the cap
  by a hysteresis margin (e.g. 60), amortizing the cost.

### PERF8-BF-01 — No index on `images.pipeline_version` for backfill candidate selection
- **Severity:** LOW · **Confidence:** High
- **Where:** `apps/web/src/db/schema.ts:83` (`pipeline_version: int(...)` — no index
  in the table's index list); consumers: `scripts/backfill-color-pipeline.ts` and
  `lib/admin-backfill-runner.ts` candidate queries (`pipeline_version != CURRENT` /
  `IS NULL` filters).
- **Problem:** both backfill entry points full-scan `images` to find behind-version
  rows. Fine at the documented single-admin scale (thousands of rows), but the scan
  repeats per batch page, making the backfill's DB cost quadratic-ish in gallery size
  when most rows are already current.
- **Scenario:** 50k-photo gallery, pipeline v8 bump, sidecar backfill pages through
  candidates — every page re-scans the table.
- **Fix:** fold a `(pipeline_version, id)` index into the next schema/migration
  cycle (do not author a migration solely for this; per repo migration-authoring
  rules it can ride the next journal entry).

## Flows checked with no new finding
- data.ts masonry/list queries: `tagNamesAgg` GROUP_CONCAT shape unchanged and
  index-aligned; no N+1 found.
- process-image.ts fan-out: per-format fresh decode is a documented correctness
  trade (WI-14); no regression.
- analytics write queue and view-retention purge: bounded and chunked as documented.
- upload multipart RSS envelope: known/deferred (C1-33, C2-20) — not re-reported.

## Summary
0 CRIT / 0 HIGH / 1 LOW-MED / 4 LOW — 5 findings (PERF-F1, PERF-REACT-01,
PERF-REACT-02, PERF8-SW-01, PERF8-BF-01).
