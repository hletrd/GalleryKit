# GalleryKit — Perf Reviewer findings (Cycle 14)

**Scope:** `apps/web/src/lib/data.ts`, `lib/image-queue.ts`, `lib/process-image.ts`,
`db/schema.ts`, `lib/analytics-data.ts`, `app/actions/public.ts`,
`app/api/search/semantic/route.ts`, `app/api/search/similar/[id]/route.ts`,
`components/home-client.tsx`.

**Reference:** `.context/plans/cycle-13-plan.md` (PERF-13-01..07 deferred list confirmed);
`.context/reviews/_aggregate.md` (cycle-13 convergence).

---

## Severity table

| ID | Severity | Category | Status | Title |
|----|----------|----------|--------|-------|
| PERF-13-01 | MEDIUM | DB / Query | Confirmed deferred | `getTopics()` correlated MAX subquery |
| PERF-13-02 | MEDIUM | DB / Query | Confirmed deferred | `COUNT(*) OVER()` window in keyset pagination |
| PERF-13-03 | MEDIUM | DB / Query | Confirmed deferred | `LIKE '%term%'` leading-wildcard full scans |
| **PERF-14-01** | **MEDIUM** | **DB / Schema** | **NEW** | **`sharedGroupViews` lacks bot-leading index** |
| PERF-13-04 | LOW | DB / Query | Confirmed deferred | `getTopicBySlug` sequential double round-trip |
| PERF-13-07 | LOW | DB / Schema | Confirmed deferred | `topicViews` lacks bot-leading index |
| PERF-13-05 | LOW | CPU | Confirmed deferred | Embedding IIFE refetches `getGalleryConfig()` |
| PERF-13-06 | LOW | DB / Query | Confirmed deferred | Bootstrap `NOT IN` with up to 1000 permanently-failed IDs |
| **PERF-14-02** | **LOW** | **UI / React** | **NEW** | **`masonryClasses` recomputed on every scroll-driven render** |

---

## Confirmed deferred items (PERF-13-01..07)

All seven items from the cycle-13 deferred list are still present in the code, unmodified.
No cycle-13 commit touched any of them. Short confirm/refute notes below.

### PERF-13-01 — `getTopics()` correlated MAX(updated_at) subquery

- File: `apps/web/src/lib/data.ts` lines ~476–482.
- Still present. The ISR-cached (`revalidate: 3600`) sitemap route is the only
  caller where this matters at scale. The tradeoff (avoid a complex multi-table
  `MAX(updated_at)` JOIN for a once-per-hour regeneration) is documented and accepted.
- Status: deferred, no change.

### PERF-13-02 — `COUNT(*) OVER()` window function in keyset-paginated queries

- Files: `apps/web/src/lib/data.ts` line ~847 (`getImagesLitePage`) and ~1373
  (`getImagesForSmartCollection`).
- Still present. Both append a `COUNT(*) OVER()` window to the SELECT so the
  total row count is returned alongside every page of results. On large galleries
  (10k+ rows) MySQL evaluates the window function over the full filtered result set
  before applying LIMIT, making every load-more request O(n) instead of O(page_size).
- Exit criterion from cycle-13: measure EXPLAIN on the production gallery before
  adding a separate COUNT query and second round-trip.
- Status: deferred, no change.

### PERF-13-03 — `LIKE '%term%'` leading-wildcard full table scans in `searchImages`

- File: `apps/web/src/lib/data.ts` lines ~1434–1557.
- Still present. `searchImages` runs three sequential/parallel queries, all using
  `like(field, searchTerm)` with a `%...%` expression that prevents index use.
  The fan-out pattern (title/description first, then tag + alias in parallel) is
  correct, but the underlying scan complexity is O(n) per query.
- Fix: `FULLTEXT INDEX` on `(title, description)` + `MATCH ... AGAINST`. Deferred
  pending evaluation of MySQL FT vs application-layer tokenisation.
- Status: deferred, no change.

### PERF-13-04 — `getTopicBySlug` sequential double round-trip

- File: `apps/web/src/lib/data.ts` lines ~1294–1330.
- Still present. Two serial DB queries: first a direct slug lookup, then (if
  not found) an alias JOIN. The combined latency is 2x round-trip on cache misses.
  Fix is a single `LEFT JOIN topic_aliases` with a `slug = ? OR alias = ?` OR-predicate.
- Status: deferred, no change.

### PERF-13-05 — Embedding IIFE refetches `getGalleryConfig()` inside the queue job

- File: `apps/web/src/lib/image-queue.ts` ~lines 500–506.
- Still present. The embedding IIFE calls `getGalleryConfig()` a second time after
  the surrounding queue job already loaded config at ~line 383. The config call is
  async and hits the DB for uncached settings values.
- Fix: capture and pass `config` (or `config.semanticSearchMode`) from the outer
  scope into the IIFE closure.
- Status: deferred, no change.

### PERF-13-06 — Bootstrap `NOT IN` with up to 1000 permanently-failed IDs

- File: `apps/web/src/lib/image-queue.ts` ~lines 692–694.
- Still present. The queue bootstrap query excludes permanently-failed images via
  a `NOT IN (permanentlyFailedIds)` clause capped at 1000 entries. Beyond 1000
  entries MySQL serialises the full IN list into the query. Executes once per
  server start, acceptable, but worth converting to a LEFT JOIN exclusion or a
  dedicated column flag long-term.
- Status: deferred, no change.

### PERF-13-07 — `topicViews` lacks bot-leading composite index

- File: `apps/web/src/db/schema.ts` — `topicViews` table definition (lines ~234–243).
- Still present. The only index on `topicViews` is `(topic, viewed_at)`.
  Analytics queries in `analytics-data.ts` lines 65–66 filter
  `WHERE bot = false [AND viewed_at >= ?]`, so `bot` is the leading predicate
  but the index does not start with `bot`. MySQL cannot use the existing index
  for the bot filter and does a full table scan when the table is large.
  `imageViews` has the correct `(bot, viewed_at, country_code)` and
  `(bot, viewed_at, referrer_host)` bot-leading indexes. `topicViews` diverges.
- Status: deferred, no change.

---

## New findings

### PERF-14-01 — `sharedGroupViews` lacks bot-leading index (MEDIUM, HIGH confidence)

**File/line:** `apps/web/src/db/schema.ts` lines 245–254 (table definition);
`apps/web/src/lib/analytics-data.ts` lines 167–176 (`getTopSharedGroupsByViews`).

**Problem:**
The `sharedGroupViews` table has exactly one index:

```
idx_shared_group_views_group_id_viewed_at  ON (groupId, viewed_at)
```

`getTopSharedGroupsByViews` builds this WHERE clause (analytics-data.ts:167–168):

```ts
const whereClause = since
    ? and(eq(sharedGroupViews.bot, false), gte(sharedGroupViews.viewed_at, since))
    : eq(sharedGroupViews.bot, false);
```

`bot` is the leading equality predicate in both forms, but the existing index
starts with `groupId`. MySQL cannot satisfy `bot = false` via the
`(groupId, viewed_at)` index and performs a full table scan filtered to
`bot = false`, then a range filter on `viewed_at`, then a JOIN on
`sharedGroups`, then grouping and aggregation.

This is the exact same structural gap that PERF-13-07 identified on `topicViews`.
PERF-13-07 was scoped only to `topicViews`; `sharedGroupViews` carries the
same defect and was not listed in the cycle-13 deferred items.

`imageViews` already demonstrates the correct fix: two bot-leading covering
indexes — `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)` —
which the analytics-data.ts comment at lines 95–104 explicitly documents as
enabling a covering RANGE SCAN for windowed queries.

**Scale:** Bites when `sharedGroupViews` grows past ~100k rows. Each admin
analytics page load fires `getTopSharedGroupsByViews` plus several concurrent
analytics queries against a single 10-connection pool — at scale this full scan
adds 200–800 ms and holds a connection slot for the duration.

**Fix:** Add a migration with a bot-leading index mirroring the `imageViews` pattern.

Migration SQL (new file `drizzle/NNNN_add_shared_group_views_bot_index.sql`):
```sql
ALTER TABLE shared_group_views
    ADD INDEX idx_shared_group_views_bot_viewed_at (bot, viewed_at);
```

Update `schema.ts` `sharedGroupViews` index block:
```ts
(table) => ({
    idxSharedGroupViewsGroupIdViewedAt: index('idx_shared_group_views_group_id_viewed_at')
        .on(table.groupId, table.viewed_at),
    // NEW — bot-leading index mirrors imageViews pattern (PERF-14-01)
    idxSharedGroupViewsBotViewedAt: index('idx_shared_group_views_bot_viewed_at')
        .on(table.bot, table.viewed_at),
})
```

A fully covering `(bot, viewed_at, groupId)` index would allow the windowed
aggregation to avoid touching the base table entirely (matching the imageViews
comment at analytics-data.ts:95–104), at the cost of a slightly wider index.

**Confidence:** HIGH. Schema confirmed, query confirmed, `imageViews` already
demonstrates the correct fix and the analytics comment explicitly explains why
the bot-leading shape enables a covering range scan.

---

### PERF-14-02 — `masonryClasses` recomputed on every scroll-driven render (LOW, HIGH confidence)

**File/line:** `apps/web/src/components/home-client.tsx` lines 183–235.

**Problem:**
`showBackToTop` state is updated by a `scroll` event listener (lines 184–191)
via `window.addEventListener('scroll', handleScroll, { passive: true })`.
The handler calls `setShowBackToTop` each time the 600 px threshold is crossed
in either direction, triggering a component re-render.

On every such re-render the following computations run without memoization:

- `COLUMN_CLASS_MAP` object literal (lines 220–226) — new object allocation
  on every render even though it is a static constant.
- Five `Math.min` calls producing `colBase / colSm / colMd / colXl / col2xl`
  (lines 214–218), each depending only on `itemCount` and fixed column maxima.
- `masonryClasses` `cn()` call (lines 228–235) — string concatenation over the
  five col* values and two static strings.

`masonryClasses` depends only on `itemCount` (changes on load-more) and
`columnCount` (changes on viewport resize). Neither changes on scroll.

**Scale:** Low. Each individual call is sub-millisecond. On a 200-card gallery
the per-render cost of these string ops is negligible compared to the React
reconciliation of 200 card children. This is a micro-optimisation, not a
measurable bottleneck.

**Fix:** Hoist `COLUMN_CLASS_MAP` out of the component (it is a static constant).
Wrap the five `Math.min` calls and the `cn()` call in a single `useMemo`:

```tsx
// Outside HomeClient:
const COLUMN_CLASS_MAP: Record<number, string> = {
    1: 'columns-1', 2: 'columns-2', 3: 'columns-3',
    4: 'columns-4', 5: 'columns-5',
};

// Inside HomeClient, replacing lines 214–235:
const masonryClasses = useMemo(() => {
    const colBase = Math.min(itemCount, 1);
    const colSm   = Math.min(itemCount, 2);
    const colMd   = Math.min(itemCount, 3);
    const colXl   = Math.min(itemCount, 4);
    const col2xl  = Math.min(itemCount, 5);
    return cn(
        COLUMN_CLASS_MAP[colBase] ?? 'columns-1',
        colSm  !== colBase && (COLUMN_CLASS_MAP[colSm]  ? COLUMN_CLASS_MAP[colSm].replace('columns-', 'sm:columns-')   : 'sm:columns-1'),
        colMd  !== colSm   && (COLUMN_CLASS_MAP[colMd]  ? COLUMN_CLASS_MAP[colMd].replace('columns-', 'md:columns-')   : 'md:columns-1'),
        colXl  !== colMd   && (COLUMN_CLASS_MAP[colXl]  ? COLUMN_CLASS_MAP[colXl].replace('columns-', 'xl:columns-')   : 'xl:columns-1'),
        col2xl !== colXl   && (COLUMN_CLASS_MAP[col2xl] ? COLUMN_CLASS_MAP[col2xl].replace('columns-', '2xl:columns-') : '2xl:columns-1'),
        'gap-4 w-full',
    );
}, [itemCount, columnCount]);
```

**Confidence:** HIGH on the issue; LOW on whether it is worth addressing given
negligible runtime impact.

---

## Final sweep — commonly-missed categories

**Connection pool pressure:** The 10-connection pool (queue limit 20) faces no
new pressure from cycle-14 code. Semantic and similar-search routes fire at most
2 DB queries per request and are rate-limited at 30 req/min/IP. No new unbounded
query loops detected.

**Memory / unbounded Maps:** No new unbounded in-memory collections found.
`loadMoreRateLimit`, `searchRateLimit`, and the view-count buffer all use
`createResetAtBoundedMap` or explicit-cap patterns. All PERF-13-era findings
unchanged.

**Async serialisation:** `processImageFormats` fans AVIF + WebP + JPEG out with
`Promise.all`. Each format's size ladder is serial within the format (correct —
each size may hard-link from the previous). One intentional metadata re-read at
line 1049 (documented tradeoff for backfill compat). No new serial bottlenecks.

**UI / LCP:** Masonry above-fold cards correctly set `loading="eager"` and
`fetchPriority="high"` for `index < columnCount` (home-client.tsx lines 382–383).
`<picture>` sources emit AVIF then WebP then JPEG fallback with correct `sizes`
attribute. No new LCP regression.

**Semantic scan performance:** Both `/api/search/semantic` and
`/api/search/similar/[id]` scan up to `SEMANTIC_SCAN_LIMIT` (2000) rows in JS,
decoding 2048-byte MEDIUMBLOBs to Float32Array and computing dot-product
similarity. This is O(2000 x 512) ~= 1M float ops per request, bounded by the
hard cap and mitigated by the 30 req/min rate limit. The
`idx_image_embeddings_model_version_updated` index on `(modelVersion, updatedAt)`
serves the LIMIT-2000 scan as a single ordered range read. No new finding.

**`sharedGroupViews` bot-leading index** (PERF-14-01): the single actionable new
finding from this sweep.

---

## Conclusion

The codebase has one new indexing gap (PERF-14-01) of the same class as the known
PERF-13-07 — it was simply missed because PERF-13-07 was scoped to `topicViews`
alone. All other cycle-13 deferred items remain valid and unchanged. No new CPU
hotspots, memory leaks, connection-pool pressure points, or UI rendering
regressions were introduced in cycle-14 commits.
