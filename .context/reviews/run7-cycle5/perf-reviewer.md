# Performance Review — run-7 cycle-5

**Agent:** perf-reviewer
**HEAD:** `d38fa4a4`
**Scope:** image pipeline, queue, backfill, data access, CLIP semantic, SW LRU, rate-limit maps, histogram worker, connection pool — re-derived from CURRENT line numbers (not trusting prior cycle's numbers).
**Verdict:** **APPROVE — 0 new actionable findings.** (5th consecutive truthful ZERO.)

---

## Source stability since cycle-1 (run-7)

`git diff 73d3c89c..HEAD` over `src/lib/*.ts` + `src/app/**`:

| File | Δ | Perf relevance |
|---|---|---|
| `color-detection.ts` | +30/-? | O(1) NCLX constant-map entries + switch cases, evaluated once per image at ingest. No new loop/alloc/query. |
| `settings-hash.ts` | +13 | Compile-time `_ColorKeysAreSettingKeys` type guard — **zero runtime code**. |
| `use-display-capability.ts` | +9/-3 | Snapshot memoization (already perf-correct — stable `getSnapshot` ref avoids the `useSyncExternalStore` infinite-loop). |
| `__tests__/color-detection.test.ts` | +12 | Test-only (the sole delta since cycle-4). |

None touch a hot path in a perf-relevant way. The executable surface that matters for performance is frozen.

---

## Hot-path bound re-derivation (current line numbers)

### Image pipeline — `lib/process-image.ts` (1650 lines)
- **OOM guard (1004–1042):** `WIDE_GAMUT_MAX_SOURCE_PIXELS` (default 50 M, admin-tunable) caps source pixels via `Math.sqrt` proportional downscale to a lossless LZW TIFF intermediate (1038) BEFORE the rgb16 fan-out. `basePixels` computed from autoOriented metadata (1019–1021) so rotated portraits gate correctly.
- **Per-format fan-out (1265–1269):** 3-format `Promise.all` (webp/avif/jpeg). Each iterates `sortedSizes` (admin-capped ≤ 8). Worst case = 3 × 8 = **24 sharp encodes**, each on a fresh `sharp(processingInputPath, { limitInputPixels })` instance (1122–1127) — `limitInputPixels` on EVERY decode, `failOn:'error'`, `sequentialRead:true` (mmap/stream, no heap buffering).
- **Same-size dedup (1090–1099):** when `resizeWidth` repeats (small originals), the variant is hard-linked (zero-copy) / copyFile'd instead of re-encoded — kills redundant encode work on the short tail of the size ladder.
- **10-bit AVIF fallback (1152–1188):** gated on a Promise-singleton libheif probe; per-image 8-bit downgrade via `base.clone()` on `bitdepth` rejection. No retry storm.
- **Verdict:** bounded. No N+1, no unbounded loop, no per-format shared-state contention.

### Queue — `lib/image-queue.ts` (786 lines)
- **PQueue concurrency (168):** `Number(process.env.QUEUE_CONCURRENCY) || 1` — NaN-safe via `|| 1` (a NaN concurrency would freeze PQueue).
- **Bootstrap scan (652):** `.limit(BOOTSTRAP_BATCH_SIZE)` + `ORDER BY id ASC` — batched, not a full-table scan; re-arms a retry timer rather than looping the whole backlog in one pass.
- **Timer hygiene:** GC `setInterval` `.unref?.()` (721); bootstrap retry `setTimeout` `.unref?.()` (280, 589) — none pin the event loop at shutdown.
- **BoundedMap sweeps (99–107):** iterate the capped retry/error Maps only — bounded.

### Backfill — `lib/admin-backfill-runner.ts` (871 lines)
- **`resolveBackfillConcurrency` (129–142):** `cap = max(1, floor((limit − reserved − 1)/2))`, `reserved = max(3, ceil(limit/2))` → **cap=2 at pool 10**. NaN-guarded (137: non-finite `poolLimit` → 10). Requests above cap clamped DOWN with a warning (665–667). Connection budget: lock(1) + 2 workers × 2 conns = 5 ≤ pool 10, leaving ≥ 5 for live `getImage` fan-out (which needs exactly 3). Arithmetic verified — a background re-encode cannot starve live traffic.

### Data access — `lib/data.ts` (1662 lines)
- **`tagNamesAgg` (605):** single `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over `LEFT JOIN imageTags…tags GROUP BY images.id`, shared by all masonry-list queries — the documented N+1 fix (the prior scalar-correlated-subquery shape returned NULL in prod). Locked by `data-tag-names-sql.test.ts`.
- **All listings `.limit()`-bounded** (751, 793, 846, 912, 936, 1371, 1473, 1555, MAP_MAX_MARKERS at 1594).
- **`getImage()` (1048):** 3-way `Promise.all` (tags + prev `.limit(1)` + next `.limit(1)`) — fixed 3-connection fan-out per page render.
- **Shared-group tags (1225–1248):** single batched `inArray(imageTags.imageId, imageIds)` + in-memory Map build, bounded by `.limit(100)` (SHARE_MAX_IMAGES). No N+1.
- **View-count flush:** timer `.unref?.()` (55), atomic Map-swap (13–16), `FLUSH_CHUNK_SIZE=20` chunked `Promise.all` (61, 103–105), retry/backoff cap — bounded concurrent DB promises.

### Index ↔ query-shape cross-check (`db/schema.ts`)
| Query shape | Index | Covered |
|---|---|---|
| masonry `WHERE processed ORDER BY capture_date, created_at` | `idx_images_processed_capture_date` (114) | ✓ |
| prev/next nav `WHERE processed … created_at` | `idx_images_processed_created_at` (115) | ✓ |
| topic-filtered listing | `idx_images_topic` (116) | ✓ |
| tag JOIN | `idx_image_tags_tag_id` (132) | ✓ |
| `inArray(imageTags.imageId,…)` | unique `(imageId, tagId)` leftmost prefix (131) | ✓ |
| shared-group `WHERE groupId ORDER BY position` | `idx_shared_group_images_group_position` (156) | ✓ |
| semantic scan `WHERE modelVersion ORDER BY updatedAt DESC` | `idx_image_embeddings_model_version_updated` (287) | ✓ |
| analytics country/referrer breakdowns | `idx_image_views_bot_viewed_*` (232–233) | ✓ |
No query shape lacks a supporting index.

### CLIP semantic — `app/api/search/semantic/route.ts` (341 lines) + `lib/clip-embeddings.ts`
- **DB scan (251–256):** hard cap `.limit(SEMANTIC_SCAN_LIMIT)` (5000), `WHERE modelVersion` + `ORDER BY updatedAt DESC` → index-covered.
- **Per-row scoring (272–279):** O(scanned × 512). Production uses `dotProduct` (pre-normalized vectors) instead of `cosineSimilarity` — skips 2 norm recomputes + sqrt per row (AGG-C8-09). `decodeEmbeddingColumn` (108–126) is O(1)/row.
- **`topK` (137–141):** `.filter().sort().slice(0,k)` = O(n log n) at the 5000 cap.
- **Enrichment (291–313):** single `inArray(images.id, resultIds)` batch — no N+1.
- **Body guarded:** 8 KB cap before parse (143–163); rate-limit pre-increment + rollback.

### SW — `public/sw.template.js` (373 lines)
- **Image LRU (95–126):** 50 MB cap (`MAX_IMAGE_BYTES`, 31). Eviction is an insertion-order head-walk (104–122) — recency tracked by delete-then-set, so no O(n log n) re-sort per write (AGG-H3). Total-sum is one O(n) pass where n is bounded by 50 MB / min-image-size.
- **HTML cache:** 50-entry cap (33); sorts only when over cap (140).
- **HEAD revalidate (239):** `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS=300)` (38) — a hung network aborts at 300 ms and serves cached bytes, so a warm masonry paint never stalls per-tile.

### Rate-limit maps — `lib/rate-limit.ts`
Every bucket (`ogRateLimit`, `checkoutRateLimit`, `shareRateLimit`, `loginRateLimit`, `searchRateLimit`, `semanticRateLimit`) is a `BoundedMap` with an explicit `MAX_KEYS` cap (79–337). Oldest-entry eviction on overflow. No unbounded growth under distributed attack.

### Histogram worker — `components/histogram.tsx`
`imageData` transferred as a zero-copy `ArrayBuffer` transferable (`postMessage(..., [payload.imageData])`, 165); worker versioned by `IMAGE_PIPELINE_VERSION` (527). Pixel loop is off the main thread — no render-path blocking, no re-render storm (lazy-mounted per `<Histogram>` contract).

### Blocking I/O / serial-await sweep
- **Zero** `readFileSync`/`existsSync`/`execSync` on any `src/app` or `src/lib` request path.
- The only `for (… of …)` loops in `actions/images.ts` are (a) synchronous Set-building for `revalidatePath` (94–105, no `await` inside) and (b) admin-bounded batch operations hard-capped at 100 files/IDs per window — not visitor-facing hot paths. Matches prior cycles' adjudication.

---

## Already-adjudicated (NOT re-filed)
- **R7C1-CR-02** — 1000-literal NOT IN bootstrap scan: MySQL handles it, startup-only, not a hot path. No new measured evidence to reopen.

---

## Conclusion

5th consecutive ZERO. Every bounded-resource invariant in the hot-path inventory was re-derived from current source line numbers and is intact: pixel-count OOM guard, 3×8 fan-out cap, per-decode `limitInputPixels`, NaN-safe queue/backfill concurrency with a verified 5-of-10 connection budget, single-`GROUP_CONCAT` tag aggregation, full index coverage for every query WHERE/ORDER BY, 5000-row CLIP scan with O(n log n) topK and pre-normalized dotProduct, 50 MB SW LRU with O(1)-amortized eviction and a 300 ms HEAD timeout, capped rate-limit maps, transferable histogram worker, and unref'd timers throughout. No N+1, no unbounded loop/allocation, no missing index, no blocking I/O on a request path, no missing memoization causing re-render storms.

The codebase is converged on the performance and concurrency axis. There is no honest micro-optimization to surface on a frozen, mature surface, and manufacturing one would violate the convergence-as-success contract.

**Verdict: APPROVE — 0 new actionable findings.**
