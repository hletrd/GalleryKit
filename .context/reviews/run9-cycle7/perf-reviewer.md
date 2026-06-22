# Run-9 Cycle-7 — Performance / Efficiency Review

**Reviewer:** performance-reviewer
**HEAD:** feb63faa
**Scope:** hot paths only — data-access layer, DB index coverage, Sharp fan-out, image-queue concurrency + bootstrap scan, serve-upload TTL/SWR/ETag, service-worker LRU + HEAD-revalidate, N+1 patterns, sync I/O on request paths, unbounded Maps/caches.

## Verdict

**NEW perf DEFECTS: 0. NEW perf POLISH: 0.**

The performance-sensitive surface is in good shape. Every concern in scope is either already optimized, already bounded, or a documented/adjudicated tradeoff with an exit criterion. I record below (a) the special-focus confirmation, which is a CORRECTNESS defect, not a perf one, and (b) the audit evidence proving the perf lanes are clean, so the next cycle does not re-walk them.

---

## Special-focus confirmation (CORRECTNESS, not perf — belongs to lead/correctness lane)

**CONFIRMED: LR publish upload path ignores the 6 admin processing settings.**

- `apps/web/src/app/api/admin/lr/upload/route.ts:420-444` builds the `enqueueImageProcessing` job with `quality` (`:428-432`) and `imageSizes` (`:433`) but does NOT forward the 6 settings added by CR-R9C6-01 (`forceSrgbDerivatives`, `wideGamutJpegChroma`, `avifEffort`, `sdrJpegChroma`, `wideGamutMaxSourcePixels`, `autoAltTextEnabled`).
- The queue handler gate is `if (!quality && !imageSizes)` at `apps/web/src/lib/image-queue.ts:336`. Because the LR job supplies `quality`, the gate is NOT entered, so the 6 settings are never loaded from config and each falls back to its hard-coded default at `image-queue.ts:326-335` (`?? false` / `undefined` → `processImageFormats` per-arg defaults: forceSrgb=false, wideGamutChroma 4:4:4, avifEffort 6, sdrChroma 4:2:0, maxSourcePixels 50 MP, autoAltText off).
- **Failure scenario:** an admin sets `force_srgb_derivatives=true` (or any of the 6), then publishes via the Lightroom Classic plugin. The browser-upload path honors the setting; the LR path silently encodes with defaults. Same class as CR-R9C6-01, on the primary non-browser ingest path.
- **DEFECT, confidence High.** This is the lead's preliminary read, confirmed independently with file:line.
- **Fix:** forward the 6 from the LR route's already-resolved `config` (same object used for `quality`/`imageSizes` at `:428-433`), mirroring `apps/web/src/app/actions/images.ts:440`:
  ```ts
  forceSrgbDerivatives: config.forceSrgbDerivatives,
  wideGamutJpegChroma: config.wideGamutJpegChroma,
  avifEffort: config.avifEffort,
  sdrJpegChroma: config.sdrJpegChroma,
  wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
  autoAltTextEnabled: config.autoAltTextEnabled,
  ```

This is filed as a correctness defect (wrong encoded bytes), not a perf finding. Noting it here only because the brief asked this lane to confirm/refute.

### Other enqueue/processing entry points — all correct (verified)

| Entry point | file:line | Forwards 6? | Verdict |
|---|---|---|---|
| Browser upload | `actions/images.ts:440` | Yes (uploadConfig) | OK (CR-R9C6-01 fix) |
| LR PAT upload | `lr/upload/route.ts:420` | **No** | **DEFECT (above)** |
| Bootstrap | `image-queue.ts:673` | No quality/sizes → gate loads all 8 from config (`:336-356`) | OK (correct fallback) |
| Claim-retry re-enqueue | `image-queue.ts:290` | Re-enqueues same `job` object | OK (preserves whatever was set) |
| Failure-retry re-enqueue | `image-queue.ts:510` | Re-enqueues same `job` object | OK |
| Admin backfill runner | `admin-backfill-runner.ts:499` | Calls `processImageFormats` DIRECTLY with `settings.*` (`:508-513`) — bypasses queue/gate entirely | OK |
| Sidecar backfill | `scripts/backfill-color-pipeline.ts:203` | Calls `processImageFormats` DIRECTLY with `settings.*` (`:212-217`) | OK |
| retryFailedImage | `images.ts:1139` | (not the gate concern; re-enqueues job) | not the 6-setting defect surface |

Only the LR route is defective.

---

## Performance lanes — all clean (audit evidence)

### 1. Data-access layer (`lib/data.ts`) — CLEAN
- React `cache()` dedup wraps all listing/lookup accessors (`getImageCached`, `getLatestImageForOgCached`, `getTopicBySlugCached`, `getTopicsCached`, `getTagsCached`, `getTopicsWithAliasesCached`, `getImageByShareKeyCached`, `getSharedGroupCached`, `getSmartCollectionBySlugCached`, `getSeoSettings`) — `data.ts:1606-1660`. Per-request SSR dedup intact.
- `tagNamesAgg` (`data.ts:603`) is the single shared `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` expression used by `getImagesLite`/`getImagesLitePage`/`getAdminImagesLite`/`getImages`/`getImagesForSmartCollection`/`getImagesForFeed`. LEFT JOIN + GROUP BY images.id — the working shape, locked by `data-tag-names-sql.test.ts`. No drift.
- **No N+1.** `getSharedGroup` (`data.ts:1223-1249`) batches all image tags in ONE `inArray` query, then maps client-side. `getImage` (`data.ts:1046-1092`) runs tags+prev+next in a single `Promise.all`. `getImageByShareKey` (`data.ts:1125-1148`) collapses image+tags into one LEFT JOIN + GROUP_CONCAT.
- `getLatestImageForOg` (`data.ts:871-885`) is the purpose-built minimal `id,title` LIMIT-1 accessor that avoids the full masonry query on the home OG-metadata path (AGG-R8c3-05). Consumed at `page.tsx:91`.
- Deep-offset DoS bounded: `loadMoreImages`/`loadMoreSmartCollectionImages` cap raw offset at 10000 and prefer keyset cursors (`actions/public.ts:91,178`); `getImagesLite` clamps `limit` to `LISTING_QUERY_LIMIT_PLUS_ONE` (`data.ts:747`). Cursor path uses `buildCursorCondition` keyset (`data.ts:685-708`) — index-friendly, no growing OFFSET scan.
- `COUNT(*) OVER()` on the page path (`data.ts:832,1358`) computes the total over the already-grouped result for ONE 31-row page — acceptable; callers on cursor pages discard it (documented `data.ts:1340-1346`).

### 2. DB index coverage vs query shapes (`db/schema.ts`) — CLEAN
- Homepage/gallery: `WHERE processed=true ORDER BY capture_date DESC, created_at DESC, id DESC` → `idx_images_processed_capture_date (processed, capture_date, created_at)` (`schema.ts:112`). Equality prefix + sort prefix covered; trailing `id` rides the clustered PK.
- Topic-filtered: `WHERE topic=? AND processed=true ORDER BY capture_date…` → `idx_images_topic (topic, processed, capture_date, created_at)` (`schema.ts:114`). Both equality cols + sort covered.
- prev/next nav: `idx_images_processed_created_at` (`schema.ts:113`) supports the undated-branch `created_at` ordering.
- Tag JOIN: `idx_image_tags_tag_id` (`schema.ts:130`) + unique `(image_id, tag_id)` cover both JOIN directions.
- Analytics: `(bot, viewed_at, country_code)` + `(bot, viewed_at, referrer_host)` (`schema.ts:230-231`) match the breakdown queries; `(…, viewed_at)` per-table indexes serve the retention range-DELETE.
- Embeddings: `idx_image_embeddings_model_version_updated` (`schema.ts:285`) serves the live `WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000` scan.
- `idx_images_uploaded_by` (`schema.ts:116`) serves attribution. No missing index for any in-scope hot query.

### 3. Sharp parallel fan-out (`lib/process-image.ts`) — CLEAN
- 3 formats run in `Promise.all` (`process-image.ts:1265-1269`); each `generateForFormat` opens a FRESH `sharp(processingInputPath,…)` per size (`:1122-1127`) — WI-14 cross-format isolation, deliberate decode-reuse-for-correctness trade (documented AGG-R7-08).
- Same-size dedup uses hard link (zero-copy) with copyFile fallback (`:1090-1099`); base filename via atomic link+rename (`:1236-1257`).
- Wide-gamut 50 MP source cap downscales to a TIFF intermediate before fan-out (`:1022-1042`) — prevents rgb16 OOM. `mmap`/`sequentialRead` used throughout (no heap buffering).
- 10-bit AVIF gated on a Promise-singleton libheif probe (`canUseHighBitdepthAvif`, `:1152`) with per-image 8-bit fallback (`:1176-1184`). Probe runs once per process.
- libvips concurrency is per-job; queue concurrency default 1 (`QUEUE_CONCURRENCY` override). No fan-out explosion.

### 4. image-queue concurrency + bootstrap scan (`lib/image-queue.ts`) — CLEAN
- PQueue concurrency default 1 (`:180`). Bootstrap scans in `BOOTSTRAP_BATCH_SIZE=500` (`:79`) keyset-paginated by `gt(images.id, cursor)` (`:643-672`) — no full-table materialization; continuation chained via `onIdle` (`:612-626`, `:703`).
- Bootstrap selects ONLY enqueue columns (`:652-668`), not the full row.
- Permanently-failed IDs excluded from the scan via `notInArray` (`:646-648`) — prevents re-enqueue tight-loop.
- Hourly GC armed ONCE (`!state.gcInterval` guard, `:732`) — AGG-M12 fixed the prior per-batch re-arm that starved purges during multi-batch bootstrap. Timers `unref()`'d.
- `cleanOrphanedTmpFiles` scans the 3 dirs in `Promise.all` (`:38-72`).

### 5. serve-upload TTL / SWR / ETag (`lib/serve-upload.ts`) — CLEAN
- Settings-hash on the ETag path is debounced behind a module-scoped 5 s TTL + single-inflight + stale-while-revalidate (`:46-83`, R4C3/R4C4). A derivative flood issues at most one `admin_settings` SELECT per 5 s window, never one-per-file. Cold start blocks once; refresh never blocks.
- `IMAGE_PIPELINE_VERSION` imported from client-safe `gallery-config-shared` (`:12`), NOT from process-image — the serving path does not pull sharp/libvips/color-detection into the bundle (PERF-R4C1-07).
- HEAD short-circuit returns headers-only (no fd open) (`:257-259`); 304 path returns before opening the body (`:223-235`). Client-abort releases the fd (`:269-290`).
- No sync I/O — `lstat`/`realpath`/`createReadStream` all async.

### 6. Service worker LRU + HEAD-revalidate (`public/sw.template.js`) — CLEAN
- Image SWR: 50 MB LRU (`:31`), eviction is an insertion-order (= recency) head-walk via delete-then-set upsert (`:99-126`) — O(n) not O(n log n) per write (AGG-H3).
- Synchronous HEAD ETag probe on the cached-display path is BOUNDED by `AbortSignal.timeout(300ms)` (`:38,:239`); on slow/hung network it aborts and serves stale immediately + background-revalidates (AGG-R8-05). The N-HEAD-per-warm-paint cost is a documented, bounded, deliberate freshness trade — NOT a regression.
- Revalidate GET is lazy single-flight (`startRevalidate`, `:188-205`) — 304 genuinely skips the body fetch (R4C9 PERF-R4C9-02).
- HTML cache capped at 50 entries (`:33`), 24 h TTL, oldest-first eviction (`:128-145`). META store bounded by the same maps.

### 7. Sync I/O on request paths — NONE
- `grep` for `readFileSync|writeFileSync|existsSync|statSync|readdirSync|mkdirSync` across `src/` (excluding scripts/tests) returned ZERO hits. All request-path I/O is async.

### 8. Unbounded Maps / caches — ALL BOUNDED (confirmed)
| Map/Set | file:line | Bound |
|---|---|---|
| `loginRateLimit`, `searchRateLimit`, `ogRateLimit`, `shareRateLimit`, `semanticRateLimit` | `rate-limit.ts:77,87,101,103,286` | `BoundedMap` cap 2000–5000, `prune()` evicts oldest (`bounded-map.ts:98-129`) |
| `accountLoginRateLimit`, `passwordChangeRateLimit` | `auth-rate-limit.ts:19,100` | `createWindowBoundedMap` cap 5000 |
| `uploadTracker` | `upload-tracker-state.ts:18` | cap 2000, `pruneUploadTracker` expiry + hard-cap eviction (`:24-60`) |
| `rejectionLog` (blur-data-url throttle) | `blur-data-url.ts:69` | cap 256, oldest-evict (`:80-83`) |
| `viewCountBuffer` | `data.ts:17` | cap 1000, drop-on-full + post-flush FIFO trim (`:47-51,:143-150`) |
| `viewCountRetryCount` | `data.ts:21` | cap 500, FIFO evict + clear-on-empty (`:167-187`) |
| `enqueued`, `retryCounts`, `claimRetryCounts`, `lastErrors` | `image-queue.ts:181-184` | `pruneRetryMaps` cap 10000 (`:98-111`), called per-job + hourly |
| `permanentlyFailedIds` | `image-queue.ts:185` | cap 1000, FIFO evict (`:522-534`) |

No unbounded module-level/global Map or Set found.

---

## Prior-deferred items — NOT re-filed
- R7C1-CR-02 (1000-literal `NOT IN`) and R7C1-CR-04 (timeline bounds): not re-filed — no NEW measured evidence, per brief. (The bootstrap `notInArray(permanentlyFailedIds)` is capped at 1000 IDs by `MAX_PERMANENTLY_FAILED_IDS`, so even the largest in-clause is bounded — consistent with the prior deferral rationale.)

## Bottom line
Performance lanes: truthful **NEW_FINDINGS:0 / COMMITS:0** for this reviewer. The one confirmed defect (LR route 6-settings) is a correctness/encoded-bytes issue owned by the lead/correctness lane; the fix is a 6-line additive forward at `lr/upload/route.ts:420`.
