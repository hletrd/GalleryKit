# PERF-REVIEWER — Run-5 Cycle-2 Deep Review

**Angle:** performance, race conditions, CPU overload, memory effectiveness, UI responsiveness, DB query shapes, caching.
**Repo:** GalleryKit (Next.js 16 / React 19 / TS, MySQL 8 + Drizzle, Sharp pipeline, single-instance Docker).
**Method:** Read CLAUDE.md (authoritative) + plan-315/316/317 suppression set FIRST. Gave the cycle-1 diff (`b7d4729b..HEAD`, 20 commits) extra scrutiny; then swept the whole perf surface (DB layer, image pipeline, queue, SW, React render paths, rate limiters, bounded maps, analytics flush/insert).

**Headline:** The cycle-1 changes are clean and net-positive. The backfill keyset pagination, the analytics index + reconcile mirror, the process-image unlink-on-throw, and the photo-title regex hoist are all correct and improve (not regress) performance. No CRIT and no HIGH from the fresh changes. The findings below are MED/LOW nuances, mostly on the *brand-new* analytics index column ordering and the backfill candidate scan.

---

## Suppression cross-check (NOT re-reported as new)

Verified these are already tracked; intentionally excluded from findings:

- **SW warm-cache paint still blocks on the HEAD probe** (`public/sw.template.js:207-230`, `staleWhileRevalidateImage` awaits `fetch(... HEAD ...)` BEFORE returning cached bytes). This is exactly **plan-502 (plan-315) Item 16 / PERF-R5C1-07 (+COR-R5C1-05)** — "un-block SW cached-image serving", scheduled, NOT landed in cycle-1 (the cycle-1 diff only bumped `sw.js` by 4 version-stamp lines). Confirmed open, not new.
- `revalidate = 0` on public pages → **deferred PERF-R5C1-05** (documented trade-off).
- `getTopics` correlated `MAX(updated_at)` subquery (`data.ts:448-469`) → **deferred PERF-R5C1-04** ("no action required today").
- `getImage` prev/next 4-way OR predicate (`data.ts:954-1057`) → **deferred PERF-R5C1-06** (needs EXPLAIN on seeded table).
- `searchImages` LIKE scans → **PERF-R5C1-08** (rate-capped, FULLTEXT escape hatch documented).
- Per-group view-count UPDATE chunking (`data.ts:103-134`) → **PERF-R5C1-09** (fine at scale).
- `revalidateLocalizedPaths` O(paths×locales) → **PERF-R5C1-12** (no action at 2 locales).
- `image-queue.ts` embedding hook per-job `getGalleryConfig()` (`:405-413`) + bootstrap snapshot → **plan-502 Item 15 / PERF-R5C1-03 / PERF-R5C1-11**, scheduled. Verified still present (`image-queue.ts:405-413` reads config inside the embedding closure on every processed job when not disabled) — NOT re-reported.

---

## Findings

### PERF-R5C2-01 — New analytics breakdown index column order defeats GROUP BY loose-scan on the `'all'` window
- **File:** `apps/web/src/db/schema.ts:232-233`; migration `apps/web/drizzle/0021_analytics_breakdown_indexes.sql:7-8`; consumers `apps/web/src/lib/analytics-data.ts:93-114` (`getCountryBreakdown`) and `:169-190` (`getReferrerBreakdown`).
- **Severity:** MED · **Confidence:** High · **Classification:** confirmed (analysis; EXPLAIN would quantify but the MySQL index-usage rules are deterministic here)
- **Problem:** The new indexes are `(bot, viewed_at, country_code)` and `(bot, viewed_at, referrer_host)`. Both breakdown queries are `WHERE bot = 0 [AND viewed_at >= since] GROUP BY country_code|referrer_host`. Because `viewed_at` sits *between* the equality column (`bot`) and the GROUP BY column in the index, MySQL cannot use a **loose index scan** for the GROUP BY:
  - **`'all'` window** (no `viewed_at` predicate): `WHERE bot=0 GROUP BY country_code`. A loose index scan requires the GROUP BY column to immediately follow the equality-constrained prefix. Here `viewed_at` breaks that adjacency, so MySQL scans every `bot=0` row and builds a temp table + filesort to aggregate. The index helps only by being covering (avoids the clustered-index row probe) and by the `bot=0` prefix.
  - **`30d`/`90d` windows:** `viewed_at >= since` is a range, so `country_code` after it is unusable for grouping regardless — temp-table aggregation over the matched range. This is the common case, and the range filter is the dominant win, so it's acceptable here.
- **Failure scenario:** Admin opens `/analytics` with window=`all` on a gallery with, say, 2M `image_views` rows, 90% `bot=0` → MySQL temp-table-aggregates 1.8M rows per breakdown query (country + referrer = 2 queries) on each page render (admin page is dynamic, no ISR). On the 124 G single-instance host this is a multi-hundred-ms to multi-second admin stall and a temp-table disk-spill risk.
- **Why it's not a regression:** Before this migration there was NO index at all → full table scan every time. The new index is a strict improvement for the windowed case and at least covering for `'all'`. So this is a "the new index could be even better" note, not a regression.
- **Suggested fix (choose by workload):** If the `'all'` window matters, add/replace with `(bot, country_code)` and `(bot, referrer_host)` to enable a loose index scan for the unbounded GROUP BY; keep `(bot, viewed_at)` (already implied as a prefix of the existing pair is *not* present — the leading `(bot, viewed_at)` prefix of the new index covers the windowed range). Pragmatic minimal change: leave the shipped index for the windowed (default) case and document that `'all'`-window breakdowns are temp-table aggregations bounded by retention (see PERF-R5C2-02 / the scheduled `VIEW_EVENT_RETENTION_DAYS`, plan-502 Item 12). Do NOT add four indexes to a high-INSERT analytics table without measuring write amplification first.

### PERF-R5C2-02 — Backfill candidate scan has no `pipeline_version` index; degrades to O(N) forward-scan as a run nears completion
- **File:** `apps/web/src/lib/admin-backfill-runner.ts:164-176` (`fetchCandidateBatch`); `apps/web/scripts/backfill-color-pipeline.ts` (same shape); index gap in `apps/web/src/db/schema.ts:113-118` (no index includes `pipeline_version`).
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed (schema grep shows zero indexes on `pipeline_version`; query plan is deterministic)
- **Problem:** Each batch runs `WHERE processed=TRUE AND (pipeline_version IS NULL OR pipeline_version < V) AND id > cursor ORDER BY id ASC LIMIT 100`. With no index on `pipeline_version`, MySQL satisfies `id > cursor ORDER BY id` via the clustered PK and evaluates the `pipeline_version` predicate as a residual filter row-by-row. Early in a run almost every scanned row qualifies (cheap). Late in a run — after most rows are bumped to `V` — the engine must skip forward over long runs of already-current rows to collect each batch of 100 stale ones. The keyset cursor only advances to the last *returned* (stale) row's id, so it does NOT skip the already-current rows in between; the next batch re-scans them.
- **Failure scenario:** A `--force-reencode`-style mixed state or a partial backfill on a 100k-image gallery where stale rows are sparsely interleaved with current rows → each `LIMIT 100` batch scans thousands of PK rows to find 100 candidates; total run does ~O(N) PK reads per batch × (N/100) batches in the worst interleaving. At personal-gallery scale (a few thousand images) this is invisible; it bites only on large galleries with sparse stale rows.
- **Why it's still an improvement:** The previous `fetchCandidates()` loaded ALL candidates into memory in one query (the keyset rewrite is the PERF-R5C1-01 fix and correctly bounds memory to O(batch)). The scan cost was the same before; only memory residency improved. So this is a residual, not a new regression.
- **Suggested fix:** If large-gallery backfill latency is ever observed, add a partial-friendly composite index `(processed, pipeline_version, id)` so the candidate scan becomes an index range on stale rows only. Defer until there's evidence (the candidate set is bounded by `fetchCandidateCount()` which is shown up-front, so an operator already sees the magnitude). Document the index as the escape hatch in the backfill block.

### PERF-R5C2-03 — `getTopPhotosByViews` GROUP BY+JOIN has no supporting breakdown index (pre-existing, now adjacent to the new index work)
- **File:** `apps/web/src/lib/analytics-data.ts:28-54`.
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation (EXPLAIN on seeded data) · **NOT a cycle-1 change** (confirmed `analytics-data.ts` untouched in `b7d4729b..HEAD`)
- **Problem:** `getTopPhotosByViews` filters `bot=false [AND viewed_at>=since]`, INNER JOINs `images`, and `GROUP BY image_id, title, topic ORDER BY count DESC LIMIT 20`. The only matching index is `idx_image_views_image_id_viewed_at` (`image_id, viewed_at`) — leading column `image_id` does not match the `bot`/`viewed_at` filter, so this query gets a full-ish scan + temp table + filesort. The cycle-1 migration added `bot,viewed_at,*` indexes for the country/referrer breakdowns but NOT a `(bot, viewed_at, image_id)` index that would also serve `getTopPhotosByViews` and `getTopTopicsByViews` (the latter via `topic_views`, which has only `(topic, viewed_at)`).
- **Failure scenario:** Same as PERF-R5C2-01 — admin `/analytics` page issues all breakdown queries; the top-photos and top-topics sections temp-table-aggregate the whole `bot=0` set per render.
- **Suggested fix:** When the analytics page is profiled on a real-scale gallery, consider `(bot, viewed_at, image_id)` on `image_views` (serves top-photos + country/referrer breakdowns share the `(bot, viewed_at)` prefix) and `(bot, viewed_at)` on `topic_views`/`shared_group_views`. Flagged here so the analytics-index work isn't considered "done" after only country/referrer were indexed. Validate with EXPLAIN before adding — write amplification on the hot INSERT path must be weighed.

### PERF-R5C2-04 — `recordAndEvict` rewrites the entire LRU meta document on every image cache write (SW)
- **File:** `apps/web/public/sw.template.js:90-117` (`recordAndEvict`) + `setMeta` `:77-86`.
- **Severity:** LOW · **Confidence:** High · **Classification:** confirmed · **pre-existing** (not cycle-1)
- **Problem:** Every cached image write does `getMeta()` (read + JSON.parse the whole meta blob) → mutate → `setMeta()` (JSON.stringify the whole blob + `cache.put`). With the 50 MB LRU cap and typical AVIF/WebP derivatives of 50-500 KB, the meta Map can hold hundreds of entries; a full gallery paint that warms N images triggers N sequential read-modify-write cycles of the entire meta document. This is O(N²) total JSON work across a paint and serializes cache writes.
- **Interaction with the scheduled SW rework:** plan-502 Item 16 restores true background SWR (revalidate in `event.waitUntil`), which moves these writes off the critical path but does NOT reduce the per-write full-document rewrite. Worth folding a batched/coalesced meta update into that same rework rather than as separate work.
- **Suggested fix:** During the Item-16 SW rework, coalesce meta writes (debounce within a paint, or store per-URL meta as individual cache entries keyed by `/__meta__/<hash>` so a single image write touches one small entry). Strictly an optimization; correctness is fine today.

### PERF-R5C2-05 — `getImagesForFeed` LEFT JOINs `admin_users` under a `GROUP BY images.id` with `GROUP_CONCAT` — author_name relies on functional dependency, fine, but the feed query fans out tag rows
- **File:** `apps/web/src/lib/data.ts:767-790`.
- **Severity:** LOW · **Confidence:** Med · **Classification:** needs-manual-validation · **pre-existing**
- **Problem:** The feed query LEFT JOINs `imageTags` + `tags` (row fan-out per tag) AND `admin_users`, then `GROUP BY images.id`. `author_name: adminUsers.username` is selected without being in GROUP BY — this relies on MySQL's functional-dependency detection (`images.uploaded_by` → at most one `admin_users` row via PK), which works under `ONLY_FULL_GROUP_BY` because the join is on the `admin_users` PK. The tag fan-out (`GROUP_CONCAT`) means the engine materializes `rows × tags` before grouping. `safeLimit` caps at 101 so the blast radius is bounded.
- **Why low:** Bounded by `LIMIT 101` and `ORDER BY updated_at DESC` over the existing `(processed, …)` index prefix. Atom feed is typically ISR-cached at the route layer.
- **Suggested fix:** No action now. If the feed appears in slow-query logs, fetch tags in a second batched query (the `getSharedGroup` pattern at `data.ts:1188-1206`) instead of fanning out under GROUP_CONCAT. Logged for completeness; not actionable this cycle.

### PERF-R5C2-06 — `viewCountRetryCount` Map keyed by groupId is bounded but the flush re-buffer path can transiently exceed cap between chunks
- **File:** `apps/web/src/lib/data.ts:125-150` (re-buffer + post-flush trim).
- **Severity:** LOW · **Confidence:** Med · **Classification:** confirmed (the code itself documents and trims this) · **pre-existing**
- **Problem:** On a full flush failure, each chunk's `.catch` re-buffers into the *new* `viewCountBuffer` and the cap check (`size >= MAX_VIEW_COUNT_BUFFER_SIZE`) is per-set, but the post-flush `finally` trims with a `while (size > MAX)` FIFO loop (`:143-150`). The overflow is bounded by `FLUSH_CHUNK_SIZE = 20` (at most 20 over cap before the trim runs), so the transient excess is trivial. This is correctly handled; noted only to confirm the bounded-map invariant holds under sustained DB-outage retries.
- **Suggested fix:** None. Verified safe. (Race sweep entry below.)

---

## Cycle-1 changes verified clean (no finding)

- **`admin-backfill-runner.ts` keyset pagination (PERF-R5C1-01):** Correct. Cursor advances monotonically to `batch[last].id`; `reprocessOne` bumps `pipeline_version` to CURRENT on success so processed rows fall out of the filter; detection-failure rows (version NOT bumped) are excluded from THIS run by `id > cursor` and correctly re-picked on a future run (cursor resets to 0). No infinite loop, no double-processing. Memory now O(batch=100) instead of O(gallery). Restore-maintenance abort checks at loop top + inside each queued task. Lock/connection handoff + single try/finally release point intact.
- **`process-image.ts` unlink-on-throw (BUG-R5C1-02):** Pure correctness wrapper. `DEPTH_TO_BITS` object allocates once per upload (negligible). No hot-path cost.
- **`photo-title.ts` stub-prefix strip (CRT-R5C1-02):** `ALT_TEXT_STUB_PREFIX_RE` correctly hoisted to module scope (no per-call regex compile). `getConcisePhotoAltText` runs once per masonry card during render — the hoist is the right call.
- **`home-client.tsx` masonry:** Dynamic `columns-${n}` classes are **safelisted** in `tailwind.config.ts:11-16` (all 15 variants), so the masonry layout renders correctly in production — NOT broken. `useColumnCount` rAF-debounces resize; `topicsMap`/`displayTags`/`initialLoadMoreCursor` are `useMemo`'d; above-fold `loading="eager"`/`fetchPriority="high"` gating is correct. The only cycle-1 change here (P3 badge `aria-hidden`, line 356) is a11y, no perf impact. (`containIntrinsicSize` hardcoded-300 → plan-502 Item 26, already scheduled.)
- **`semantic/route.ts` reorder:** Moving `preIncrementSemanticAttempt` BEFORE the config read is a security improvement (prevents free config probing) with rollback on the disabled-mode early return. No perf regression; one extra Map op on the rejected path.
- **`lightbox.tsx` position counter (DES-R5C1-22):** Inline `transition-opacity` on an already `pointer-events-none` element. No new render, no timer. Fine.
- **`info-bottom-sheet.tsx`:** Removed two `requestAnimationFrame` focus effects in favor of FocusTrap `initialFocus` — strictly fewer effects/rAF callbacks. Net positive.
- **`migrate.js` reconcile mirror:** Correctly adds `ensureIndex` for both new indexes so a fresh/legacy DB baselines cleanly. Journal entry `0021` has `when=1781183604120 > 1779494400001` (prior max) → monotonic, will NOT be silently skipped by the drizzle cursor.
- **`image-queue.ts`:** Bootstrap keyset cursor, FIFO-bounded retry/claim/failed maps (`MAX_RETRY_MAP_SIZE`, `MAX_PERMANENTLY_FAILED_IDS`), `unref()` on all timers, hourly `pruneRetryMaps`. Per-job advisory-lock claim + `WHERE processed=false` conditional UPDATE intact. (The per-job embedding-hook config read is the already-scheduled PERF-R5C1-03.)

---

## Final sweep

### Race-condition sweep over shared/process-local state
- **Module-level Maps (bounded):** `viewCountBuffer` / `viewCountRetryCount` (`data.ts`), `ogRateLimit` / `checkoutRateLimit` / `shareRateLimit` / `searchRateLimit` / `loginRateLimit` / `semanticRateLimit` (`rate-limit.ts`), `viewRecordRateLimit` (`public.ts`), queue `retryCounts` / `claimRetryCounts` / `lastErrors` / `permanentlyFailedIds` / `enqueued` (`image-queue.ts`). All bounded via `BoundedMap` or explicit FIFO trims; all single-writer-topology-safe (Node single-threaded; no `await` between read-modify-write inside the rate-limit increment helpers — checked `preIncrement*`, atomic). `viewCountBuffer` swap-then-drain pattern (`data.ts:95-96`) correctly avoids losing increments across a crash mid-flush. No data races.
- **Process-local flags:** `bootstrapCleanupRun`, `bootstrapped`, `bootstrapContinuationScheduled`, `bootstrapCursorId`, `shuttingDown` (`image-queue.ts`); `state.running` (`admin-backfill-runner.ts`); `isFlushing` / `viewCountFlushTimer` / `consecutiveFlushFailures` (`data.ts`); `warnedMissingTrustProxy` / `lastSearchRateLimitPruneAt` (`rate-limit.ts`). All mutated synchronously or under the documented single-flight guards. `runBackfill` mutates `state.running` INSIDE try with finally-release (R29-CRIT-1). `flushGroupViewCounts` nulls the timer handle on entry before the `isFlushing` guard (COR-R4C11-01) — verified correct. No stranded-flag paths found in the fresh changes.
- **Advisory locks:** backfill (`gallerykit_color_pipeline_backfill`), per-image (`gallerykit:image-processing:{id}`), restore/upload-contract — all acquired non-blocking or on dedicated connections, released in finally / on connection close. Backfill lock handoff to the fire-and-forget runner verified single release point.

### Allocation hot spots (checked)
- **Masonry render** (`home-client.tsx`): per-card `getPhotoDisplayTitleFromTagNames` + `getConcisePhotoAltText` + `imageUrl()` string builds + `Math.round(300*h/w)`. All cheap, no per-card regex compile (hoisted). `useMemo` on the expensive derivations. Fine for ≤100-item pages (LISTING_QUERY_LIMIT).
- **Histogram** (`histogram.tsx`): canvas capped 256px, `P3_CTX_OPTIONS` + AVIF-support promise singletons hoisted, worker O(n) computation off main thread, `ArrayBuffer` transferred (zero-copy) to worker. No allocation regressions.
- **SW** (`sw.template.js`): `recordAndEvict` full-document JSON rewrite per write = the only notable allocation churn (PERF-R5C2-04, LOW).
- **DB layer** (`data.ts`): `tagNamesAgg` GROUP_CONCAT shape shared across listing queries (locked by test); cursor normalization regexes are module-level constants; `Map`-based alias/tag grouping (O(1) lookups, no nested filters). Clean.

### Directories / files covered
- DB layer: `lib/data.ts` (full, 1611 lines), `lib/analytics-data.ts`, `db/schema.ts`, `drizzle/0021_*.sql`, `drizzle/meta/_journal.json`, `scripts/migrate.js`.
- Image pipeline: `lib/process-image.ts` (diff), `lib/image-queue.ts` (full), `lib/admin-backfill-runner.ts` (full), `scripts/backfill-color-pipeline.ts` (referenced).
- SW/PWA: `public/sw.template.js` (full), `public/sw.js` (diff), `lib/sw-cache.ts` (referenced via contract).
- React render paths: `components/home-client.tsx` (full), `components/histogram.tsx` (full), `components/lightbox.tsx` (diff + timer grep), `components/info-bottom-sheet.tsx` (diff), `components/upload-dropzone.tsx` (diff).
- Rate limiters / bounded maps: `lib/rate-limit.ts` (full), `lib/bounded-map.ts` (full), `app/actions/public.ts` (analytics insert path).
- Misc fresh: `lib/photo-title.ts`, `lib/caption-generator.ts`, `lib/gallery-config-shared.ts`, `lib/feature-flags.ts` (deleted), `lib/hdr-filenames.ts`, `app/api/search/semantic/route.ts`, `app/actions/images.ts`, settings-client.tsx, `tailwind.config.ts` (safelist verification).

---

## Severity summary

| Severity | Count | IDs |
|---|---|---|
| CRIT | 0 | — |
| HIGH | 0 | — |
| MED | 1 | PERF-R5C2-01 |
| LOW | 5 | PERF-R5C2-02, -03, -04, -05, -06 |

**Verdict on cycle-1 fresh changes: SHIP IT.** No regressions introduced. The keyset backfill, analytics index, migrate reconcile, and component changes are correct and net-positive. The MED finding (PERF-R5C2-01) is a column-order optimization on a *new* index that is already a strict improvement over the prior no-index state; safe to ship and tune later under retention/EXPLAIN evidence. All LOWs are deferrable with concrete re-open criteria.
