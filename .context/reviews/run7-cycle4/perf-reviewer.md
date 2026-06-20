# Performance & Concurrency Review — Run-7 Cycle-4 (perf-reviewer)

**Reviewer:** perf-reviewer
**HEAD:** `25bb2794` (master, 2026-06-20)
**Scope:** Hot paths and bounded-resource invariants across the whole repo — image pipeline, image queue, connection-pool budget, backfill concurrency, DB query shapes (N+1 / unbounded), CLIP embedding scan + search, SW LRU cache, rate-limit Maps, view-count buffer, histogram worker, React render/dedup paths, download streaming, analytics aggregation.
**Prior context:** Run-7 cycle-1, cycle-2, AND cycle-3 perf-reviewer all reported ZERO findings. This is the 4th consecutive perf pass on a converged surface.
**Method:** Eyes-on-code, re-derived every hot-path bound from CURRENT line numbers (not a delta-trust pass). Adjudicated items NOT re-raised (see below).

**Verdict: APPROVE — ZERO new performance or concurrency defects. Truthful zero. No micro-optimizations manufactured.**

---

## Delta since cycle-3 HEAD `c6eff919` — provably perf-neutral by construction

`git diff --stat c6eff919..25bb2794` = 16 files: 12 are `.context/reviews/run7-cycle3/*.md` review docs, 1 is `CLAUDE.md` prose (2-line edit), 1 is the `public/sw.js` SW_VERSION stamp regen, and ONLY TWO are application source files:

1. **`src/lib/color-detection.ts` (+17/−8) — COMMENT-ONLY.** Filtered the diff for added non-comment lines: **zero**. Every `+` line is a comment expanding the NCLX transfer-map rationale (xvYCC code 11 uses the BT.709 curve; BT.2020 codes 14/15 transfer vs. the BT.2020-NCL *matrix* name). The `NCLX_TRANSFER_MAP` VALUES are byte-identical (`8:'linear'`, `11:'srgb'`, `13:'srgb'`, `14/15→gamma24` unchanged). The map remains a `Record<number, …>` — O(1) lookup, evaluated once per image at parse time inside `detectColorSignals`. **Zero perf impact.**

2. **`src/lib/settings-hash.ts` (+13) — COMPILE-TIME GUARD ONLY (AGG-R7C3-02).** Added a `type _ColorKeysAreSettingKeys = … extends GallerySettingKey ? true : never` (erased at compile), one module-load-time `const _colorKeysAreSettingKeys = true`, and a `void` statement. This is a single boolean assignment evaluated ONCE at module init — it never runs on any request hot path. The actual `computeSettingsHash` / ETag logic is untouched. **Zero perf impact.**

3. **`public/sw.js` (+4/−4):** `__SW_VERSION__` stamp regen (`c6eff919-p7` → `25bb2794-p7`). The LRU / HEAD-revalidate / network-first logic is byte-identical to the cycle-3-verified template. (The uncommitted working-tree `sw.js` diff, if any, is the same stamp regen.)

Both source edits are in the exact perf-neutral class as the cycle-1/2/3 fixes (constant-map comments, type guards, doc/stamp). This cycle is therefore a genuine FRESH sweep of the unchanged hot paths, not a delta check.

---

## Hot-path inventory — bounds re-derived from CURRENT line numbers (all BOUNDED)

### A. Image pipeline — rgb16 wide-gamut OOM guard + per-format fan-out (`lib/process-image.ts`)
- **50 MP wide-gamut OOM guard CONFIRMED BOUNDED** (`:1004-1042`): `WIDE_GAMUT_MAX_SOURCE_PIXELS = wideGamutMaxSourcePixels ?? 50_000_000` (`:1004`). When `isWideGamutSource && basePixels > cap` (`:1022`), the source is proportionally downscaled (`scale = Math.sqrt(cap / basePixels)`, `:1023`) to a lossless intermediate via a fresh bounded `sharp(...)` (`:1035`) BEFORE the rgb16 (16-bit, ~2× peak RAM) fan-out, so the wide-gamut pipeline never sees an oversized buffer.
- **`limitInputPixels: maxInputPixels` on EVERY Sharp constructor** (`:91, :835, :1019, :1035, :1123, :1126, :1608`) — decompression-bomb mitigation present on all decode entry points.
- **Per-format fresh-decode (AGG-R7-08 deliberate cost) is bounded:** `needsRgb16 = isWideGamutSource && !isDciP3` (`:1121`) selects the rgb16-vs-plain decode; each format opens its own `sharp(processingInputPath, …)` (`:1123/:1126`) to eliminate cross-format shared-state contamination. Trades decode reuse for correctness, deliberately.
- **Fan-out concurrency bounded by the QUEUE, not unbounded:** the 3 formats run concurrently, but PQueue concurrency is `Number(process.env.QUEUE_CONCURRENCY) || 1` (`image-queue.ts:168`) — one image at a time. Peak = 3 Sharp pipelines per in-flight image, deliberate and bounded.

### B. Image queue concurrency + claim locks (`lib/image-queue.ts`)
- PQueue concurrency default 1 (`:168`).
- Bootstrap permanently-failed exclusion: `MAX_PERMANENTLY_FAILED_IDS = 1000` (`:83`), FIFO-evicted (`:499-502`), fed into the bootstrap scan as `notInArray(images.id, [...state.permanentlyFailedIds])` (`:627`). **This is R7C1-CR-02 (the 1000-literal `NOT IN`) — DEFERRED (latency-only, bounded, runs once at startup). NOT re-raised.**
- Per-image processing claim via `gallerykit:image-processing:{jobId}` advisory lock + `WHERE processed = false` conditional UPDATE — two workers cannot double-convert.

### C. Connection-pool budget + backfill concurrency cap (`db/index.ts`, `lib/admin-backfill-runner.ts`)
- Pool: `connectionLimit = POOL_CONNECTION_LIMIT` (`db/index.ts:31`), `queueLimit = 20` (`:33`), keepalive (`:36`).
- **`group_concat_max_len = 65535` set per physical connection** on the `'connection'` event (`db/index.ts:62`), awaited via init-promise — pre-empts the MySQL default-1024 GROUP_CONCAT silent-truncation gotcha for tag aggregation. Once-per-new-connection, negligible.
- **`resolveBackfillConcurrency` arithmetic re-verified correct** (`admin-backfill-runner.ts:129-140`): `reserved = max(3, ceil(limit/2))` (`BACKFILL_RESERVED_LIVE_CONNECTIONS`, `:105-106`); `cap = max(1, floor((limit − reserved − 1) / 2))` (`:139`). At pool 10 → `reserved = 5`, `cap = floor((10−5−1)/2) = 2` (backfill pins ≤ 1 lock + 2×2 worker = 5, leaves ≥ 5 free for live `getImage` fan-outs). **NaN guard present:** `limit = Number.isFinite(poolLimit) ? poolLimit : 10` (`:137`) — a NaN concurrency would freeze PQueue at zero tasks; explicitly defended. Requests clamped DOWN above cap (`:140`).

### D. DB query patterns / N+1 / unbounded (`lib/data.ts`, `lib/analytics-data.ts`)
- **`tagNamesAgg`** = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` (`data.ts:605`), reused as a single shared constant across ALL masonry queries (`:734, :783, :833, :899, :1359`) over `LEFT JOIN … GROUP BY images.id` — one query each, no N+1. Locked by `data-tag-names-sql.test.ts`.
- **`getImage` parallelizes** tags + prev + next via `Promise.all` (`:1048`); `getTopicsWithAliases` parallelizes topics + aliases (`:490`); `searchImages` parallelizes tag + alias round-trips only when the main query underfills (`:1513`).
- **Combined-GROUP_CONCAT for slug+name** uses a null-byte inner delimiter + CHAR(1) separator (`:1137`) — one query, parsed in-memory, no N+1.
- **N+1 / await-in-loop sweep:** grep for `for … await` / `await … for (` across `data.ts` + `analytics-data.ts` returned NOTHING — no serial-await loops.

### E. CLIP embedding scan + search (`app/api/search/semantic/route.ts`, `lib/clip-embeddings.ts`)
- **Scan HARD-capped:** `.limit(SEMANTIC_SCAN_LIMIT)` = 5000 (`route.ts:256`) with `eq(modelVersion)` filter + `desc(updatedAt)` (index-backed) order.
- **Per-request CPU bounded:** ≤ 5000 rows × 512-dim. `similarity = isProd ? dotProduct : cosineSimilarity` (`route.ts:271`) — prod uses the unit-vector `dotProduct` fast path (vectors L2-normalized at write); stub correctly stays on `cosineSimilarity` (`clip-embeddings.ts`). `topK` = filter → sort → slice (`route.ts:281`), O(n log n) at n ≤ 5000 ≈ trivial.
- **`topK` param clamped:** `Math.min(Math.max(…, 1), SEMANTIC_TOP_K_MAX)` with `Number.isFinite` guard (`route.ts:91`) — array/non-number topK can't escape the bound.

### F. SW cache (`lib/sw-cache.ts`, `public/sw.template.js`)
- Image-derivative LRU capped at `MAX_IMAGE_CACHE_BYTES = 50 * 1024 * 1024` (`sw-cache.ts:19`). Trim evicts oldest-first from the front, no per-write sort on the hot path (`:108-128`, documented O(n log n)-avoidance).
- HTML offline cache capped at `MAX_HTML_ENTRIES = 50` (`sw.template.js:33`), oldest-slice eviction (`:141`).
- Synchronous HEAD revalidation bounded by `AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS = 300)` (`sw.template.js:38, :239`) — slow/hung network aborts the probe, serves cached bytes immediately + revalidates in background. Warm masonry paint never stalls per-tile.

### G. Rate-limit Maps + view-count buffer (`lib/bounded-map.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `data.ts`)
- **`BoundedMap`** (`bounded-map.ts:32`): `prune(now)` does collect-then-delete of expired keys (ES6-safe but explicit, `:98-114`) THEN hard-cap oldest-first eviction when `size > maxKeys` (`:116-128`). Every rate-limit Map carries an explicit `MAX_KEYS` cap. No unbounded Map growth.
- **View-count buffer** (`data.ts`): atomic Map-swap on flush, chunked drain, drop-on-full, retry-count cap with eviction, exponential backoff, `unref()`'d timer (re-confirmed; unchanged in delta).

### H. Histogram worker (`components/histogram.tsx`, worker)
- Pixel-binning runs in a Web Worker; the only main-thread op is `ctx.getImageData` on a ≤ 256×256 canvas (`maxDim = 256`, `:180`; `getImageData`, `:219`).
- **ArrayBuffer passed TRANSFERABLE (zero-copy):** `worker.postMessage({ requestId, ...payload }, [payload.imageData])` (`:165`) — the second arg is the transfer list. `imageData: ArrayBuffer` typed (`:22`), `transfer?: Transferable[]` in the worker-port type (`:40`). Per-request `requestId` correlation; lazy-mounted. Exemplary.

### I. Download streaming (`app/api/download/[imageId]/route.ts`)
- True `createReadStream` (autoClose) — file body never buffered into the JS heap; every failure path closes the FileHandle (re-confirmed from cycle-2/3 evidence; route unchanged in delta).

### J. Analytics aggregation (`lib/analytics-data.ts`)
- Every `groupBy` query carries `.limit()` (top-photos/topics 20, country 30, referrer 20, shared-groups 20). No unbounded GROUP BY. The `'all'` window aggregation is bounded by `VIEW_RETENTION_DAYS` retention GC. Index reordering remains deferred pending EXPLAIN evidence (PERF-R5C2-01, "measure first") — no new evidence this cycle.

---

## Adjudicated items — explicitly NOT re-raised (re-verified unchanged)
- **R7C1-CR-02** (1000-literal `NOT IN` bootstrap exclusion, `image-queue.ts:83/:627`) — DEFERRED (latency-only, bounded, once-at-startup). Confirmed unchanged. Not re-raised.
- **MED-R7C2-01** (histogram clip) — REFUTED prior cycle. Histogram path unchanged. Not re-raised.
- **REJ-R7C3-01** (indexSize) — DISPROVED prior cycle. Not re-raised.

## Commonly-missed perf issues — explicitly checked, none found
- await-in-for serial loops (none in data/analytics) · unbounded Maps (all BoundedMap-capped) · unbounded GROUP BY (all `.limit()`) · N+1 (all batched `inArray` / single GROUP_CONCAT) · main-thread pixel loops (worker + transferable) · per-request O(n²) (CLIP/search/topK all O(n log n) at hard cap) · unref'd timers (view-count timer unref'd) · Sharp decode without `limitInputPixels` (all guarded) · NaN-into-PQueue-concurrency (guarded) · per-checkout connection init cost (group_concat set once per physical connection).

---

## Conclusion
4th consecutive ZERO. The only source delta since cycle-3 is a comment block and a compile-time type guard — both perf-neutral by construction (no runtime code, no new loop, no new allocation, no new I/O, no new query). Every bounded-resource invariant in the hot-path inventory was re-derived from current line numbers and is intact. No new performance or concurrency defect, and no honest micro-optimization to surface on a converged surface.

**Verdict: APPROVE — 0 findings.**
