# GalleryKit — Perf Reviewer findings (Cycle 15)

**Scope:** `apps/web/src/lib/data.ts`, `lib/analytics-data.ts`, `lib/image-queue.ts`,
`lib/process-image.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`,
`lib/bounded-map.ts`, `db/schema.ts`, `app/actions/images.ts`,
`components/home-client.tsx`, `components/histogram.tsx`,
`public/sw.template.js`, `lib/sw-cache.ts`.

**Reference:** `.context/plans/cycle-14-plan.md` (PERF-14-01..02 deferred list confirmed);
`.context/reviews/_aggregate.md` (cycle-14 convergence).

---

## Severity table

| ID | Severity | Category | Status | Title |
|----|----------|----------|--------|-------|
| PERF-13-01 | MEDIUM | DB / Query | Confirmed deferred | `getTopics()` correlated MAX subquery |
| PERF-13-02 | MEDIUM | DB / Query | Confirmed deferred | `COUNT(*) OVER()` window in keyset pagination |
| PERF-13-03 | MEDIUM | DB / Query | Confirmed deferred | `LIKE '%term%'` leading-wildcard full scans |
| PERF-14-01 | MEDIUM | DB / Schema | Confirmed deferred | `sharedGroupViews` lacks bot-leading index |
| PERF-13-04 | LOW | DB / Query | Confirmed deferred | `getTopicBySlug` sequential double round-trip |
| PERF-13-07 | LOW | DB / Schema | Confirmed deferred | `topicViews` lacks bot-leading index |
| PERF-13-05 | LOW | CPU | Confirmed deferred | Embedding IIFE refetches `getGalleryConfig()` |
| PERF-13-06 | LOW | DB / Query | Confirmed deferred | Bootstrap `NOT IN` with up to 1000 permanently-failed IDs |
| PERF-14-02 | LOW | UI / React | Confirmed deferred | `masonryClasses` recomputed on every scroll-driven render |
| **PERF-15-01** | **MEDIUM** | **DB / Schema** | **NEW** | **`images` missing `(processed, updated_at)` index — feed + sitemap** |
| **PERF-15-02** | **LOW-MEDIUM** | **UI / React** | **NEW** | **Histogram `resize` handler unthrottled — canvas redraw per pixel** |
| **PERF-15-03** | **LOW-MEDIUM** | **DB / Query** | **NEW** | **`getSharedGroup()` three sequential DB round-trips** |
| **PERF-15-04** | **LOW** | **DB / Schema** | **NEW** | **`getTopPhotosByViews()` no `(bot, viewed_at, imageId)` covering index** |
| **PERF-15-05** | **LOW** | **DB / Query** | **NEW** | **`getImage()` LEFT JOIN on NOT NULL FK — suboptimal cardinality hint** |
| **PERF-15-06** | **LOW** | **CPU** | **NEW** | **Bootstrap legacy path calls `getGalleryConfig()` per job outside request scope** |

---

## Confirmed deferred items (PERF-13-01..07, PERF-14-01..02)

All nine items from the cycle-13/14 deferred list are still present, unmodified.

| Item | Still present | Note |
|------|--------------|-------|
| PERF-13-01 `getTopics()` correlated MAX | Yes | data.ts ~476-482, unchanged |
| PERF-13-02 `COUNT(*) OVER()` window | Yes | data.ts ~847, ~1373, unchanged |
| PERF-13-03 `LIKE '%term%'` scans | Yes | data.ts ~1434-1557, unchanged |
| PERF-13-04 `getTopicBySlug` double RTT | Yes | data.ts ~1294-1330, unchanged |
| PERF-13-05 embedding IIFE config refetch | Yes | image-queue.ts ~500-506, unchanged |
| PERF-13-06 bootstrap `NOT IN` 1000 IDs | Yes | image-queue.ts ~692-694, unchanged |
| PERF-13-07 `topicViews` bot index | Yes | schema.ts ~234-243, unchanged |
| PERF-14-01 `sharedGroupViews` bot index | Yes | schema.ts ~245-254, unchanged |
| PERF-14-02 `masonryClasses` scroll recompute | Yes | home-client.tsx ~183-235, unchanged |

---

## New findings

### PERF-15-01 — `images` missing `(processed, updated_at)` index [MEDIUM, needs migration]

**Files:** `apps/web/src/lib/data.ts:520-525` and `data.ts:835`
**Schema gap:** `apps/web/src/db/schema.ts` — no index on `images` covers `(processed, updated_at)`

Two queries introduced in recent cycles (R17-M2, R18-M1) order or aggregate on `updated_at`
against the `processed=true` slice, but no index supports that access pattern.

**Query 1 — `getLatestImageUpdatedAt()` (data.ts:520-525):**
```ts
.select({ latest: sql<Date | null>`MAX(${images.updated_at})` })
.from(images)
.where(eq(images.processed, true))
```
The existing `(processed, capture_date, created_at)` index is satisfied for the `WHERE processed=true`
predicate, but MySQL must probe every row in that range to compute `MAX(updated_at)` because
`updated_at` is not present in any index. This is an O(N) scan over all processed rows.
Called by the sitemap route (1-hour ISR) — low frequency but grows with gallery size.

**Query 2 — `getImagesForFeed()` (data.ts:835):**
```ts
.orderBy(desc(images.updated_at), desc(images.created_at), desc(images.id))
```
The Atom feed route has `revalidate = 0` (dynamic rendering), so this ORDER BY fires on every
RSS/Atom request from feed aggregators. With no `(processed, updated_at)` index, MySQL performs
a filesort over the entire `processed=true` slice — O(N) sort per request.

**Scale scenario:** At 1 000 processed images, each feed request sorts ~1 000 rows.
At 10 000 images with three feed-polling clients hitting the endpoint hourly, this
becomes 30 000 O(N) filesort operations per day on the largest slice of the table.

**Fix:** One composite index serves both queries:
```sql
ALTER TABLE images ADD INDEX idx_images_processed_updated_at (processed, updated_at);
```
Drizzle schema addition in `db/schema.ts`:
```ts
index('images_processed_updated_at_idx').on(images.processed, images.updated_at),
```
With this index, `WHERE processed=true ORDER BY updated_at DESC` becomes an index range scan
(last-to-first traversal) and `MAX(updated_at)` becomes an index tail probe.

**Confidence:** HIGH | **Migration required:** YES

---

### PERF-15-02 — Histogram `resize` handler unthrottled: canvas redraw per resize pixel [LOW-MEDIUM]

**File:** `apps/web/src/components/histogram.tsx:440-448`

```ts
useEffect(() => {
    function updateDims() {
        const isDesktop = window.innerWidth >= 768;
        setCanvasDims(isDesktop ? { width: 320, height: 160 } : { width: 240, height: 120 });
    }
    updateDims();
    window.addEventListener('resize', updateDims);
    return () => window.removeEventListener('resize', updateDims);
}, []);
```

`updateDims` is called on every `resize` event with no rAF debounce. On each call it
invokes `setCanvasDims({ width, height })` with a **new object literal**. React uses
`Object.is` for state comparison; since every call creates a new object reference,
React considers the state changed even if `width` and `height` are identical to the
prior render (i.e., the breakpoint hasn't crossed 768px). This triggers:

1. React re-render of `Histogram`
2. The `canvasDims` dependency in the draw `useEffect` fires
3. `drawHistogram()` runs: `clearRect` + up to three 256-iteration channel path
   draws + grid lines + clip-percentage analysis

On a smooth resize drag at 60 fps, this sequence can execute 30–60 times per second
while the histogram panel is open (Color Details accordion expanded).

**Contrast:** `useColumnCount` in `home-client.tsx:51-57` wraps its update callback in
`requestAnimationFrame`, coalescing rapid resize events to at most one state update
per animation frame. The histogram component does not apply the same pattern.

**Fix (two parts):**

Part A — rAF debounce on the event listener:
```ts
let rafId: number | null = null;
const debouncedUpdate = () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => { updateDims(); rafId = null; });
};
window.addEventListener('resize', debouncedUpdate);
return () => {
    window.removeEventListener('resize', debouncedUpdate);
    if (rafId !== null) cancelAnimationFrame(rafId);
};
```

Part B — stable state reference to avoid spurious re-renders when breakpoint hasn't crossed:
```ts
setCanvasDims(prev => {
    const next = isDesktop ? { width: 320, height: 160 } : { width: 240, height: 120 };
    return (prev.width === next.width && prev.height === next.height) ? prev : next;
});
```

**Impact scope:** Only affects users who have the Color Details accordion open while
resizing the browser window (photographer audit workflow). Not on the public browsing
hot path. Severity is LOW-MEDIUM due to the canvas redraw cost per event.

**Confidence:** HIGH | **Migration required:** NO

---

### PERF-15-03 — `getSharedGroup()` three sequential DB round-trips [LOW-MEDIUM]

**File:** `apps/web/src/lib/data.ts` (~lines 1226-1317)

The shared-group page loader makes three consecutive DB queries, each waiting for
the previous to return:

1. `SELECT ... FROM shared_groups WHERE key = $shareKey` → yields `group`
2. `SELECT ... FROM shared_group_images WHERE group_id = $group.id ORDER BY sort_order` → yields `imageIds`
3. Batch tag fetch: `SELECT ... WHERE image_id IN ($imageIds)` → yields tags per image

Query 2 requires `group.id` from Query 1 — cannot be parallelized with the current
structure. Query 3 requires the `imageIds` from Query 2. All three are thus serial.

This is `3 × RTT` per shared-group page load. At `revalidate = 0` (dynamic rendering),
every request — including bot/crawler hits on public share links — pays this cost.

**Fix options:**

Option A (minimal, no migration) — collapse queries 1+2 into a single JOIN:
```ts
// Returns group columns + array of image_ids via GROUP_CONCAT
const result = await db
    .select({ ...groupFields, imageIds: sql`GROUP_CONCAT(sgi.image_id ORDER BY sgi.sort_order)` })
    .from(sharedGroups)
    .leftJoin(sharedGroupImages, eq(sharedGroupImages.groupId, sharedGroups.id))
    .where(eq(sharedGroups.key, shareKey))
    .groupBy(sharedGroups.id);
```
Query 3 (tags) can then run concurrently with no dependency.

Option B (full) — single three-way JOIN query with GROUP_CONCAT for tags, matching
the pattern used in `getImagesLite`. Returns everything in one round-trip.

**Scenario:** A shared portfolio link shared on social media gets 100 concurrent
visitors during a repost event. Each request serializes through 3 × ~1 ms DB
round-trips = ~3 ms/request instead of ~1 ms. At 100 req/s this adds 200 ms of
cumulative sequential DB hold time per second, increasing connection contention on
the 10-connection pool.

**Confidence:** HIGH | **Migration required:** NO

---

### PERF-15-04 — `getTopPhotosByViews()` no covering index for GROUP BY imageId [LOW]

**File:** `apps/web/src/lib/analytics-data.ts:28-54`

The top-photos analytics query:
```ts
.where(and(eq(imageViews.bot, false), gte(imageViews.viewed_at, since)))
.groupBy(imageViews.imageId, images.title, images.topic)
.orderBy(desc(sql`viewCount`))
```

The `image_views` table has `(bot, viewed_at, country_code)` and
`(bot, viewed_at, referrer_host)` bot-leading indexes (correctly noted in
analytics-data.ts comments). These serve the country/referrer breakdown queries.
Neither covers the `imageId` GROUP BY column used in `getTopPhotosByViews`.

MySQL uses the `(bot, viewed_at, country_code)` index for the `bot=false AND
viewed_at >= since` range scan, then must perform a filesort/temp-table
aggregation keyed on `imageId`. This is an extra O(range_rows) sort step after
the range scan.

**Note:** `imageViews` already has an `(imageId, viewed_at)` index, but it cannot
serve this query because `bot = false` is not its leading column — MySQL cannot
use both the bot-leading range scan AND the imageId-ordered scan simultaneously.

**Fix:** Add `(bot, viewed_at, imageId)` composite index on `image_views`:
```sql
ALTER TABLE image_views
    ADD INDEX idx_image_views_bot_viewed_at_image_id (bot, viewed_at, image_id);
```
This makes the windowed aggregation a covering range scan with the GROUP BY column
adjacent, eliminating the filesort step.

**Impact scope:** Admin analytics page only — low traffic, bounded by
`VIEW_RETENTION_DAYS` (default 395 days). Severity is LOW because this is
admin-only and the current sort step is bounded. Grouped with PERF-14-01 /
PERF-13-07 for schema migration batching.

**Confidence:** HIGH | **Migration required:** YES

---

### PERF-15-05 — `getImage()` LEFT JOIN on NOT NULL FK column [LOW]

**File:** `apps/web/src/lib/data.ts:~1006`

```ts
.leftJoin(topics, eq(images.topic, topics.slug))
```

`images.topic` is defined with a NOT NULL FK constraint referencing `topics.slug`.
A LEFT JOIN preserves `images` rows that have no matching topic — which cannot occur
given the NOT NULL FK constraint. Using INNER JOIN communicates to MySQL's optimizer
that every `images` row has exactly one matching `topics` row, allowing better
join-order and cardinality estimates. With a LEFT JOIN, MySQL may choose a less
efficient join order assuming potential NULLs from the right side.

At typical personal-gallery scale (≤ 10 topics) the difference is negligible.
Flagged as a semantic correctness issue and a latent optimizer hint for larger
topic counts.

**Fix:** Change to `innerJoin`:
```ts
.innerJoin(topics, eq(images.topic, topics.slug))
```

**Confidence:** HIGH | **Migration required:** NO | **Impact:** Negligible at current scale

---

### PERF-15-06 — Bootstrap legacy path calls `getGalleryConfig()` per job outside React `cache()` scope [LOW]

**File:** `apps/web/src/lib/image-queue.ts:~379-399`

```ts
if (!quality && !imageSizes) {
    // Bootstrap / legacy re-enqueue path
    const config = await getGalleryConfig();
    quality = { webp: config.imageQualityWebp, ... };
    ...
}
```

`getGalleryConfig` is exported as `cache(_getGalleryConfig)` (React `cache()` from `react`).
React's `cache()` deduplicates calls within a single SSR render tree / request context via
AsyncLocalStorage. Background image-queue workers (setInterval, process callbacks) run
outside any request scope. React's `cache()` behavior outside a request scope is
implementation-specific: it may fall back to a module-level singleton (first call cached
for the process lifetime) or it may be a no-op (fresh DB hit on every call).

In the no-op case, up to `BOOTSTRAP_BATCH_SIZE = 500` images each trigger a fresh
`SELECT * FROM admin_settings` query during bootstrap. At QUEUE_CONCURRENCY=1 these
are serial, not concurrent — so they don't cause pool contention, but they represent
500 unnecessary DB round-trips for configuration that does not change between jobs.

**Relationship to PERF-13-05:** PERF-13-05 identified the embedding IIFE at
image-queue.ts:~500-506 as a second `getGalleryConfig()` call inside the same job.
This finding identifies the bootstrap entry point at ~383 as a third distinct
call site where a per-job re-fetch occurs.

**Fix:** Hoist the config load to the bootstrap scan level, above the per-job loop:
```ts
// In the bootstrap scanner, load once before enqueueing all legacy jobs
const bootstrapConfig = await getGalleryConfig().catch(() => null);
// Pass bootstrapConfig as a parameter to each enqueued job
// so jobs use it directly and skip the per-job getGalleryConfig() call
```

**Confidence:** MEDIUM (React `cache()` out-of-request behavior is undocumented;
actual impact may be zero if module-level caching applies) | **Migration required:** NO

---

## Final sweep — commonly-missed categories

**Connection pool pressure:** No new unbounded query loops or long-held connection
patterns found in cycle-15 commits. `processImageFormats` fans out with `Promise.all`
per format correctly. Shared-group sequential RTTs (PERF-15-03) are serial DB queries,
not concurrent pool exhaustion events.

**Memory / unbounded Maps:** No new unbounded in-memory collections found.
Rate-limit Maps (`loginRateLimit`, `searchRateLimit`, `ogRateLimit`, `shareRateLimit`,
`semanticRateLimit`, `accountLoginRateLimit`, `passwordChangeRateLimit`) all use
bounded patterns with explicit caps and prune hooks. `viewCountRetryCount` Map is
bounded at `MAX_VIEW_COUNT_RETRY_SIZE = 500`. All PERF-13/14 findings unchanged.

**Service worker:** LRU eviction correctly bounded at 50 MB image cache + 50 HTML
entries. HEAD revalidation is bounded by `AbortSignal.timeout(300ms)`. No unbounded
scan patterns found. SW is clean.

**Image pipeline:** Sharp concurrency capped at `max(1, floor((cpuCount-1)/3))`.
`sharp.cache(false)` prevents libvips cache pin. 10-bit AVIF probe is a
Promise singleton (no race on concurrent jobs). No new serial bottlenecks detected.

**LCP / render critical path:** Masonry above-fold cards set `loading="eager"` and
`fetchPriority="high"` for `index < columnCount` (home-client.tsx:~382-383).
`<picture>` sources emit AVIF → WebP → JPEG with correct `sizes` attribute. No regression.

**Semantic scan:** Both `/api/search/semantic` and `/api/search/similar/[id]` are
bounded at `SEMANTIC_SCAN_LIMIT = 2000` rows and rate-limited at 30 req/min/IP.
The `(modelVersion, updatedAt)` index serves the LIMIT-2000 scan as a single ordered
range read. No new finding.

**Batch delete (actions/images.ts):** `getSharedGroupKeysForImages(foundIds)` executes
before the delete transaction — one extra pre-transaction round-trip, but it's a
keyed lookup on a small set. Cleanup uses bounded concurrency (`CLEANUP_CONCURRENCY=5`).
No new finding beyond a micro-level observation.

---

## Prioritized action list

1. **[MEDIUM + MIGRATION]** Add `(processed, updated_at)` index to `images` — fixes `getImagesForFeed` filesort and `getLatestImageUpdatedAt` MAX scan (PERF-15-01).
2. **[LOW-MEDIUM]** Fix histogram `resize` handler: rAF debounce + stable state object to eliminate per-pixel canvas redraws (PERF-15-02). No migration.
3. **[LOW-MEDIUM]** Collapse `getSharedGroup()` queries 1+2 into a single JOIN — reduces 3 serial round-trips to 2 per shared-group page load (PERF-15-03). No migration.
4. **[LOW + MIGRATION]** Add `(bot, viewed_at, imageId)` index on `image_views` — fixes `getTopPhotosByViews` GROUP BY filesort; batch with PERF-14-01 / PERF-13-07 schema migration (PERF-15-04).
5. **[LOW]** `getImage()` LEFT JOIN → INNER JOIN on topics NOT NULL FK (PERF-15-05). No migration, trivial change.
6. **[LOW]** Hoist `getGalleryConfig()` out of bootstrap per-job path; investigate same for PERF-13-05 embedding IIFE in same function (PERF-15-06). No migration.
