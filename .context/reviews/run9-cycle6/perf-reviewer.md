# Performance / Hot-Path Review — run-9 cycle-6

- **Reviewer lens:** performance / hot-path / scalability
- **HEAD:** `ba3277da`
- **Prior cleared convergence point (perf axis):** `e34c04cf` (run-9 cycle-5, "0 NEW perf defects")
- **Bar:** HIGH. Deeply-converged repo; truthful "ZERO new DEFECTS" is the success condition.

## Method

1. Diffed all production code since the prior perf-convergence point.
2. Re-inventoried every hot path named in the task brief and re-validated it against
   source at HEAD (not from prior-cycle memory).
3. Cross-checked `db/schema.ts` composite indexes against the WHERE / ORDER BY /
   GROUP BY shapes in `lib/data.ts`.
4. Verified every documented CLAUDE.md perf claim against source.
5. Swept for sync I/O on request paths and unbounded in-memory structures.

## Delta since last convergence (`e34c04cf..ba3277da`)

Only ONE production file changed (excluding `.context/**` review artifacts and the
`sw.js` version stamp):

| File | Change | Perf relevance |
|---|---|---|
| `lib/sql-restore-scan.ts` | `APP_BACKUP_TABLES` literal expanded 10 → 18 entries (CR-R9C5-01) | **NONE** |
| `__tests__/sql-restore-scan.test.ts` | tripwire test for the superset invariant | test-only |

`sql-restore-scan.ts` runs on the **DB restore** path only — admin-only, gated by
the `gallerykit_db_restore` MySQL advisory lock, executed at most once per restore
operation. The change is a static 18-element constant array consumed by a string
scanner; no algorithmic change, no per-row scaling, no allocation growth, no hot-path
reachability. Purely a correctness fix (lets the app's own current-schema `mysqldump`
backup restore without false-positive `DROP TABLE` blocking). **Zero perf impact.**

## Hot-path inventory (re-validated at HEAD)

| Hot path | File:line | Verdict |
|---|---|---|
| Masonry listing (`getImagesLite` / `getImagesLitePage` / `getAdminImagesLite` / `getImages`) | `data.ts:726/816/913/891` | Bounded (`LISTING_QUERY_LIMIT` 100, `+1` has-more), shared `tagNamesAgg`, keyset cursor on the composite sort triple. Index-ordered. No N+1. |
| `tagNamesAgg` aggregation | `data.ts:603` | One `GROUP_CONCAT` over `LEFT JOIN imageTags + tags` + `GROUP BY images.id`. Documented/locked shape; group step is acceptable at gallery scale (page-30). |
| `getImage()` (photo page — heaviest product path) | `data.ts:954-1105` | `Promise.all([tags, prev, next])` — 3 parallel queries + the row fetch. prev/next predicates are OR-of-ANDs over `(processed, capture_date, created_at)`; each `.limit(1)`. No N+1, no unbounded set. |
| `getSharedGroup()` | `data.ts:1181-1272` | Single group fetch + single `inArray` batch tag fetch (explicit N+1 avoidance). `.limit(100)` matches SHARE_MAX_IMAGES. View count buffered, not per-request write. |
| `getImageByShareKey()` | `data.ts:1115-1175` | Collapsed to ONE query (image + tags via GROUP_CONCAT), `.limit(1)`. |
| serve-upload / ETag (`serve-upload.ts`) | full file | Module-scoped 5 s TTL + inflight-dedupe + stale-while-revalidate on the settings hash (no per-file `admin_settings` SELECT). HEAD short-circuit, 304 negotiation, fd cleanup on abort. Streamed (no heap buffering). |
| Sharp pipeline (`process-image.ts`) | `:1019-1180` | Fresh `sharp()` decode per format/output (WI-14 correctness trade, documented). rgb16 only on wide-gamut non-DCI-P3. Source pixel cap before rgb16 fan-out (OOM guard). 10-bit AVIF behind Promise-singleton probe. File-path input (mmap, no heap pin). |
| Image queue / GC (`image-queue.ts`) | full file | `PQueue` concurrency 1 (env-tunable). All retry Maps/Sets bounded (`MAX_RETRY_MAP_SIZE` 10000, `MAX_PERMANENTLY_FAILED_IDS` 1000) with FIFO eviction via `pruneRetryMaps`. Hourly GC armed once (AGG-M12). Bootstrap batched (500) + cursor-paged. |
| SW cache (`sw-cache.ts`) | full file | LRU via insertion-order recency (delete-then-set) → head-walk eviction, no per-write sort (AGG-H3). 50 MB image cap, 50-entry HTML cap. HEAD revalidate bounded by `AbortSignal.timeout(300ms)`. |
| View-record writes (`public.ts:354-405`) | — | Fire-and-forget INSERT, error-swallowed, per-IP bounded-Map rate-limited (`.prune()`). Never blocks render. |

## CLAUDE.md perf-claim verification

| Claim | Result |
|---|---|
| React `cache()` wraps 10 functions for SSR dedup | ✓ VERIFIED — `getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`, `getSeoSettings` = 10 |
| `Promise.all` parallelizes `getImage()` (tags+prev+next) | ✓ VERIFIED — `data.ts:1046` |
| Connection pool 10 / queue 20 | ✓ VERIFIED — `db/index.ts:23,33` (`connectionLimit: 10`, `queueLimit: 20`) |
| Histogram capped 256×256 | ✓ VERIFIED — `histogram.tsx:180` (`maxDim = 256`), worker-side 256 bins |
| Masonry pure-CSS, no JS reorder | ✓ VERIFIED — `home-client.tsx:259` (`columns-* break-inside-avoid`); resize handler is rAF-debounced (`useColumnCount`, cancel-and-reschedule `home-client.tsx:48-51`) |

## Index vs query-shape cross-check

- Listing sort `capture_date DESC, created_at DESC, id DESC` (+ optional `topic`,
  `processed`) → served by `idx_images_processed_capture_date (processed, capture_date,
  created_at)` and `idx_images_topic (topic, processed, capture_date, created_at)`. ✓
- prev/next adjacency → `(processed, capture_date, created_at)`. ✓
- shared-group images ordered by `(group_id, position)` → `idx_shared_group_images_group_position`. ✓
- tag JOINs → `idx_image_tags_tag_id` + `image_tags_image_id_tag_id_unique`. ✓
- semantic scan `WHERE model_version=? ORDER BY updated_at DESC` → `idx_image_embeddings_model_version_updated`. ✓
- Sweep for sync I/O on request paths (`readFileSync`/`existsSync`/`execSync`/…) in
  `src/lib` + `src/app`: **none**. ✓
- Sweep for unbounded top-level Maps/Sets: all flagged structures carry explicit
  caps + eviction (verified individually). ✓

## Not re-filed (deferred / adjudicated — re-confirmed, no new evidence)

- **R7C1-CR-02** — bootstrap 1000-literal `notInArray` (`image-queue.ts:627`): MySQL
  handles fine, capped, runs at startup. Per brief: do not re-file.
- **R7C1-CR-04** — timeline bounds: parameterized, cap-500 + limit+1. Per brief: do
  not re-file.
- **PERF-R5C2-01** — analytics `getTopPhotosByViews` GROUP BY `imageId` not the
  trailing column of `(bot, viewed_at, country_code)` / `(bot, viewed_at, referrer_host)`
  (`analytics-data.ts:44`): admin-only cold page, retention-bounded scan, deferred
  pending EXPLAIN evidence (plan-322 entry 3). POLISH at most; re-confirmed, not filed.

## Disposition

- **NEW perf DEFECTS:** 0.
- The only production change since the cleared convergence point is a static-array
  correctness fix on the cold admin DB-restore scanner — provably zero perf relevance.
- Every product hot path (listing, photo page, shared group, serve-upload/ETag, Sharp
  pipeline, image queue/GC, SW cache, view-record writes) is source-validated optimized
  at HEAD `ba3277da`. All documented perf claims hold. All in-memory state is
  bounded-by-design with eviction. No N+1, no missing index for a hot query shape, no
  unbounded result set, no sync I/O on a request path, no event-loop blocking.
- Performance/scalability convergence holds.

---

**VERDICT: ZERO new DEFECTS**
