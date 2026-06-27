# Performance Review — Cycle 18

**Reviewer:** PERF-REVIEWER subagent  
**Date:** 2026-06-27  
**Scope:** DB query patterns, image processing pipeline, connection-pool budgeting, advisory-lock hold windows, client-side re-renders and event-handler hygiene, service-worker LRU/HEAD revalidation, memory-leak candidates.  
**Exclusions:** Do NOT re-report PERF-16-01 (embedding config reuse) or PERF-17-04 (semanticSearchMode snapshot) — both are confirmed fixed.

---

## Method

Hot-path inventory → file read/grep per path → cost/scenario/fix/confidence per finding. Scale-gated findings are marked `[SCALE]`. Items confirmed correct are documented in the "Confirmed Non-Issues" section so reviewers do not re-audit them.

---

## Findings

---

### PERF-18-01 — `getTopics()` N correlated subqueries for `MAX(updated_at)` (Medium)

**File:** `apps/web/src/lib/data.ts:511–516`  
**Confidence:** High

```sql
-- Emitted once per row in the topics table
SELECT MAX(images.updated_at)
FROM images
WHERE images.topic = topics.slug
AND images.processed = true
```

**Cost:** One correlated subquery per topic row. The `idx_images_topic(topic, processed, capture_date, created_at)` index covers the `WHERE` predicate but does **not** include `updated_at`, so MySQL must read the actual row to evaluate `MAX(updated_at)` for each topic partition. With 10 topics this is 10 index-range scans; with 100 topics it is 100.

**Scenario:** Every call to `getTopicsCached()` / `getTopics()`. In practice this fires on the sitemap route (`revalidate = 3600`), home page SSR, and the admin dashboard. The ISR cache on `/sitemap.xml` means the query fires at most once per hour per route, which makes the real-world frequency low.

**Already acknowledged:** The code carries an `R18-M1` comment documenting the trade-off and why it is accepted at gallery scale with the ISR cache. Documenting here for completeness.

**Fix (if scale requires it):** Replace the correlated subquery with a LEFT JOIN to a derived table:

```sql
SELECT topics.*, tmax.last_updated
FROM topics
LEFT JOIN (
  SELECT topic, MAX(updated_at) AS last_updated
  FROM images WHERE processed = true GROUP BY topic
) AS tmax ON tmax.topic = topics.slug
ORDER BY topics.order ASC
```

One table scan with one `GROUP BY` aggregation instead of N per-topic correlated scans. Requires adding a `(topic, processed, updated_at)` composite index for the derived query to use a covering group-by scan; without it MySQL does the same row probes in batch.

**Priority:** Low/deferred — at personal-gallery scale the ISR cache makes this a non-issue. Revisit if topics grows past ~50 or the sitemap revalidation window is shortened.

---

### PERF-18-02 — `getImagesLitePage()` `COUNT(*) OVER()` materializes full result set before LIMIT (Medium) `[SCALE]`

**File:** `apps/web/src/lib/data.ts` — `getImagesLitePage` function  
**Confidence:** High

```ts
total_count: sql<number>`COUNT(*) OVER()`
```

**Cost:** MySQL 8.0 evaluates `COUNT(*) OVER()` (a window function with no PARTITION BY or ORDER BY) by materializing ALL rows satisfying the `WHERE` predicate into a temporary table, computing the count, and THEN applying `LIMIT`. This is O(N_matching) even when `LIMIT 21` is requested. With 500 photos this is negligible (~2 ms); with 5 000 photos in a topic it becomes a meaningful filesort + temp-table allocation on every SSR render of that page.

**Scenario:** Called on every SSR render of the home page (`[locale]/(public)/page.tsx:166`) and every topic page (`[topic]/page.tsx:176`). `revalidate = 0` means these render dynamically — every visitor hits this query. There is no caching layer between the SSR render and `getImagesLitePage`.

**Trade-off accepted by current code:** Using the window function avoids a second DB round-trip (a separate `SELECT COUNT(*)`). At personal-gallery scale (~400 photos) the temp-table is tiny and the single-round-trip benefit dominates. The approach is sound today.

**Fix (if scale requires it):** Run a parallel `SELECT COUNT(*)` alongside the paginated query via `Promise.all`. The count query uses the covering index `(processed, capture_date, created_at)` or `(topic, processed, capture_date, created_at)` and never reads rows. This adds one network round-trip but eliminates the temp-table materialization on the primary listing query.

```ts
const [rows, [countRow]] = await Promise.all([
    db.select({ ...fields }).from(images)
        .where(predicate).orderBy(...).limit(pageSize + 1),
    db.select({ c: count() }).from(images).where(predicate),
]);
const totalCount = Number(countRow?.c ?? 0);
```

**Priority:** Defer until gallery exceeds ~2 000 processed images or p99 listing latency becomes visible. Worth adding a `// [SCALE]: swap to parallel COUNT when >2000 photos` comment so the trigger is explicit.

---

### PERF-18-03 — `getTopicBySlug()` up to two sequential DB round trips (Low)

**File:** `apps/web/src/lib/data.ts:~1324–1358`  
**Confidence:** Medium

**Cost:** The function first runs a direct `SELECT … FROM topics WHERE slug = ?`. On a miss (topic served under a legacy alias), it runs a second query joining `topicAliases` to `topics`. Two sequential round trips on the critical path of every topic page SSR when aliases are in play.

**Scenario:** Every `getTopicBySlugCached()` call for a topic that has been renamed. React `cache()` deduplicates within a single SSR request, but aliases are permanent in practice and the two-trip path fires on every render after the cache misses.

**Fix:** Combine into a single UNION query:

```sql
(SELECT topics.* FROM topics WHERE topics.slug = ?)
UNION
(SELECT topics.* FROM topics
  INNER JOIN topic_aliases ON topic_aliases.alias = ?
  WHERE topics.slug = topic_aliases.topic)
LIMIT 1
```

One round trip regardless of whether the slug is canonical or an alias. Both sides use indexed lookups (`topics.slug` is the PK; `topic_aliases.alias` is the PK of `topicAliases`).

**Priority:** Low. Aliases are infrequent; React `cache()` deduplicates within a request. Worth fixing when refactoring the topic lookup path.

---

### PERF-18-04 — `processImageFormats()` unconditional fresh `.metadata()` decode adds ~10–30 ms per image job (Low / Documented)

**File:** `apps/web/src/lib/process-image.ts:1049`  
**Confidence:** High

```ts
// R10-C3 / R7-L7
const inputMeta = await sharp(inputPath, {
    limitInputPixels: maxInputPixels, failOn: 'error',
    sequentialRead: true, autoOrient: true,
}).metadata();
```

**Cost:** Opens a fresh Sharp instance (the third across the full upload flow) purely to re-read `width` and `height` for the wide-gamut pixel-count check. For a 24 MP JPEG this costs ~10–30 ms of libvips header parse. This fires for every image processed — including sRGB images where `isWideGamutSource === false` and the pixel count check immediately short-circuits.

**Already acknowledged in code:** R10-C3 ("read BOTH dimensions fresh to avoid mixed-freshness inconsistency") and R7-L7 ("overhead ~10–30 ms for large files is acceptable for the personal-gallery scale and not worth the cross-caller refactor risk"). This is a documented, intentional trade-off.

**Potential optimization (not required):** Accept an optional `cachedDimensions?: { width: number; height: number }` parameter. The upload path already has dimensions from `saveOriginalAndGetMetadata`; the backfill path passes `null` and still does the fresh read. Avoids the extra decode on the upload path without changing backfill behavior. Estimated saving: ~15–20 ms per uploaded image on the upload path.

**Priority:** Defer. Documented as intentional. Only revisit if Sharp metadata latency becomes measurable under profiling.

---

### PERF-18-05 — `detect()` in `use-display-capability.ts` allocates temporary MediaQueryList objects before cache check (Low)

**File:** `apps/web/src/lib/use-display-capability.ts:58–74`  
**Confidence:** High

```ts
} else if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(color-gamut: rec2020)').matches) { ... }
    else if (window.matchMedia('(color-gamut: p3)').matches) { ... }
}
const isHdr = ... window.matchMedia('(dynamic-range: high)').matches ...;
// Value-equality cache check at lines 76-84 fires AFTER the above allocations
if (_cachedSnapshot && _cachedSnapshot.colorGamut === gamut && ...) return _cachedSnapshot;
```

**Cost:** When `screen.colorGamut` is absent (most browsers except Chromium 121+ / Safari 18+ TP), `detect()` calls `window.matchMedia()` 2–3 times before the value-equality cache check can return the existing snapshot. Each call allocates a new `MediaQueryList` object that is immediately eligible for GC if the snapshot is unchanged. Very minor allocation pressure.

**Scenario:** Fires on every `useSyncExternalStore` poll cycle — once per re-render of any component consuming `useDisplayCapability` (Histogram, WideGamutHint, lightbox colour pip).

**Fix:** Move the MQL objects to module-level singletons, initialised once at module load:

```ts
const _mqRec2020 = typeof window !== 'undefined'
    ? window.matchMedia('(color-gamut: rec2020)') : null;
const _mqP3 = typeof window !== 'undefined'
    ? window.matchMedia('(color-gamut: p3)') : null;
const _mqHdr = typeof window !== 'undefined'
    ? window.matchMedia('(dynamic-range: high)') : null;
```

Then `detect()` reads `.matches` from the cached objects and `subscribe()` reuses the same MQL references for event listeners (eliminating PERF-18-07 at the same time). The `_cachedSnapshot` check can then also precede the `.matches` reads for a complete short-circuit.

**Priority:** Low. MQL objects are lightweight. A micro-optimisation worth batching with a related refactor.

---

### PERF-18-06 — Histogram Web Worker created and destroyed on every Histogram mount (Low)

**File:** `apps/web/src/components/histogram.tsx:544–549`  
**Confidence:** High

```ts
useEffect(() => {
    workerRef.current = new Worker(`/histogram-worker.js?v=${IMAGE_PIPELINE_VERSION}`);
    return () => {
        workerRef.current?.terminate();
        workerRef.current = null;
    };
}, []);
```

**Cost:** `new Worker(...)` spawns a new OS thread (or thread-pool entry in modern browsers) and establishes an IPC channel. `terminate()` tears it down. Each open/close of the colour-details panel or lightbox that mounts `<Histogram>` triggers a full worker lifecycle. In Chromium this is typically ~2–5 ms of thread setup. Worker is correctly terminated on unmount — no leak.

**Scenario:** Lightbox with colour details open → close → reopen. Each cycle creates and destroys one worker. Rapid successive opens (flipping through photos in the colour-details panel) create multiple sequential workers.

**Fix:** Hoist the Worker to a module-level singleton, lazy-initialised on first use, shared across all `Histogram` instances. Add a reference-count or a keep-alive duration so it is only terminated when the last consumer unmounts and a reasonable idle period elapses.

**Priority:** Low. Worker lifecycle cost is small and the lightbox is not a hot path in a personal gallery. Worth addressing if open latency on low-end mobile becomes perceptible.

---

### PERF-18-07 — `subscribe()` in `use-display-capability.ts` creates 3 fresh MQL objects per subscription cycle (Low)

**File:** `apps/web/src/lib/use-display-capability.ts:91–101`  
**Confidence:** High

```ts
for (const q of queries) {
    const mq = window.matchMedia(q); // fresh object each call
    mq.addEventListener('change', callback);
    handlers.push(() => mq.removeEventListener('change', callback));
}
```

**Cost:** Three new `MediaQueryList` objects per subscribe call. In React StrictMode (development only) effects run twice, producing 6 MQL allocations. In production, `subscribe` fires once per component mounting `useDisplayCapability`. The cleanup closure captures the MQL references and removes listeners, correctly preventing leaks. The objects are eligible for GC after the cleanup closure runs.

**Same fix as PERF-18-05:** Module-level MQL singletons shared between `detect()` and `subscribe()` eliminate all per-call allocations.

**Priority:** Low. Not a leak; minor GC optimisation, best batched with PERF-18-05.

---

## Confirmed Non-Issues (Cycle 18)

The following items were audited and confirmed correct. Do not re-raise in future cycles without new evidence.

| Item | File / Lines | Verdict |
|------|-------------|---------|
| `viewCountBuffer` Map growth | `data.ts:17` | Bounded at 1 000 (`MAX_VIEW_COUNT_BUFFER_SIZE`); FIFO eviction when cap exceeded. |
| `viewCountRetryCount` Map growth | `data.ts:26` | Bounded at 500 (`MAX_VIEW_COUNT_RETRY_SIZE`); FIFO eviction. |
| `useSyncExternalStore` snapshot stability | `use-display-capability.ts:47–84` | Module-level `_cachedSnapshot` returns the same reference when gamut+isHdr are unchanged. Prevents React error #185 infinite loop. Correctly implemented. |
| Lightbox event listener cleanup | `lightbox.tsx:107–115, 127–132, 279–292, 353–355` | Every `addEventListener` paired with `removeEventListener` in the same effect cleanup. |
| `useColumnCount` resize handler | `home-client.tsx:29–65` | `removeEventListener` + `cancelAnimationFrame` + `mountedRef.current = false` guard all present. Correctly implemented. |
| Double-RAF + setTimeout scroll restore | `home-client.tsx:154–167` | `r1`, `r2`, and `t1` all cancelled in cleanup (`cancelAnimationFrame(r1)`, `cancelAnimationFrame(r2)`, `clearTimeout(t1)`). `cancelled = true` prevents stale calls even if the outer RAF of `r2` has already fired its inner RAF. Correctly implemented — not a UAF risk. |
| Histogram RAF resize handler | `histogram.tsx:447–465` | RAF guarded by `rafId !== null` early-return; `cancelAnimationFrame` called in cleanup. Correct. |
| Histogram worker termination | `histogram.tsx:544–549` | `terminate()` called on unmount. No memory leak. |
| `getGalleryConfig()` per image job | `image-queue.ts:392–413` | Config read ONCE at job bootstrap; all settings captured in local variables before per-format fan-out. `resolvedSemanticMode` snapshot confirmed present (PERF-17-04). |
| Analytics index utilisation ('all' window) | `analytics-data.ts:93–111` | Already deferred with rationale in the code (plan-322 entry 3). Do not re-raise without EXPLAIN evidence. |
| `getTopics()` correlated subquery | `data.ts:511–516` | Acknowledged in code (R18-M1) as accepted trade-off with ISR cache mitigation. |
| PERF-16-01 (embedding config reuse) | — | Fixed in cycle 16. |
| PERF-17-04 (semanticSearchMode snapshot) | — | Fixed in cycle 17. |

---

## Index Audit

All documented query patterns have appropriate indexes in `apps/web/src/db/schema.ts`. No missing indexes detected.

| Index | Columns | Query pattern served |
|-------|---------|---------------------|
| `idx_images_processed_capture_date` | `(processed, capture_date, created_at)` | Home/all-photos listing sort |
| `idx_images_processed_created_at` | `(processed, created_at)` | Prev/next navigation, sitemap |
| `idx_images_topic` | `(topic, processed, capture_date, created_at)` | Topic-filtered listing |
| `idx_images_user_filename` | `(user_filename)` | Upload deduplication |
| `idx_images_uploaded_by` | `(uploaded_by)` | Admin upload attribution |
| `idx_image_tags_tag_id` | `(tag_id)` | Tag JOIN performance |
| `idx_image_views_bot_viewed_country` | `(bot, viewed_at, country_code)` | Analytics country breakdown — covering range scan on windowed queries |
| `idx_image_views_bot_viewed_referrer` | `(bot, viewed_at, referrer_host)` | Analytics referrer breakdown — same |

---

## Connection-Pool and Advisory-Lock Audit

- **Pool size:** 10 connections; queue limit 20; keepalive enabled.
- **In-app backfill concurrency cap:** `max(1, floor((10 − 5 − 1) / 2)) = 2`. Leaves ≥ 5 connections free for live traffic at the default pool size. Formula in `admin-backfill-runner.ts` confirmed correct.
- **Advisory lock hold windows:** `gallerykit_db_restore`, `gallerykit_color_pipeline_backfill`, `gallerykit:image-processing:{jobId}`, `gallerykit_upload_processing_contract`, `gallerykit_topic_route_segments`, `gallerykit_admin_delete` — all acquired on dedicated connections; released automatically on connection close. No unbounded hold windows found.
- **No new concurrency issues detected.**

---

## Service Worker Audit

- **HEAD revalidation timeout:** Bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS)` (300 ms). On slow/hung networks the probe aborts and stale-while-revalidate serves cached bytes immediately; revalidation continues in background. Correctly implemented.
- **LRU image cap:** 50 MB. Bounded.
- **HTML offline fallback cap:** 50 entries, 24 h TTL. Bounded.
- **No new service worker issues found.**

---

## Summary — Severity-Labeled Bullets

- **MEDIUM — PERF-18-01:** `getTopics()` emits N correlated subqueries for `MAX(updated_at)` (one per topic); accepted at gallery scale with ISR cache (R18-M1 doc comment). Revisit if topic count grows past ~50.
- **MEDIUM [SCALE] — PERF-18-02:** `COUNT(*) OVER()` in `getImagesLitePage()` forces MySQL to materialize the full matching row set before applying LIMIT; O(N_matching) temp-table cost on every homepage/topic SSR render. Negligible at <1 000 photos; convert to parallel `SELECT COUNT(*)` query when gallery exceeds ~2 000 images.
- **LOW — PERF-18-03:** `getTopicBySlug()` makes up to two sequential DB round trips (slug miss → alias lookup); can be unified with a single UNION query.
- **LOW — PERF-18-04:** `processImageFormats()` opens an unconditional fresh Sharp `.metadata()` decode (~10–30 ms) even for sRGB images where the wide-gamut check immediately returns false; already documented as deliberate (R10-C3 / R7-L7). No action required.
- **LOW — PERF-18-05:** `detect()` in `use-display-capability.ts` allocates 2–3 temporary `MediaQueryList` objects per call before the value-equality cache check can short-circuit; module-level MQL singletons would eliminate the allocation.
- **LOW — PERF-18-06:** Histogram `Worker` is created and terminated on every Histogram mount/unmount; no leak, but carries ~2–5 ms OS thread setup cost per lightbox open. Consider a module-level singleton if lightbox open latency is perceptible on low-end devices.
- **LOW — PERF-18-07:** `subscribe()` in `use-display-capability.ts` creates 3 fresh `MediaQueryList` objects per subscription cycle; same fix as PERF-18-05 (shared module-level singletons).
