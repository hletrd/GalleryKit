# Cycle-13 Performance Review — GalleryKit

**Reviewer:** PERF-REVIEWER agent  
**Cycle:** 13  
**Date:** 2026-06-27  
**Base commit:** HEAD (master)  
**Scope:** Full-codebase performance, concurrency, and resource review

---

## Prior-Cycle Fix Verification

All cycle-12 perf/resource fixes were verified to have landed and held:

| Finding | Description | Status |
|---------|-------------|--------|
| AGG-R12-01 | Shutdown sentinel timer unref'd + cleared; SIGTERM handler added | CONFIRMED FIXED — `instrumentation.ts:25-31, 51, 73-80` |
| AGG-R12-02 | `_verifyAvifNclx` partial 4096-byte head read | CONFIRMED FIXED — `process-image.ts:251-253`, Buffer.alloc(4096) |
| AGG-R12-04 | DB init-race timer unref'd + cleared on every getConnection() call | CONFIRMED FIXED — `db/index.ts:94-111` |

No regressions detected on prior-cycle work.

---

## New Findings

### PERF-13-01 — N+1 Correlated Subquery in `getTopics()`
**Severity: MEDIUM**  
**File:** `apps/web/src/lib/data.ts:460-495`

`getTopics()` selects all topic rows and then decorates each row with `last_image_updated_at` via a correlated subquery that fires once per topic:

```sql
SELECT MAX(updated_at) FROM images WHERE topic = ? AND processed = true
```

With N topics this becomes N+1 total queries (1 for the topic list, 1 per topic for the `MAX` lookup). The correlated subquery form is noted inline at data.ts:461-465 but the N+1 nature is not resolved.

**Impact:** Every home-page load (which calls `getTopicsCached()`) and every admin topic-listing call traverses N+1 round-trips. At even 20 topics this is 21 queries instead of 1. Latency is multiplied by N plus network RTT per query. Under the 10-connection pool, bursts of concurrent home-page requests race for connections during this fan-out.

**Fix:** Rewrite as a single query with a LEFT JOIN + GROUP BY aggregation:

```sql
SELECT t.*, MAX(i.updated_at) AS last_image_updated_at
FROM topics t
LEFT JOIN images i ON i.topic = t.slug AND i.processed = true
GROUP BY t.slug
ORDER BY t.order ASC
```

Drizzle equivalent: `.leftJoin(images, and(eq(images.topic, topics.slug), eq(images.processed, true)))` + `groupBy(topics.slug)` + `max(images.updated_at)`. This brings N+1 down to a single query at the cost of a hash aggregate, which is negligible compared to N round-trips.

---

### PERF-13-02 — `COUNT(*) OVER()` Window Function Defeats LIMIT in Paginated Queries
**Severity: MEDIUM**  
**Files:** `apps/web/src/lib/data.ts` — `getImagesLitePage()` (~line 843), `getImagesForSmartCollection()` (~line 1368)

Both paginated list functions include `COUNT(*) OVER()` as a window function to return total row count alongside the paged slice. MySQL must materialize the **full filtered result set** into a temporary work table before applying LIMIT — making page 2 fetch cost nearly identical to a full COUNT(*) query. The performance advantage of pagination (only transferring and sorting N rows) is largely negated.

**Impact:** For a gallery with thousands of images, fetching page 2 (rows 25-50) executes the same sort and materialization work as fetching all rows. Memory pressure scales with total matching rows, not page size. Under high concurrency this can cause multiple requests to simultaneously materialize large result sets.

**Fix — two options:**
1. Run a separate `SELECT COUNT(*) FROM images WHERE ...` query in parallel with the page query. Two lightweight queries beat one expensive windowed scan.
2. Switch to cursor-based pagination (pass the last-seen `(capture_date, id)` as a cursor). Eliminates total-count entirely; use "has more" from `LIMIT N+1`.

The separate-count approach requires the fewest call-site changes and is straightforward with `Promise.all`.

---

### PERF-13-03 — Leading-Wildcard `LIKE '%term%'` Forces Full Table Scan in `searchImages()`
**Severity: MEDIUM**  
**File:** `apps/web/src/lib/data.ts:1429-1515`

`searchImages()` constructs `searchTerm = '%' + escaped + '%'` (line 1430) and passes it to `like()` on `images.title`, `images.description`, `images.camera_model`, `images.lens_model`, `images.topic`, `topics.label`, `tags.name`, and `topicAliases.alias`. A leading `%` wildcard prevents MySQL from using any B-tree index on those columns; the engine performs a full table scan for each OR branch.

**Impact:** Search latency scales linearly with the number of images. At a few hundred images this is acceptable; at several thousand it becomes visibly slow and consumes a connection for the duration of the scan (blocking other queries in the 10-connection pool). The three-branch structure (main, tag, alias queries) means up to three concurrent full scans per search request.

**Fix options (increasing complexity):**
1. **Short-term / no-schema-change:** Add `FULLTEXT INDEX` on `(title, description)` in a new migration and use MySQL `MATCH ... AGAINST` for free-text fields. Suffix indexes on `camera_model`/`lens_model` can be replaced with prefix-only `LIKE 'term%'` when those fields are always searched by make/model prefix.
2. **Medium-term:** Migrate to a full-text search approach (MySQL FULLTEXT or a lightweight external index). The semantic search embedding infrastructure already exists for image similarity; a parallel FTS index covers keyword search cleanly.

At personal-gallery scale (hundreds of images) this is acceptable today, but it is the most common complaint in self-hosted gallery software at scale.

---

### PERF-13-04 — `getTopicBySlug()` Runs Two Serial DB Round-Trips When Direct Slug Is Not Found
**Severity: LOW**  
**File:** `apps/web/src/lib/data.ts:1284-1318`

`getTopicBySlug()` first does a direct `topics` lookup by slug, and if no match is found (or if the slug fails `isValidSlug()`), runs a second alias JOIN query. For valid-ASCII slugs that are not direct topic matches but ARE aliases, both queries execute serially. More importantly, for **non-existent slugs** (404 pages, bots probing invalid paths), both queries always fire.

**Impact:** Every 404 on a topic URL causes two DB round-trips. Bot/crawler traffic hitting non-existent topic slugs at volume will double the DB load from these lookups.

**Fix:** Merge both lookups into a single UNION query:

```sql
SELECT t.slug, t.label, t.order, t.image_filename
FROM topics t WHERE t.slug = ?
UNION
SELECT t.slug, t.label, t.order, t.image_filename
FROM topic_aliases ta JOIN topics t ON ta.topic_slug = t.slug
WHERE ta.alias = ?
LIMIT 1
```

This collapses two round-trips into one regardless of whether the slug is a direct match, an alias, or a 404.

---

### PERF-13-05 — Duplicate `getGalleryConfig()` DB Calls from Fire-and-Forget IIFEs Outside React Request Context
**Severity: LOW**  
**File:** `apps/web/src/lib/image-queue.ts:383, 501`

`getGalleryConfig` is wrapped with React `cache()` (`gallery-config.ts:217`), which provides per-request deduplication inside React SSR. However, the image processing queue runs as a Node.js background job with no React request context. Two code paths call `getGalleryConfig()` per processed image:

1. Line 383: the main processing path reads config (quality settings, sizes, etc.)
2. Line 501: the embedding fire-and-forget IIFE independently calls `cfg = await getGalleryConfig()` to check `semanticSearchMode`

Since neither IIFE shares a React request scope with the other, `cache()` does not deduplicate them. Every processed image causes at least 2 separate DB round-trips to read the same `admin_settings` row.

**Impact:** Low but non-zero — each processed image consumes 2 extra DB connections from the shared 10-connection pool during `getGalleryConfig` calls. Under batch-upload concurrency (`QUEUE_CONCURRENCY > 1`) this multiplies.

**Fix:** Pass the already-loaded config object as a parameter from the main processing path into the fire-and-forget hooks:

```typescript
// After the main processing path loads config at line 383:
const resolvedSemanticMode = cfg.semanticSearchMode;
// Pass resolvedSemanticMode into the embedding IIFE instead of re-calling getGalleryConfig()
```

Alternatively, add a short-lived module-level TTL cache (e.g., 5 seconds) in `gallery-config.ts` for the background-process case, since React `cache()` is a no-op outside React request trees.

---

### PERF-13-06 — `NOT IN (up to 1000 IDs)` Predicate in Bootstrap Queue Scan
**Severity: LOW**  
**File:** `apps/web/src/lib/image-queue.ts:691-695`

The bootstrap scan uses `notInArray(images.id, [...state.permanentlyFailedIds])` to exclude permanently-failed image IDs. `permanentlyFailedIds` is capped at `MAX_PERMANENTLY_FAILED_IDS = 1000` with FIFO eviction, so the IN-list can grow to 1000 elements.

**Impact:** MySQL handles IN-lists of a few hundred integers efficiently (integer comparisons against a PK are fast). At 1000 elements the IN-list is at the upper edge of comfortable range. The condition is evaluated at bootstrap only (not on hot-path queries), so the practical impact is currently low. However, if `MAX_PERMANENTLY_FAILED_IDS` is ever raised, this could become a real scan penalty.

**Fix (low priority):** Consider adding a `permanently_failed TINYINT(1)` column to `images` and including it in the bootstrap WHERE clause. This eliminates the in-memory exclusion list entirely and removes the IN-list scaling concern.

---

### PERF-13-07 — `topicViews` Analytics Index Missing `bot` Column, Inconsistent With `image_views`
**Severity: LOW**  
**File:** `apps/web/src/db/schema.ts:234-244`

`image_views` has composite indexes `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)` that efficiently support analytics queries with `WHERE bot = false AND viewed_at >= since`. The `bot` equality predicate is the leading column, enabling the index to narrow to the non-bot slice first before ranging on `viewed_at`.

`topicViews` has only `(topic, viewed_at)` — no `bot` column in the index. The analytics query `getTopTopicsByViews()` filters `WHERE bot = false AND viewed_at >= since GROUP BY topic`. MySQL must scan all rows in the `(topic, viewed_at)` covering index across all topics and filter out bot rows post-range, rather than using an equality-first scan on `bot`.

**Impact:** Windowed topic analytics queries do more work than necessary. At typical analytics table sizes (bounded by `VIEW_RETENTION_DAYS`) this is acceptable, but it diverges from the well-optimized `image_views` index strategy without a documented reason.

**Fix:** Add a migration with a composite index on `topicViews(bot, viewed_at, topic)` mirroring the `image_views` pattern. Update `schema.ts` to declare the new index and add the migration SQL to `drizzle/`.

---

## Architecture and Resource Notes (No New Action Required)

The following areas were reviewed and found correct with no new findings:

- **Rate-limit Maps** (`rate-limit.ts`): All in-memory maps use `createResetAtBoundedMap` / `createWindowBoundedMap` from `bounded-map.ts` with explicit size caps (OG: 2000, Share: 2000, Search: 2000, Semantic: 2000, Login: 5000). Prune callbacks are wired. No unbounded growth paths found.

- **Connection pool** (`db/index.ts`): `POOL_CONNECTION_LIMIT=10`, `queueLimit=20`. The `getConnection()` wrapper correctly unref's and clears the init-race timer (AGG-R12-04 fix held). The `query()`/`execute()` wrappers acquire+release one connection per call — correct and consistent.

- **View-count buffer** (`data.ts`): `MAX_VIEW_COUNT_BUFFER_SIZE=1000` and `MAX_VIEW_COUNT_RETRY_SIZE=500` with `VIEW_COUNT_MAX_RETRIES=3`. Backoff capped. No unbounded growth.

- **`use-display-capability.ts`**: Snapshot memoization (`_cachedSnapshot`) correctly returns the same object reference until the underlying gamut/HDR values change. The `useSyncExternalStore` infinite-loop risk (React #185) is properly mitigated. Three `matchMedia()` calls per detect cycle are synchronous layout reads but bounded.

- **`process-image.ts` WI-15 temp file cleanup**: The wide-gamut downscale intermediate (`*.wi15.tmp`) is cleaned in both the error path (`safeUnlink(tmpPath)` at line 1078) and the `finally` block (`safeUnlink(processingInputPath)` at line 1358-1364 when `processingInputPath !== inputPath`). No orphan temp file risk.

- **`process-image.ts` per-size fresh-decode pattern**: Each unique output size re-opens the source file via a fresh `sharp(processingInputPath, ...)`. This is intentional (WI-14: cross-format isolation to eliminate shared-state contamination) and noted in CLAUDE.md. Hard-link dedup for same-effective-width sizes keeps I/O overhead minimal. Not a new finding.

- **`_verifyAvifNclx` / `_verifyWebpIccChunk`**: Both use partial reads (4096/1024 bytes respectively) via `fs.open()` + `Buffer.alloc()`. The cycle-12 fix eliminated the full-file read. Verified correct.

- **Semantic search brute-force scan**: O(n) cosine similarity bounded by `SEMANTIC_SCAN_LIMIT` (default 2000). Documented and accepted as a known limitation in CLAUDE.md (PERF-7.1, deferred).

- **Analytics 'all' window temp-table aggregation**: Already documented at `analytics-data.ts:93-111` (PERF-R5C2-01, deferred pending EXPLAIN evidence). No change needed this cycle.

- **`instrumentation.ts` shutdown sequence**: SIGTERM and SIGINT handlers correctly guard against duplicate signals with `shutdownInProgress` flag. `flushBufferedSharedGroupViewCounts` is included in the drain `Promise.all`. Exit code correctly reflects clean vs. forced drain. No new issues.

---

## Summary Table

| ID | Severity | Component | Description |
|----|----------|-----------|-------------|
| PERF-13-01 | MEDIUM | `data.ts:getTopics()` | N+1 correlated subquery per topic row for `last_image_updated_at` |
| PERF-13-02 | MEDIUM | `data.ts:getImagesLitePage()`, `getImagesForSmartCollection()` | `COUNT(*) OVER()` window function materializes full result before LIMIT |
| PERF-13-03 | MEDIUM | `data.ts:searchImages()` | Leading-wildcard `LIKE '%term%'` on 6+ columns forces full table scan |
| PERF-13-04 | LOW | `data.ts:getTopicBySlug()` | Two serial queries for valid-but-unmatched and non-existent slugs |
| PERF-13-05 | LOW | `image-queue.ts` fire-and-forget IIFEs | Duplicate `getGalleryConfig()` DB calls outside React request context |
| PERF-13-06 | LOW | `image-queue.ts` bootstrap | `NOT IN (1000 ids)` predicate; acceptable now but scaling risk if cap raised |
| PERF-13-07 | LOW | `schema.ts:topicViews` | Missing `bot`-leading composite index, inconsistent with `image_views` |

**Cycle-12 fixes verified held:** AGG-R12-01 (shutdown), AGG-R12-02 (_verifyAvifNclx partial read), AGG-R12-04 (DB init-race timer).
