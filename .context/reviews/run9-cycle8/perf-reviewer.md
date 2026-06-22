# Run-9 Cycle-8 — Performance / Efficiency Review

**Reviewer:** perf-reviewer
**HEAD:** 4e132b03
**Baseline:** feb63faa (run-9 cycle-7 perf pass, which was CLEAN: 0 DEFECT / 0 POLISH)
**Scope:** whole-repo hot paths — data-access layer, DB index coverage vs query shapes, Sharp fan-out, image-queue concurrency + bootstrap, serve-upload TTL/SWR/ETag, service-worker LRU + HEAD-revalidate, N+1, sync I/O on request paths, redundant round-trips, unbounded Maps/caches, payload size, pagination caps.

## Verdict

**NEW perf DEFECTS: 0. NEW perf POLISH: 0.**

The performance surface is converged. This was NOT a trust-the-prior pass: I rebuilt the inventory and independently re-verified every claim the brief flagged for re-verification (bounded Maps, tagNamesAgg, index↔query-shape match, new-query-without-index). Every concern in scope is already optimized, already bounded, or a documented/adjudicated tradeoff with an exit criterion. Audit evidence below so the next cycle does not re-walk these lanes.

---

## What actually changed since the cycle-7 perf baseline

`git diff --stat feb63faa..HEAD -- apps/web/src/` is **two files, +36 lines, additive only**:

| File | Change | Perf impact |
|---|---|---|
| `app/api/admin/lr/upload/route.ts` | +16: forward the 6 admin processing settings (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`) onto the `enqueueImageProcessing` job — this is the CR-R9C7-01 correctness fix the cycle-7 perf pass flagged for the correctness lane | **None.** Pure additive object-property forwarding from the already-resolved `config` object (same one already supplying `quality`/`imageSizes`). No new query, no new allocation on a hot path, no loop. |
| `__tests__/lr-upload-hdr-gate.test.ts` | +20: test coverage for the fix | n/a (test) |

The data-access layer, schema, process-image, image-queue, serve-upload, and the SW template are **byte-identical** to the cycle-7 baseline. The prior perf pass adjudicated all of them CLEAN. I re-verified rather than inherit that conclusion.

---

## Re-verification of the brief's explicit RE-VERIFY items

### 1. Are all in-memory Maps still bounded? — YES, all 13, with ACTIVE eviction (not just declared caps)

I confirmed each cap is enforced by code that actually runs, not a dead constant.

| Map/Set | file:line | Cap | Eviction proof |
|---|---|---|---|
| `permanentlyFailedIds` | `image-queue.ts:83,521-527` | `MAX_PERMANENTLY_FAILED_IDS=1000` | FIFO `values().next().value` + delete on `size>cap`, runs in the failure path (`:522`) ✓ |
| `enqueued`,`retryCounts`,`claimRetryCounts`,`lastErrors` | `image-queue.ts:81,98-111` | `MAX_RETRY_MAP_SIZE=10000` | `pruneRetryMaps` collect-then-delete excess; **called per-job (`:576`) AND hourly (`:739`)** ✓ |
| `viewCountBuffer` | `data.ts:29,47-52` | `MAX_VIEW_COUNT_BUFFER_SIZE=1000` | drop-increment-on-full guard at write (`:47`) + re-checked on retry re-buffer (`:125`) ✓ |
| `viewCountRetryCount` | `data.ts:27,167-187` | `MAX_VIEW_COUNT_RETRY_SIZE=500` | `clear()` when buffer empties (`:168`) **AND** FIFO evict-excess on the sustained-outage path where buffer never empties (`:169-187`) ✓ — the both-branches design closes the prior C5-AGG-02 outage gap |
| `uploadTracker` | `upload-tracker-state.ts:9,24-50` | `UPLOAD_TRACKER_MAX_KEYS=2000` | `pruneUploadTracker` expiry-prune then hard-cap evict-oldest (`:49`) ✓ |
| `loginRateLimit`,`accountLoginRateLimit`,`passwordChangeRateLimit` | `rate-limit.ts:101`,`auth-rate-limit.ts:19,100` | `createWindowBoundedMap(MAX_KEYS, WINDOW)` | `BoundedMap.prune()` ✓ |
| `ogRateLimit`,`shareRateLimit`,`searchRateLimit`,`semanticRateLimit` | `rate-limit.ts:77,87,103,286` | `createResetAtBoundedMap(MAX_KEYS)` | `BoundedMap.prune()` via per-bucket prune fns ✓ |

No unbounded module-level/global Map or Set exists.

### 2. Do the masonry-list queries still use tagNamesAgg (no scalar-subquery regression)? — YES

`tagNamesAgg` (`data.ts:603`) = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)`, consumed at `data.ts:732, 781, 831, 897, 921, 1357` — i.e. `getImagesLite`, `getImagesForFeed`, `getImagesLitePage`, `getImages`, `getAdminImagesLite`, `getImagesForSmartCollection`. All use `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. No correlated scalar-subquery (`it`/`t` alias) form reintroduced — that shape (the production NULL-aria regression, commit aca754c) stays absent. Locked by `data-tag-names-sql.test.ts`.

`getImageByShareKey` (`data.ts:1135`) and `getSharedGroup` tag fetch use the combined `GROUP_CONCAT(DISTINCT CONCAT(slug, CHAR(0), name) … SEPARATOR CHAR(1))` shape — still ONE query, not N+1.

**Bonus catch I verified positively:** `group_concat_max_len` is explicitly `SET … = 65535` on **every pool connection** (`db/index.ts:62`, locked by `db-pool-connection-handler.test.ts`). So the tag aggregation does NOT silently truncate at MySQL's 1024-byte default — a real latent footgun that is correctly handled.

### 3. Are the composite indexes still matched to the actual ORDER BY / WHERE shapes? — YES

| Query | shape | Index | Coverage |
|---|---|---|---|
| Homepage/gallery/smart-collection/related (`getImagesLite`, `getImages`, `getImagesLitePage`, `getAdminImagesLite`, `getImagesForSmartCollection`, related) | `WHERE processed=true [AND topic=?] ORDER BY capture_date DESC, created_at DESC, id DESC` | `idx_images_processed_capture_date (processed,capture_date,created_at)` / `idx_images_topic (topic,processed,capture_date,created_at)` (`schema.ts:112,114`) | equality prefix + sort prefix covered; trailing `id` rides clustered PK ✓ |
| prev/next nav undated branch | `created_at` ordering | `idx_images_processed_created_at (processed,created_at)` (`schema.ts:113`) ✓ |
| Tag JOIN (both directions) | `imageTags.imageId` / `imageTags.tagId` | unique `(image_id,tag_id)` + `idx_image_tags_tag_id` (`schema.ts:129-130`) ✓ |
| Analytics breakdowns | `(bot, viewed_at, country_code)` / `(…, referrer_host)` | `idx_image_views_bot_viewed_country` / `…_referrer` (`schema.ts:230-231`) ✓ |
| Embeddings live scan | `WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000` | `idx_image_embeddings_model_version_updated` ✓ |
| Upload dedup / attribution | `user_filename` / `uploaded_by` | `idx_images_user_filename` / `idx_images_uploaded_by` (`schema.ts:115-116`) ✓ |
| Shared-group images | `WHERE group_id=? ORDER BY position` | `idx_shared_group_images_group_position (group_id,position)` (`schema.ts:154`) ✓ |
| Sessions purge / audit-log sweeps | `expires_at` / `created_at` | `idx_sessions_expires_at`, `audit_created_at_idx` (`schema.ts:186,176`) ✓ |

### 4. Any NEW query added since prior cycles that lacks an index? — NO

The only diff since baseline is the LR-route setting-forward (no query). Broader sweep of `actions/*.ts` `.where`/`.orderBy` shows every predicate is on an indexed/PK/unique column (`images.id` PK via `inArray`, `adminUsers.username` unique, `imageTags.imageId`/`tagId` indexed, `sharedGroupImages.groupId` indexed). The embeddings backfill-selection (`actions/embeddings.ts:97-116`) uses `notExists` (correlated EXISTS resolvable by the embeddings unique key) + `.limit(SEMANTIC_SCAN_LIMIT)` — bounded, admin-triggered, not a public hot path.

---

## Performance lanes — audit evidence (unchanged-clean, re-confirmed)

- **No N+1.** `getSharedGroup` batches all image tags in one `inArray` (`data.ts:1234`); `getImage` runs tags+prev+next in one `Promise.all` (`data.ts` Promise.all path); `getImageByShareKey` collapses image+tags into one LEFT JOIN + combined GROUP_CONCAT.
- **cache() dedup intact:** all 9 `*Cached` accessors + `getSeoSettings` wrapped (per-request SSR dedup).
- **Payload lean:** `_largePayloadGuard` (`data.ts:445-448`) compile-time-keeps `blur_data_url` out of `publicSelectFields`; fetched only in individual image queries (`data.ts:963,1121`). Listing payload capped by `LISTING_QUERY_LIMIT`.
- **Pagination caps:** `getImagesLitePage`/`getImagesLite`/`getAdminImagesLite`/`getImagesForFeed` all clamp limit to `LISTING_QUERY_LIMIT[_PLUS_ONE]`; `loadMore*` cap raw offset at 10000 and prefer keyset cursors (`buildCursorCondition`, index-friendly — no growing OFFSET scan).
- **Sync I/O on request paths: NONE.** `grep readFileSync|writeFileSync|existsSync|statSync|readdirSync|mkdirSync|lstatSync|realpathSync|appendFileSync` over `src/` (excl. scripts/tests) = ZERO hits.
- **Sharp fan-out bounded:** 3 formats in `Promise.all`, fresh decode per output (WI-14 correctness trade), QUEUE_CONCURRENCY default 1, 50 MP source cap before rgb16, 10-bit probe is a once-per-process Promise-singleton.
- **image-queue bootstrap:** keyset-paginated `BOOTSTRAP_BATCH_SIZE=500`, enqueue-columns-only select, permanently-failed excluded via `notInArray` (bounded ≤1000), hourly GC armed once.
- **serve-upload:** settings-hash SELECT debounced behind 5 s TTL + single-inflight + SWR; HEAD/304 short-circuit before fd open; `IMAGE_PIPELINE_VERSION` from client-safe shared module (no sharp in serving bundle).
- **SW:** 50 MB image LRU with O(n) recency-head-walk eviction; HEAD ETag probe bounded by `AbortSignal.timeout(300ms)` → serve-stale + background-revalidate; HTML cache 50-entry/24 h cap.

---

## Prior-deferred — NOT re-filed (no new evidence meeting exit criteria, per brief)

- **R7C1-CR-02** (1000-literal `notInArray` in bootstrap): bound is `MAX_PERMANENTLY_FAILED_IDS=1000`, so the in-clause is hard-capped. No new measured evidence.
- **OBS-R7C2-06** (bootstrap reschedule): no new evidence.
- **Atom feed `updated_at DESC` filesort** (`getImagesForFeed`, `data.ts:790`): no `(processed,updated_at,…)` index exists, but `FEED_LIMIT=50` bounds the result and the feed is low-traffic + revalidated. Adjudicated "OPTIMIZED" in run9-cycle2; re-confirmed bounded. Not a NEW defect.

## Bottom line

Truthful **NEW_FINDINGS:0 / COMMITS:0** for this reviewer. The single change since the clean baseline is an additive correctness fix on the LR ingest path with zero perf footprint. Every brief-flagged re-verification target (13 bounded Maps, tagNamesAgg, index↔shape match, new-query-without-index) passed independent inspection. This is the expected converged outcome.

---

DISPOSITION: 0 perf DEFECTS + 0 POLISH.
