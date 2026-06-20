# Performance & Concurrency Review — Run-7 Cycle-3 (perf-reviewer)

**Reviewer:** perf-reviewer
**HEAD:** `c6eff919` (master, 2026-06-19)
**Scope:** Performance, concurrency, CPU/memory/UI-responsiveness across the whole repo — image pipeline, queues, DB queries, indexes, React components, SW cache, analytics aggregation, CLIP embedding/search, download streaming, pool budget, rate-limit Maps.
**Prior context:** Run-7 cycle-1 AND cycle-2 perf-reviewer both reported ZERO findings. This is the 3rd consecutive perf pass on a converged surface.
**Verdict: APPROVE — ZERO new performance or concurrency defects found. Nothing new actionable.**

---

## Summary

A fresh, eyes-on-code audit (not a delta-trust pass) of every performance- and concurrency-sensitive surface was performed at HEAD `c6eff919`. I re-derived the bounds for each hot path from current line numbers rather than relying on prior-cycle summaries. The codebase remains converged on the performance/concurrency axis. No CRITICAL, HIGH, MEDIUM, or LOW performance or concurrency defect surfaced.

**Delta since cycle-2 HEAD `1cdbb883` (the two cycle-2 fixes + docs/stamp):**
- `ae5e82cb` — NCLX transfer code 5 → `gamma28`: a constant-map value edit (`color-detection.ts:181`), one `transferFunction` union member (`:25`), one `humanizeTransferFunction` switch case (`color-details-section.tsx:79`), one i18n key. The map is a `Record<number, …>` indexed by integer code — O(1), evaluated once per image at parse time. **Zero perf impact.**
- `eff5d8d6` — browser GPS-toggle source-contract test (`images-action-gps-toggle-wiring.test.ts`): test-only.
- `c6eff919` — `public/sw.js` SW_VERSION stamp regen (`6bb5a49a-p7` → `c6eff919-p7`): string-stamp only; the LRU / HEAD-revalidate / network-first logic is byte-identical. (The uncommitted working-tree `sw.js` diff is the same stamp regen for current HEAD — confirmed stamp-only.)

Both cycle-2 fixes are perf-neutral, exactly as the class of the cycle-1 fixes was. So this cycle is a genuine fresh sweep of the unchanged hot paths, not a delta check.

---

## Surfaces examined this cycle (eyes-on-code, current line numbers)

### A. Image pipeline — rgb16 wide-gamut OOM guard + per-format fan-out (`lib/process-image.ts`)
- **50 MP wide-gamut OOM guard CONFIRMED BOUNDED** (`:1004-1042`): `WIDE_GAMUT_MAX_SOURCE_PIXELS` (default 50 M, admin-tunable). When `isWideGamutSource && basePixels > cap`, the source is proportionally downscaled (`scale = sqrt(cap/basePixels)`) to a lossless LZW TIFF intermediate with `keepIccProfile()` BEFORE fan-out, so the rgb16 (16-bit, 2× peak RAM) pipeline never sees an oversized buffer. Intermediate cleaned up in `finally` (`:1313-1316`).
- **Decompression-bomb mitigation present on every Sharp constructor:** `limitInputPixels: maxInputPixels` on all `sharp(...)` calls (`:1019, :1035, :1123, :1126, :1608`, etc.).
- **Per-format fresh-decode (AGG-R7-08 deliberate cost) is bounded:** `generateForFormat` opens a fresh `sharp(processingInputPath, …)` per format to eliminate cross-format shared-state contamination (`:1123-1126`). Within a format, adjacent sizes that clamp to the same `resizeWidth` (source smaller than ladder entry) are **hard-linked** (`fs.link`, zero-copy), falling back to `copyFile` cross-device (`:1090-1099`) — so the decode-reuse tradeoff is partially recovered for free.
- **Fan-out concurrency bounded by the QUEUE, not unbounded:** the 3 formats run via `Promise.all` (`:1265-1269`), but the PQueue concurrency is `Number(process.env.QUEUE_CONCURRENCY) || 1` (`image-queue.ts:168`) — one image at a time. Peak = 3 Sharp pipelines, deliberate.
- **Partial-write cleanup is comprehensive:** on any mid-size throw, `writtenSizedPaths[{webp,avif,jpeg}]` are all unlinked (`:1306-1310`) so a failed encode leaves the variant dir as it was.

### B. Image queue concurrency + claim locks (`lib/image-queue.ts`)
- PQueue concurrency default 1 (`:168`). Per-image processing claim via `gallerykit:image-processing:{jobId}` advisory lock + `WHERE processed = false` conditional UPDATE. Bootstrap scan gated by `MAX_PERMANENTLY_FAILED_IDS = 1000` (the R7C1-CR-02 1000-literal `NOT IN` — DEFERRED, NOT re-raised, runs once at startup).

### C. Connection pool budget + backfill concurrency (`db/index.ts`, `admin-backfill-runner.ts`)
- Pool: `connectionLimit = 10`, `queueLimit = 20`, keepalive (`db/index.ts:23-37`).
- **`resolveBackfillConcurrency` arithmetic re-verified correct** (`admin-backfill-runner.ts:129-142`): `cap = max(1, floor((limit − reserved − 1) / 2))`, `reserved = max(3, ceil(limit/2))` → at pool 10, cap = 2 (backfill pins ≤ 1 lock + 2×2 worker = 5, leaves ≥ 5 free). **NaN guard present** (`Number.isFinite(poolLimit) ? poolLimit : 10`, `:137`) — a NaN concurrency would freeze PQueue at zero tasks; explicitly defended. Requests above cap clamped DOWN with a warning.
- **`group_concat_max_len = 65535` set per physical connection** (`db/index.ts:62`) on the `'connection'` event (once per new connection, NOT per checkout), awaited via an init-promise on `getConnection` (`:78-81`). This pre-empts the classic MySQL default-1024 GROUP_CONCAT silent-truncation gotcha for the tag-aggregation queries. Resolved-promise await after first connection = negligible overhead.

### D. DB query patterns / N+1 / indexes (`lib/data.ts`)
- **`tagNamesAgg`** = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over `LEFT JOIN … GROUP BY images.id` (`:605`) — one query, no N+1; locked by `data-tag-names-sql.test.ts`.
- **Shared-group tags** fetched in ONE batched `inArray(imageTags.imageId, imageIds)` query then grouped in-memory via a `Map` (`:1228-1248`) — explicitly NOT N+1. Group images hard-capped at `.limit(100)` (`:1223`).
- **Search** (`searchImages`, `:1455-1542`): main query short-circuits when it fills `effectiveLimit` (`:1478`), skipping the tag+alias round-trips; tag+alias run in parallel `Promise.all` only when needed, each `.limit(remainingLimit)`-bounded, `notInArray(mainIds)` bounded by the small search limit, final dedup via `Set`. Worst-case rows ≤ `2 × effectiveLimit`.
- **Map markers** hard-capped at `MAP_MAX_MARKERS = 10000` with deterministic ORDER BY (`:1567`, AGG-H4) — the documented public unbounded-result fix.
- **Sitemap** query `.limit(Math.min(max(limit,1),50000))` (`:1547`), id+created_at only, no JOINs/TEXT.
- Composite indexes (per CLAUDE.md / schema) match the listing/nav/topic/analytics query shapes.

### E. CLIP embedding/search (`app/api/search/semantic/route.ts`, `lib/clip-embeddings.ts`)
- **Scan HARD-capped:** `SEMANTIC_SCAN_LIMIT = 5000` with `eq(modelVersion)` filter + `desc(updatedAt)` order (index-backed) (`route.ts:251-256`).
- **Per-request synchronous CPU bounded:** ≤ 5000 rows × 512-dim `dotProduct` (`clip-embeddings.ts:49-56`, simple Float32Array loop, no allocation). Production uses `dotProduct` (unit-vector fast path, skips norm recompute + 2 sqrts); stub correctly stays on `cosineSimilarity`. Total ≈ 2.56M MAC/request ≈ low-single-digit ms; route is rate-limited.
- **`topK` = filter → sort → slice** (`clip-embeddings.ts:137-142`): O(n log n) at n ≤ 5000 ≈ trivial; input not mutated.
- **Malformed-embedding rows skipped** via `decodeEmbeddingColumn → null → .filter` (`route.ts:272-279`) — one corrupt row can't 500 the whole search. (The route-level mixed-set test gap is TE-R7C2-03, a DEFERRED LOW test concern, not a perf defect.)
- Enrichment is a single `inArray(images.id, resultIds)` batched query (`route.ts:291-313`) — no N+1.

### F. React UI hot paths (main-thread jank)
- **Masonry resize** (`home-client.tsx:38-59`): `requestAnimationFrame`-debounced with `cancelAnimationFrame` on rapid resize AND on unmount cleanup; `removeEventListener` in the effect return. No jank, no leak.
- **Histogram** (`histogram.tsx`): the pixel-binning loop runs in a Web Worker (`histogram-worker.js:25-34`); the only main-thread op is `getImageData` on a ≤ 256×256 canvas (`:218-219`). The ArrayBuffer is passed **transferable** (zero-copy) — `worker.postMessage({…}, [payload.imageData])` (`:165`). Per-request `requestId` correlation, AbortSignal cleanup, `worker.terminate()` on unmount (`:529`), lazy-mounted. Exemplary.
- **`useDisplayCapability`** (`use-display-capability.ts`): value-cached `getSnapshot` returns a stable reference (React #185 `useSyncExternalStore` infinite-loop invariant) — re-verified intact (no code change since cycle-2's verification; the only edit there was a comment in `10108963`).
- **`ImageZoom`**: ref-based DOM mutation on mousemove (no React re-render) — unchanged.

### G. SW cache (`lib/sw-cache.ts`, `public/sw.template.js`)
- Image-derivative LRU capped at `MAX_IMAGE_CACHE_BYTES = 50 MB` (`sw-cache.ts:19`); trim sorts by timestamp O(n log n) only at near-cap write (documented tradeoff, `:108`).
- Synchronous HEAD revalidation bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS = 300)` (`sw.template.js:38, :239`) — a slow/hung network aborts the probe and serves cached bytes immediately + revalidates in background. Warm masonry paint never stalls per-tile.

### H. Analytics aggregation (`lib/analytics-data.ts`)
- Every `groupBy` query carries `.limit()` (top-photos 20, top-topics 20, country 30, referrer 20, shared-groups 20). No unbounded GROUP BY.
- The `'all'` time-window aggregation (no `viewed_at` predicate) does a covering-index temp-table aggregation, **bounded by `VIEW_RETENTION_DAYS` retention GC** (`:95-110`). Index reordering deliberately deferred pending EXPLAIN evidence ("measure first" — PERF-R5C2-01). No new evidence this cycle.

### I. Rate-limit Maps + view-count buffer (memory-leak / unbounded-Map check)
- **Every rate-limit Map is a `BoundedMap`** with an explicit `MAX_KEYS` cap (login/password-change 5000; search/og/checkout/share 2000) and window/resetAt eviction (`rate-limit.ts`, `auth-rate-limit.ts`). `BoundedMap.prune` does collect-then-delete expired + oldest-first hard-cap eviction (`bounded-map.ts:98-129`).
- **View-count buffer** (`data.ts:17-200`): atomic Map-swap on flush, chunked drain (`FLUSH_CHUNK_SIZE = 20`), `MAX_VIEW_COUNT_BUFFER_SIZE = 1000` drop-on-full, `viewCountRetryCount` capped at `MAX_VIEW_COUNT_RETRY_SIZE = 500` with eviction, exponential backoff on consecutive flush failures, `unref()`'d timer. Fully bounded.

### J. Download streaming (`app/api/download/[imageId]/route.ts`)
- True streaming via `createReadStream` (`autoClose` default) — file body never buffered into the JS heap; every failure path closes the FileHandle (re-confirmed from cycle-2 evidence; route unchanged in delta).

---

## Commonly-missed perf issues — explicitly checked, none found

| Check | Result |
|---|---|
| Unbounded Map / Set growth | None — all rate-limit + buffer + retry Maps are `BoundedMap`/explicit-cap with eviction |
| N+1 query in listings / enrichment | None — `tagNamesAgg`, batched `inArray` (shared-group tags, semantic enrichment, bulk tag add/remove), parallel `Promise.all` |
| Serial `await` inside a loop scaling with data volume | One bounded instance: bulk caption-apply (`images.ts:1017-1027`) does per-row `UPDATE` because each row gets a DISTINCT `alt_text_suggested` value (cannot collapse to one `inArray` UPDATE); **hard-capped at `ids.length > 100` rejection** (`:887`), admin-only, explicit action — NOT a hot path, NOT scheduling-worthy. The seo/settings upsert loops (`seo.ts:139`, `settings.ts:141`) iterate a fixed small SEO key set, not data-scaled. |
| GROUP_CONCAT silent truncation (MySQL default 1024) | None — `group_concat_max_len = 65535` set per connection (`db/index.ts:62`) |
| rgb16 wide-gamut OOM | None — 50 MP downscale gate to lossless TIFF intermediate before fan-out |
| Blocking sync I/O on hot paths | None — no `*Sync` fs in lib/api/actions (cycle-1/2 grep evidence holds; no relevant file changed) |
| Unbounded GROUP BY aggregation | None — every analytics `groupBy` has `.limit()`; 'all' bounded by retention GC |
| Pool exhaustion under backfill | None — `resolveBackfillConcurrency` caps workers (≤ 5 of 10) with NaN guard, reserves ≥ 5 for live traffic |
| Main-thread jank (resize / histogram) | None — RAF-debounced resize, worker-offloaded histogram with transferable ArrayBuffer |
| `useSyncExternalStore` snapshot churn | None — value-cached stable snapshot (React #185 invariant intact) |
| Large synchronous JSON parse/stringify | None — semantic body parse is small; embeddings are raw MEDIUMBLOB float32 (no JSON) |
| Worker / listener / timer leak | None — histogram worker `terminate()`d, every `addEventListener` paired with removal, view-count timer `unref()`'d and nulled-on-entry |
| CLIP scan / topK unbounded | None — `SEMANTIC_SCAN_LIMIT = 5000` hard cap, `topK` O(n log n), `dotProduct` fast path |
| SW LRU / HEAD-revalidate stall | None — 50 MB LRU, 300 ms `AbortSignal.timeout` on HEAD probe |
| Transferable vs structured-clone in worker postMessage | Transferable used (`[payload.imageData]`) — zero-copy |

---

## Deferred register — no re-raises

All carried perf-adjacent deferrals (R7C1-CR-02 1000-literal `NOT IN`; R7C1-CR-03 `'XX'` sentinel / analytics 'all'-window index; DEF-C11-01 search input `h-8`) were reviewed for new evidence — none surfaced. They remain correctly deferred and are NOT re-raised. The refuted **MED-R7C2-01 histogram clip-% math** was NOT re-litigated (channel totals provably equal = N; the proposed fix is a 3× under-report regression — leave both clip sites alone). No item from the cycle-2 rejected-candidates list was re-manufactured.

---

## Issues Found

**None.**

---

## Recommendation

**APPROVE.** Third consecutive zero-finding perf pass. The codebase is converged on the performance and concurrency axis at HEAD `c6eff919`. The two cycle-2 fixes introduce no perf-impacting executable change (O(1) constant-map edit + union member + switch case + i18n key). Every hot path — image pipeline OOM guard, per-format fan-out, queue/backfill concurrency budget, DB query bounds + indexes, CLIP scan/topK, masonry RAF debounce, transferable histogram worker, SW LRU, rate-limit BoundedMaps, view-count buffer, analytics limits, download streaming — was re-verified bounded from current source. The single per-row-serial-await (bulk caption apply) is hard-capped at 100 admin-initiated rows with genuinely distinct per-row values and is not a hot path. Nothing new actionable to schedule.
