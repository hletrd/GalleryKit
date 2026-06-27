# Performance Review — Cycle 19

**Reviewer:** PERF-REVIEWER subagent
**Date:** 2026-06-27
**Scope:** `apps/web/src/lib/data.ts`, `lib/smart-collections.ts`, `app/actions/topics.ts`, `lib/process-image.ts`, `lib/image-queue.ts`, `lib/admin-backfill-runner.ts`, `lib/rate-limit.ts`, `lib/bounded-map.ts`, `components/photo-viewer.tsx`, `components/histogram.tsx`, `components/lightbox.tsx`, `lib/use-display-capability.ts`, `components/home-client.tsx`
**Exclusions:** Do NOT re-report PERF-16-01, PERF-17-04. Items in the cycle-18 Confirmed Non-Issues table are not repeated unless new evidence emerges.

---

## Method

Full read of every target file listed above. Cost/scenario/fix/confidence for each new finding. Scale-gated findings marked `[SCALE]`. Tracked items from prior cycles acknowledged; confirmed-resolved items noted.

---

## Tracked Items — Prior Cycles (acknowledged, no new action)

| ID | Location | Status |
|----|----------|--------|
| PERF-18-01: `getTopics()` N correlated `MAX(updated_at)` subqueries | `data.ts:511–516` | Open; ISR cache mitigates at gallery scale (R18-M1 doc comment). |
| PERF-18-02: `COUNT(*) OVER()` in `getImagesLitePage` materializes full row set | `data.ts:883` | Open; accepted trade-off at <2 000 photos. |
| PERF-18-03: `getTopicBySlug()` two sequential round trips | `data.ts:1324–1358` | Open; alias lookup is uncommon path. |
| PERF-18-05 / PERF-18-07: MQL allocations in `use-display-capability.ts` | `use-display-capability.ts:58–74, 91–101` | Open; Low priority, awaiting batched refactor. |
| PERF-18-06: Histogram Worker created per mount | `histogram.tsx:544–549` | **Resolved in current HEAD.** Worker is created once per mount via `useEffect([], [])` (empty dependency array), terminated on unmount. Not recreated per image change. Confirmed in cycle-19 read. |

---

## New Findings

---

### PERF-C19-01 — `getImagesForSmartCollection` fires `COUNT(*) OVER()` on every cursor/load-more page `[SCALE]` (Medium)

**File:** `apps/web/src/lib/data.ts:1408`
**Confidence:** High

```ts
const baseQuery = db.select({
    ...publicSelectFields,
    tag_names: tagNamesAgg,
    total_count: sql<number>`COUNT(*) OVER()`,   // ← fires on every load-more
})
```

The comment at lines 1394–1396 documents that forking the select shape for cursor pages "was explicitly rejected (perf/architect, run4-cycle5)." This finding does not re-litigate that decision but documents the current cost as the collection grows.

**Cost:** MySQL evaluates `COUNT(*) OVER()` by materializing all rows satisfying `compiledCondition` into a temporary table before applying `LIMIT`. On the first page this is necessary to return `totalCount`. On every subsequent cursor load-more page the total has not changed, yet the full matching set is still materialized server-side. For a smart collection with an expensive `compiledCondition` (e.g., nested tag IN subqueries, date ranges), this doubles the query cost per scroll event.

**Scenario where it bites:** A photographer defines a smart collection via multiple tag predicates that matches 400 photos. Each of 4 load-more scrolls re-scans the full 400-row matching set for the window function even though the client already knows `totalCount = 400`.

**Suggested fix (if architect decision is revisited):** Pass `offsetOrCursor` down to the select shape — when a cursor is present, replace `COUNT(*) OVER()` with `sql<number>\`NULL\`` (returning the already-known total from the previous page via the client) or run only a single extra round-trip `SELECT COUNT(*)` on the first page. The code comment should be updated to note that the decision remains open at larger collection sizes.

---

### PERF-C19-02 — Bootstrap scan sends `NOT IN (…)` with up to 1 000 literals per 30-second polling cycle (Low)

**File:** `apps/web/src/lib/image-queue.ts:716–718`
**Confidence:** High

```ts
if (state.permanentlyFailedIds.size > 0) {
    baseConditions.push(notInArray(images.id, [...state.permanentlyFailedIds]));
}
```

`state.permanentlyFailedIds` is an in-memory `Set` bounded at `PERMANENT_FAILURE_CAP` (1 000 entries). When non-empty, Drizzle's `notInArray` compiles to a `NOT IN (id1, id2, …, idN)` clause with up to 1 000 integer literals in the SQL wire string. This fires on every bootstrap scan cycle (every ~30 seconds).

**Cost:** 1 000 integer literals add ~5–7 KB to the SQL wire per cycle, plus MySQL's per-literal parse overhead for the IN list. At typical failure volumes (< 10 permanently-failed images) the impact is negligible. At the cap (1 000 failed images, e.g. after ingesting a corrupted batch), each 30-second scan sends and parses the full list for the process's lifetime (the Set is in-memory only; not cleared between scans).

**Scenario where it bites:** A batch upload of 1 000 unsupported or corrupted HEIC files fails on every processing attempt until they are deleted from the DB. The bootstrap loop thereafter burns ~5 KB of wire + MySQL parse overhead every 30 seconds indefinitely, until the next process restart or the images are manually deleted.

**Suggested fix:** Add a `permanently_failed TINYINT(1) NOT NULL DEFAULT 0` column to `images` (new migration). The bootstrap query becomes `WHERE processed = 0 AND permanently_failed = 0`, which uses the existing `(processed, capture_date, created_at)` composite index cleanly, eliminates the IN list entirely, and persists across restarts. The in-memory `Set` can be retained as a fast-path skip guard alongside the DB column.

---

### PERF-C19-03 — `updateTopic` slug rename serially awaits N smart-collection UPDATE queries inside a held advisory lock (Low)

**File:** `apps/web/src/app/actions/topics.ts:301–327`
**Confidence:** Medium

```ts
const collections = await tx.select({ id, query_json }).from(smartCollections);
for (const collection of collections) {
    const remapped = remapTopicSlugInQuery(JSON.parse(collection.query_json), …);
    if (remapped.changed) {
        await tx.update(smartCollections)   // ← sequential await inside loop
            .set({ query_json: JSON.stringify(remapped.query) })
            .where(eq(smartCollections.id, collection.id));
    }
}
```

The loop `await`s each UPDATE sequentially — N serial DB round-trips while holding both a DB transaction lock and the `gallerykit_topic_route_segments` MySQL advisory lock (5-second acquire timeout).

**Cost:** At 50 smart collections referencing the renamed slug, this holds the advisory lock for 50 × RTT (typically 1–3 ms/RTT on localhost MySQL = 50–150 ms). Other topic mutations that need the advisory lock queue behind it for that window.

**Scenario where it bites:** A photographer renames a frequently-used topic (e.g., "landscapes") that appears in 30 smart collections. The rename action stalls for ~100 ms; a concurrent admin rename attempt on a different topic waits on the advisory lock.

**Suggested fix:** Batch the updates with `Promise.all`:

```ts
await Promise.all(
    changedCollections.map(({ id, newJson }) =>
        tx.update(smartCollections)
            .set({ query_json: newJson })
            .where(eq(smartCollections.id, id))
    )
);
```

Reduces lock hold time from O(n × RTT) to O(1 × RTT) regardless of the number of changed collections. The transaction semantics are unchanged; all UPDATEs still commit or roll back atomically.

---

### PERF-C19-04 — `drawHistogram` RGB mode allocates a 768-element temporary array on every canvas redraw (Low)

**File:** `apps/web/src/components/histogram.tsx:271`
**Confidence:** High

```ts
const maxAll = [...data.r, ...data.g, ...data.b].reduce((m, v) => v > m ? v : m, 1);
```

Spreading three 256-element typed-array bins into a 768-element temporary array to find the shared maximum, on every call to `drawHistogram`.

**Cost:** ~6 KB temporary allocation on every redraw. V8 minor GC handles this without pause, but it is avoidable. `drawHistogram` fires on: histogram data arrival (photo change), mode toggle (RGB ↔ luminance), theme change, and canvas resize breakpoint crossings.

**Scenario where it bites:** Not a practical bottleneck on any device. Pure code quality.

**Suggested fix:**

```ts
const maxR = data.r.reduce((m, v) => v > m ? v : m, 1);
const maxG = data.g.reduce((m, v) => v > m ? v : m, maxR);
const maxAll = data.b.reduce((m, v) => v > m ? v : m, maxG);
```

Three sequential in-place passes over existing 256-element arrays; zero temporary allocation.

---

### PERF-C19-05 — `useDisplayCapability` registers 5 event listeners per consumer; 4 concurrent consumers on photo-viewer = 20 active listeners (Low / informational)

**File:** `apps/web/src/lib/use-display-capability.ts:87–116`
**Confidence:** Medium

`subscribe()` registers per-consumer:
- 3 × `matchMedia.addEventListener('change', callback)` for `(color-gamut: p3)`, `(color-gamut: rec2020)`, `(dynamic-range: high)`
- 1 × `document.addEventListener('visibilitychange', callback)`
- 1 × `window.addEventListener('focus', callback)`

On the photo-viewer page, at least 4 components call `useDisplayCapability()` concurrently: `photo-viewer.tsx`, `histogram.tsx`, `wide-gamut-hint.tsx`, `lightbox-color-pip.tsx`. This registers 20 event listeners for the same underlying state.

**Cost:** `window.focus` fires on every tab-switch. With 4 subscriptions, each focus event triggers 4 callbacks → 4 calls to `getSnapshot()` → 4 calls to `detect()`. The module-level `_cachedSnapshot` value-compares on the first call and returns the same reference on subsequent calls, so no re-renders are caused. The 4 × 3 DOM reads (`screen.colorGamut` + 3 `matchMedia.matches`) per focus event are trivially cheap. No leak: all listeners are removed on unmount.

**Scenario where it bites:** Not a practical issue at gallery scale. Informational only.

**Suggested fix (optional, not urgent):** Hoist to a shared singleton subscription that maintains one internal subscriber set and registers only 5 listeners total regardless of consumer count. Pattern used by `jotai` and similar `useSyncExternalStore` wrappers. Not worth the refactor complexity for 4 consumers.

---

## Pipeline, Connection Pool, and Advisory Lock (clean)

**`process-image.ts`:** `sharp.concurrency()` set once at module load with the `(cpuCount - 1) / 3` divisor for 3-format fan-out. `sharp.cache(false)` prevents RSS growth. 10-bit AVIF probe is a `Promise` singleton. Per-format fresh `sharp()` instances for cross-format isolation (WI-14). No new issues.

**`admin-backfill-runner.ts`:** Connection-budget cap arithmetic (`resolveBackfillConcurrency`, pool-10 → effective cap 2) is correct. Advisory lock acquired on a dedicated connection, released on close. No new issues.

**`rate-limit.ts`:** Multiple `BoundedMap`-backed maps; all bounded, all FIFO-evicting on cap. `BoundedMap.get()` shallow-copy allocation (PERF-18 MQL item) is tracked; no new evidence changes its priority. No unbounded growth paths found.

**`bounded-map.ts`:** `enforceHardCap()` is O(excess), practically O(1) at normal eviction rates. `prune()` is O(n) but gated on time/size threshold. No new issues.

---

## Client-Side (clean)

**`photo-viewer.tsx`:** `blurStyle` is `useMemo`-wrapped (line 155). Prefetch effect uses `requestIdleCallback` with 3 000 ms timeout + 1 500 ms fallback (line 238-270). Preload link elements are DOM-level cleaned up on effect re-run. Navigation callbacks are `useCallback`-memoized. No new issues.

**`home-client.tsx`:** `useColumnCount` uses rAF-debounced resize with breakpoint-stable state update and `mountedRef` cleanup. Scroll restoration reads/removes from `sessionStorage` on mount. `handleLoadMore` is stable via `useCallback`. No new issues.

**`lightbox.tsx`:** Timer refs (`slideshow`, `hide`) cleaned up on unmount. Keyboard and swipe handlers attached via `useEffect` with correct dependency arrays. No new issues.

**`histogram.tsx`:** Worker lifecycle is correct — created once per mount (`useEffect([], [])`), terminated on unmount; this resolves the PERF-18-06 tracked item. `rAF`-debounced resize handler with breakpoint guard. Canvas P3 options hoisted to module scope (lines 79–81). New finding: PERF-C19-04 (temporary array spread in RGB mode redraw).

**`use-display-capability.ts`:** Snapshot memoization via `_cachedSnapshot` is correctly implemented — returns same object reference when value is unchanged, preventing `useSyncExternalStore` infinite loop (React #185). 5-listener-per-consumer pattern is noted as PERF-C19-05 (Low/informational).

---

## Confirmed Non-Issues (Cycle 19, continuing from prior cycles)

| Item | File | Verdict |
|------|------|---------|
| `viewCountBuffer` Map growth | `data.ts:17` | Bounded at 1 000 (`MAX_VIEW_COUNT_BUFFER_SIZE`). |
| `viewCountRetryCount` Map growth | `data.ts:26` | Bounded at 500 (`MAX_VIEW_COUNT_RETRY_SIZE`). |
| `useSyncExternalStore` snapshot stability | `use-display-capability.ts:47–84` | Module-level `_cachedSnapshot`; same reference on no-change. Correct. |
| Lightbox event-listener cleanup | `lightbox.tsx` | Every `addEventListener` paired with `removeEventListener` in cleanup. |
| `useColumnCount` resize handler | `home-client.tsx:29–65` | `removeEventListener` + `cancelAnimationFrame` + `mountedRef` guard. Correct. |
| `double-RAF + setTimeout` scroll restore | `home-client.tsx:154–167` | `r1`, `r2`, `t1` all cancelled in cleanup; `cancelled` guard prevents stale calls. Correct. |
| Histogram RAF resize handler | `histogram.tsx:447–465` | RAF guarded; `cancelAnimationFrame` on cleanup. Correct. |
| `getGalleryConfig()` per image job | `image-queue.ts:392–413` | Config captured once per bootstrap; passed down to per-format fan-out. Correct. |
| `tagNamesAgg` GROUP_CONCAT shape | `data.ts:650` | Shared constant prevents correlated-subquery drift; contract locked by test. |
| `smart-collections.ts` IN subqueries | `smart-collections.ts:248–272` | Bounded: `MAX_DEPTH=4`, `MAX_IN_VALUES=100`, admin-only operations. Acceptable. |
| `topicRouteSegmentExists()` | `topics.ts:38–60` | Single `UNION ALL … LIMIT 1` — not two sequential SELECTs. Correct. |

---

## Summary

Cycles 3–18 closed all critical and high-severity perf issues. Cycle 19 finds no critical or high items.

- **PERF-C19-01** is a Medium `[SCALE]` item where smart-collection listings fire `COUNT(*) OVER()` redundantly on cursor/load-more pages; noted but protected by an existing architect decision.
- **PERF-C19-02** through **PERF-C19-05** are Low items; PERF-C19-02 (bootstrap NOT IN with 1 000 literals) and PERF-C19-03 (serial UPDATEs under advisory lock in topic rename) are the most straightforward to fix.
- **PERF-18-06** (histogram worker recreate) is confirmed resolved in current HEAD.

---

## Compact Finding Index

- **PERF-C19-01** — Medium [SCALE], High confidence — `getImagesForSmartCollection` fires `COUNT(*) OVER()` on every cursor page — `data.ts:1408`
- **PERF-C19-02** — Low, High confidence — Bootstrap scan spreads up to 1 000 permanently-failed IDs into `NOT IN (…)` every 30 s — `image-queue.ts:716–718`
- **PERF-C19-03** — Low, Med confidence — Topic slug rename serially awaits N smart-collection UPDATEs under advisory lock — `topics.ts:301–327`
- **PERF-C19-04** — Low, High confidence — `drawHistogram` RGB mode spreads 3 × 256 bins into 768-element temp array per redraw — `histogram.tsx:271`
- **PERF-C19-05** — Low, Med confidence — `useDisplayCapability` registers 5 listeners per consumer; 4 concurrent consumers on photo-viewer = 20 active listeners — `use-display-capability.ts:87–116`
- **PERF-18-06** — RESOLVED — Histogram worker is created once per mount (empty dep array); not recreated per image change — `histogram.tsx:544–549`
