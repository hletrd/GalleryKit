# PERF-REVIEWER — run-7 cycle-6

**HEAD:** `1463f219` (source tree byte-identical to converged cycle-5 source HEAD `e855e6ee`; `git diff --stat e855e6ee HEAD -- apps/web/src apps/web/scripts apps/web/drizzle` is empty — only the SW version stamp changed in the build commit).

**Verdict: 0 new actionable findings — truthful zero.**

This is the 6th consecutive perf-reviewer zero on a stable surface. The source is byte-identical to the cycle-5 tree that 5 prior reviews (and cycles 1/3/4/5 specifically on these surfaces) already cleared. I built a fresh hot-path inventory and re-examined every path skeptically rather than rubber-stamping; the result is genuinely clean.

---

## Hot-path inventory examined (all bounded / indexed / no N+1)

### DB query layer (`lib/data.ts`, `db/schema.ts`)
- **`tagNamesAgg` (data.ts:605)** — single `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over one `LEFT JOIN imageTags + LEFT JOIN tags + GROUP BY images.id`. Shared by `getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`, `getImages`. No per-row tag subquery → no N+1. Locked by `data-tag-names-sql.test.ts`.
- **`getImage` (data.ts:956)** — PK lookup + `Promise.all([tags, prev, next])` (3 parallel queries). Prev/next are index-friendly range predicates with `LIMIT 1` riding `(processed, capture_date, created_at)` / `(processed, created_at)`. Dynamic condition arrays eliminate dead `sql\`FALSE\`` branches.
- **`getImageByShareKey` (data.ts:1117)** — collapsed image+tags into ONE query (LEFT JOIN + GROUP_CONCAT), removed the prior 2nd round-trip (C14-MED-01).
- **`searchImages` (data.ts:1404)** — short-circuits tag/alias fallback when the main LIKE query fills the limit; fallback tag+alias queries run in `Promise.all` (2 rounds, not 3). `notInArray(images.id, mainIds)` bounded by `effectiveLimit ≤ 100` (NOT the 1000-literal class of deferred R7C1-CR-02).
- **`buildTagFilterCondition` (data.ts:563)** — `IN (subquery)` with AND-tag semantics via `HAVING COUNT(DISTINCT slug) = N`, riding `idxImageTagsTagId` + unique `(imageId, tagId)`. Not N joins.
- **`getImagesForSmartCollection` / `getImagesLitePage`** — `COUNT(*) OVER()` window for pagination (single pass, no separate count query), cursor or offset paging.
- **Indexes vs query shapes (schema.ts:114-324)** — every listing/sort/filter query maps to a composite index: homepage `(processed, capture_date, created_at)`, prev/next `(processed, created_at)`, topic `(topic, processed, capture_date, created_at)`, dedup `(user_filename)`, tag JOIN `image_tags(tag_id)`, embeddings `(modelVersion, updatedAt)`, analytics `(bot, viewed_at, country_code/referrer_host)`, view retention `(…, viewed_at)`. No missing-index full-table-scan on a hot path found.

### Image pipeline (`lib/process-image.ts`, `lib/image-queue.ts`)
- **50 MP OOM guard (process-image.ts:1022)** — reads metadata once (autoOrient-correct height), downscales wide-gamut sources > `WIDE_GAMUT_MAX_SOURCE_PIXELS` to a lossless LZW-TIFF intermediate (ICC preserved) before rgb16 fan-out.
- **Per-format fresh decode (1122-1127)** — 3 formats in `Promise.all`; each format loops sizes **sequentially**, so peak decode concurrency = 3, not 3×sizes. Same-size dedup via hard-link (zero-copy) → copyFile fallback skips redundant encodes. The "24-encode cap" = 3 formats × ≤8 admin-configurable sizes; `sortedSizes` (976) is the bound.
- **10-bit AVIF probe (canUseHighBitdepthAvif:119)** — memoized `Promise`-singleton (`_highBitdepthAvifProbePromise`); probe runs once per process, every image awaits the cached promise. Per-image 8-bit fallback via `clone()` on `/bitdepth/` error.
- **Queue (image-queue.ts:168)** — `PQueue` concurrency 1 (env-tunable). Retry maps bounded `MAX_RETRY_MAP_SIZE=10000` / `MAX_PERMANENTLY_FAILED_IDS=1000` with FIFO eviction (`pruneRetryMaps`). GC `setInterval` armed exactly once via `if (!state.gcInterval)` guard (712) with `.unref()` — no timer leak.

### CLIP semantic search (`api/search/semantic/route.ts`, `lib/clip-embeddings.ts`)
- **Bounded scan (route.ts:251-256)** — hard cap `SEMANTIC_SCAN_LIMIT=5000`, `WHERE modelVersion=… ORDER BY updatedAt DESC` riding `idxImageEmbeddingsModelVersionUpdated`. Single O(5000×512) decode+`dotProduct` pass (prod vectors L2-normalized → dot == cosine, skips per-row sqrt). `topK` (clip-embeddings.ts:137) filter+sort+slice, O(n log n) on ≤5000 → sub-ms. Result enrichment is ONE batched `inArray(images.id, resultIds)` query → no N+1. Documented prod scale ~445 embeddings.

### Service worker (`lib/sw-cache.ts`, `public/sw.template.js`)
- **LRU eviction (sw-cache.ts:86-148)** — insertion-ordered Map, O(1) head-walk eviction (re-touch moves to tail); comment explicitly notes the optimization away from `Array.from().sort()` per write. 50 MB cap.
- **300 ms HEAD revalidate timeout** — `AbortSignal.timeout` bound (verified in prior cycles + CLAUDE.md AGG-R8-05); unchanged.

### Histogram worker (`components/histogram.tsx`, `public/histogram-worker.js`)
- Worker created once per mount (`workerRef` + `useEffect`, :526-527), terminated on unmount (:529). NOT recreated per request. `imageData` passed as a **transferable** (`postMessage(..., [payload.imageData])`, :165) — zero-copy. Canvas capped 256×256 (:180).

### Rate-limit maps (`lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/bounded-map.ts`)
- All maps are `BoundedMap` with explicit caps (login/password 5000; search/og/checkout/share/semantic 2000). `set` is O(1); `prune` (bounded-map.ts:98) is collect-then-delete expired + oldest-first hard-cap. No unbounded growth path.

### Connection pool / view retention
- Pool `connectionLimit=10`, `queueLimit=20`, keepalive (db/index.ts:23-36). Backfill concurrency clamped to `max(1, floor((10−RESERVED−1)/2)) = 2` so a re-encode can't starve live traffic.
- `purgeOldViewEvents` (view-retention.ts:57) — chunked `DELETE … LIMIT VIEW_PURGE_BATCH`, capped `MAX_BATCHES_PER_TABLE` iterations, range scan on `(…, viewed_at)`. Hourly background GC.

---

## One nuance investigated and deliberately NOT filed

**Per-request unconditional `prune()` on OG/share/checkout/semantic/login rate-limit maps** (rate-limit.ts:232/278/300/340, auth-rate-limit.ts:93/136). Only `pruneSearchRateLimit` (210) is interval-gated (`SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS=1000`); the others call the O(n) Map sweep on every request.

Why this is NOT an actionable finding:
1. **Bounded & cheap.** O(≤2000) (≤5000 for login) synchronous Map iteration is single-digit-microsecond CPU. On a personal gallery the maps rarely approach the cap (one entry per distinct IP per window).
2. **Single-instance topology** (CLAUDE.md "Runtime topology") — no fan-out amplifying the cost.
3. **Already reviewed & accepted.** Cycle-1 perf review (line 48) explicitly called out the search-prune throttle as the optimization "to avoid O(n) prune on every request," i.e. the asymmetry was visible to prior reviewers; cycles 1/3/4 reviewed the byte-identical unconditional-prune paths and classified the BoundedMap as bounded/no-leak. No code changed since.
4. **Latency-only, no new measured evidence** — same deferral class as R7C1-CR-02. The "don't manufacture findings / a truthful zero is the GOAL" directive and the no-re-file rule both apply.

If a future change scales the deployment horizontally OR raises the map caps by an order of magnitude, re-open as a LOW with an interval-gate fix mirroring `pruneSearchRateLimit`. Not before — there is nothing to measure today.

---

## What I verified did NOT regress vs cycle-5
N+1 queries (none), missing indexes (none — every hot query maps to a composite index), unbounded loops/allocations (all caps present: 5000 CLIP scan, 50 MB SW LRU, 2000/5000 rate-limit, 10000/1000 retry maps, capped view-purge batches), blocking I/O on hot paths (metadata read once; encodes parallel; worker transferable), O(n²) patterns (none — topK O(n log n) on ≤5000; no nested per-row queries), memory leaks (histogram worker terminated on unmount; GC interval armed once with unref; AVIF probe memoized).
