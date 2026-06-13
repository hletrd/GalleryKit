# PERF-REVIEWER — Run-5 Cycle-3 Deep Review

**Lane:** performance / race-conditions / shared-state / memory / DB / UI-responsiveness / SW
**Repo:** GalleryKit (`/Users/hletrd/flash-shared/gallery`, `apps/web`)
**Diff under extra scrutiny:** `aa5266b5..HEAD` (21 cycle-2 commits, 54 files)
**Suppression honored:** plan-315 / plan-316 / plan-317 / plan-322 + run5-cycle2 `_aggregate.md`. Cross-references called out inline; already-planned items NOT re-reported as new.

Stance: I started hostile (assume unoptimized until proven). The cycle-2 diff is, frankly, *clean* — most of it is comment additions, type-narrowing (`'disabled'|'stub'|'production'` → `'disabled'|'stub'`), `server-only` guarding, a11y `min-h-11` adds, and test hardening. The genuinely new runtime surface is `admin-backfill-runner.ts` (+332 lines: per-image advisory lock + observability counters). That is where my attention concentrated. The masonry/lightbox/histogram client surfaces, the SW image SWR path, and the analytics buffering were all swept full-repo, not just the diff.

---

## Findings

### PERF-R5C3-01 — Backfill runner can hold up to `1 + 2×ADMIN_BACKFILL_CONCURRENCY` pool connections, starving the shared 10-connection pool
- **Severity:** MED · **Confidence:** High · **Status:** confirmed (code-traced)
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:155-220, 273-396, 433-434`; pool config `apps/web/src/db/index.ts:13-26` (`connectionLimit: 10`, `queueLimit: 20`).
- **Problem:** The backfill draws from the SAME `mysql.createPool` (limit 10) that serves every live page render, server action, and analytics insert. Per-run connection accounting:
  - `runBackfill` holds the dedicated **lock connection** for the entire run (`acquireBackfillLock`, :155-174 → handed off at :574, released only in the `finally` at :536). That is **1 connection pinned for the whole backfill duration** (could be minutes-to-hours on a large gallery).
  - Each in-flight `reprocessOne` calls `acquireImageProcessingClaim(row.id)` (:286, :195-211) which grabs **another** pool connection and holds it across the FULL encode→detect→UPDATE window (released in `finally` at :394). That is **1 connection per concurrent worker**, held for the entire per-image encode (seconds, not milliseconds).
  - Inside that window, `db.execute(UPDATE …)` (:353, :384) and the `detectColorSignals` metadata reads route through the wrapped `poolConnection.execute`/`db` path (`db/index.ts:83-90`), each transiently acquiring **a third** connection while the claim connection is already pinned.
  - Worst-case simultaneous hold = `1 (lock) + N (claims) + up to N (transient UPDATE/detect) = 1 + 2N` where `N = ADMIN_BACKFILL_CONCURRENCY`.
- **Failure scenario:** Default `N=1` → up to 3 connections pinned, 7 free — fine. But the env var is documented as raisable (CLAUDE.md backfill block; runner header comment "Operators on a host with spare CPU can raise this"). At `N=4`, worst-case = **9 of 10 connections** pinned by the backfill, leaving 1 for all live traffic. A modest concurrent page-render burst then queues against `queueLimit: 20` and, past that, throws `ER_CON_COUNT_ERROR`/queue-full — the public gallery 500s **while an admin-triggered maintenance op runs in the background**. The lock connection alone being pinned for the whole run also means one connection is permanently unavailable to live traffic for the run's duration even at `N=1`.
- **Fix:**
  1. Cap effective concurrency against the pool: `const concurrency = Math.min(Math.max(1, Number(process.env.ADMIN_BACKFILL_CONCURRENCY) || 1), Math.floor((POOL_LIMIT - 2) / 2))` so the backfill can never claim more than a safe fraction of the pool. Surface `POOL_LIMIT` from `db/index.ts` as an export rather than hardcoding 10.
  2. Document the connection-budget arithmetic in the runner header (it currently only discusses Sharp/libheif worker capacity, not DB pool pressure) so an operator raising the knob understands the pool cost, not just the CPU cost.
  3. Optional: give the backfill its OWN small mysql pool (dedicated 2-3 connections) so it is structurally isolated from the live-traffic pool — strongest fix, but more code.

### PERF-R5C3-02 — `evictHtmlCacheIfNeeded` re-fetches every cached HTML response body to read one timestamp header on every HTML cache write
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed
- **Where:** `apps/web/public/sw.template.js:119-136` (`evictHtmlCacheIfNeeded`), called from `networkFirstHtml:264` after every cacheable 200 HTML response.
- **Problem:** On each cached HTML write, the function calls `htmlCache.keys()` then `await htmlCache.match(key)` **for every entry** (up to `MAX_HTML_ENTRIES = 50`) purely to read the `sw-cached-at` header. `cache.match` deserializes the full cached Response (HTML body included) just to inspect a header — up to 50 full-document reads per navigation that crosses the cap, on the SW thread that the next navigation's `respondWith` competes with.
- **Failure scenario:** Bounded (≤50 docs, only when over cap), so not hot. But it is wasted work on the SW event loop: a user browsing 51+ public pages offline-cacheable pays a ~50× `cache.match` sweep on each subsequent navigation. On a Pentium-III-class device the body deserialization is measurable jank on the cache-write path.
- **Fix:** Mirror the image cache's metadata-document pattern (`getMeta`/`setMeta`, :65-86) — keep a tiny `{url: timestamp}` map for HTML entries in `META_CACHE` and sort/evict from that instead of `match`-ing every body. Note: AGG-R5C2-36 already schedules a meta-write rework for the IMAGE cache inside plan-315 item 16; this is the **HTML-cache twin** of that concern and is NOT covered by item 16's image-only scope — fold it into the same rework or track separately.

### PERF-R5C3-03 — Backfill `reprocessOne` decodes the original a second time for `detectColorSignals` after `processImageFormats` already decoded it
- **Severity:** LOW · **Confidence:** High · **Status:** confirmed (pre-existing; sidecar mirrors it)
- **Where:** `apps/web/src/lib/admin-backfill-runner.ts:295-310` (`processImageFormats`) then `:331-337` (fresh `sharp(originalPath, …)` + `image.metadata()` + `detectColorSignals`). Same shape in the sidecar `scripts/backfill-color-pipeline.ts:168-174`. `processImageFormats` returns only `{ wasDownscaled, avif10bit }` (`process-image.ts:1282`).
- **Problem:** Re-encoding a backfill candidate decodes the original (inside `processImageFormats`, which itself constructs per-format fresh `sharp(inputPath)` instances per WI-14), then a SECOND independent `sharp(originalPath)` is built to re-run color detection. For a 50 MP wide-gamut original this is a full redundant decode + ISOBMFF/ICC walk per backfilled image.
- **Failure scenario:** Rare admin-triggered maintenance op, sequential at default concurrency — so low blast radius. But on a full-gallery re-encode (every photo, pipeline-version bump) this doubles the dominant decode cost across the whole library. At 10k photos that is 10k extra full decodes of (often) 20-50 MP sources.
- **Fix:** Thread the detected signals OUT of `processImageFormats` (it already runs `detectColorSignals` internally during encode-decision resolution — return them alongside `wasDownscaled`/`avif10bit`) so the backfill UPDATE consumes the same detection result instead of re-decoding. If the internal detection point differs from what the backfill needs, at minimum reuse a single `sharp` instance + buffered `metadata()` across both the encode and detect calls. Verify against the WI-14 "per-format fresh sharp to avoid cross-format contamination" constraint — the detect-only instance can be shared since it does not encode.

### PERF-R5C3-04 — Semantic search scans up to 5000 rows, allocating a base64 string + Buffer + Float32Array per row per request
- **Severity:** LOW · **Confidence:** Med · **Status:** confirmed (bounded by rate limit + stub-only gate)
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:229-258`; `SEMANTIC_SCAN_LIMIT = 5000`, `EMBEDDING_BYTES = 2048` (`clip-embeddings.ts:9,14`).
- **Problem:** Each request loads up to 5000 embedding rows (`embedding` is the base64 TEXT, ~2.7 KB each → ~13 MB of base64 strings pulled from MySQL into the Node heap), then per row allocates `Buffer.from(base64)` (2 KB) + `bufferToEmbedding` → a new `Float32Array(512)` (:243-256). That is up to ~15k short-lived allocations + ~10 MB transient heap churn per request, plus the cosine loop (512 mul-adds × 5000 = 2.56M FLOPs — that part is fine, ~1-2 ms).
- **Failure scenario:** Gated to `semantic_search_mode === 'stub'` (default disabled) and rate-capped at 30 req/min/IP. So worst case is a single admin-enabled demo gallery taking a GC-pressure spike per query. Not a production hot path today. If `'production'` mode ever ships and traffic rises, this becomes a real allocator/GC problem.
- **Fix (when/if promoted past stub):** Store embeddings as raw `MEDIUMBLOB` (already noted as the intended storage in `embeddingToBuffer`'s docstring) rather than base64 TEXT, eliminating the base64-decode allocation; reuse a single scratch `Float32Array` across the scan loop (read-decode-score-discard) instead of allocating one per row; consider a `LIMIT`-bounded SQL-side pre-filter once a real ANN index exists. No action required at stub scale — flag for the production-encoder milestone.

---

## Already-planned / suppressed (cross-referenced, NOT re-reported)

| Item | Owner | Note |
|---|---|---|
| SW image SWR still does a **blocking HEAD before serving cached bytes** (`sw.template.js:207-237`) — warm-cache paint gated on per-image RTT | **plan-315 item 16 (PERF-R5C1-07)** — confirmed NOT yet landed (only a doc-comment touched in `f212e84c`); folds COR-R5C1-05 | The core un-block fix is owned there; I verified the blocking shape is still present and correctly suppressed. |
| SW `recordAndEvict` rewrites the full LRU meta document per image cache write (`sw.template.js:90-117`) | **AGG-R5C2-36**, folded into plan-315 item 16 rework | Deferred-with-rider; PERF-R5C3-02 above is the HTML-cache twin, which item 16's image-only scope does NOT cover. |
| `getImage` prev/next 4-way OR predicate defeats index range scan (`data.ts:954-1061`) | **plan-317 deferred #3 (PERF-R5C1-06)** — needs EXPLAIN on ≥100k seeded table | Confirmed still present; exit criterion recorded; not re-reported. |
| `getTopics` correlated `MAX(updated_at)` subquery per topic (`data.ts:452-473`) | **plan-317 deferred #2 (PERF-R5C1-04)** | ISR-cached sitemap consumer; "no action today". |
| `getCountryBreakdown`/`getReferrerBreakdown` `'all'`-window temp-table aggregation (`analytics-data.ts:112-213`) | **plan-322 #3 (PERF-R5C2-01)** + in-file index-utilization comment | Index re-order deferred pending EXPLAIN; the new in-file comment block is accurate. |
| Backfill candidate scan lacks `(processed, pipeline_version, id)` index (`admin-backfill-runner.ts:222-263`) | **plan-322 #1 (PERF-R5C2-02)** | Deferred until large-gallery latency evidence; the keyset walk itself is correct. |
| `getTopPhotosByViews` lacks `(bot, viewed_at, image_id)` index (`analytics-data.ts:28-54`) | **plan-322 #2 (PERF-R5C2-03)** | needs-EXPLAIN; deferred. |
| `revalidate = 0` on all public pages → pool pressure under spike (`db/index.ts:19-21`) | **plan-317 deferred #1 (PERF-R5C1-05)** | Documented product trade-off; PERF-R5C3-01 above is a DISTINCT, code-traced backfill-pool concern, not this. |
| Masonry `containIntrinsicSize` uses 300px constant not column-derived (`home-client.tsx:261`) | **plan-315 item 26 (DES-R5C1-09)** | CLS hint; owned there. |
| `searchImages` LIKE scan | code-reviewer-verified known/mitigated (PERF-R5C1-08, rate-capped) | No action. |
| Per-group view-count buffered flush undercount | TRC-R5C1-07 / PERF-R5C1-09 — documented best-effort | No action. |

---

## Verified-clean (swept, no finding)

- **`image-queue.ts` claim/lock flow** — per-image `GET_LOCK(name, 0)` non-blocking claim (:193-210), conditional `WHERE processed = false` UPDATE (:368-370), delete-while-processing cleanup (:372-381), retry/claim-retry Maps bounded (`MAX_RETRY_MAP_SIZE`, FIFO prune :96-109), `permanentlyFailedIds` FIFO-capped at 1000 with associated-map cleanup on evict (:477-488). Lock connection always released in `finally` (:520). Bootstrap keyset walk (`bootstrapCursorId`, `notInArray` exclusion) terminates correctly. `unref()` on all timers/intervals so they never pin the event loop. Caption + embedding hooks are correctly fire-and-forget (`void (async …)`, `.catch`) so they never block the queue job. **No race, no leak, no UI-blocking.**
- **Backfill per-image lock correctness (AGG-R5C2-08 fix)** — `acquireImageProcessingClaim` here uses identical 0-second non-blocking semantics to the queue worker; skip-on-held (`reason: 'locked'`, no version bump → stays a candidate) is correct; lock held across full encode→detect→UPDATE window; released in `finally` with `.catch`. The double-encode race with `retryFailedImage` is genuinely closed. (Connection-budget side-effect is PERF-R5C3-01.)
- **`db/index.ts` pool wrapper** — `getConnection`/`query`/`execute` wrappers correctly await the per-connection `SET group_concat_max_len` init promise and release in `finally`; no connection leak in the wrapped paths.
- **Histogram (`histogram.tsx`)** — 256px canvas cap, Web Worker offload with **zero-copy transferable** `ArrayBuffer` postMessage (:165), `AbortController` cancellation + request-id race guard (:142-167), P3-context options hoisted to module scope (:79-81), canvas-P3 probe + AVIF-support promise memoized at module scope. Main-thread work is one `drawImage`+`getImageData` on a 256px canvas. **INP-safe.**
- **`search.tsx`** — 300 ms debounce (:225-227), monotonic `requestIdRef` race protection across BOTH awaits in the semantic branch (:159, :175) and the keyword branch (:194), stale-ref clearing, per-row fallback state via `SearchResultItem`. No keystroke-per-API-call. Clean.
- **Semantic route enrichment** — single batched `inArray` hydration query (:268-284), NOT an N+1; `scoreMap` O(1) lookup; rate-limit pre-increment/rollback (Pattern 2) correct.
- **Analytics insert path (`public.ts:354-405`)** — fire-and-forget `db.insert(...).catch()`, per-IP rate-limited (`isViewRecordRateLimited`), input-validated before the INSERT. Never blocks render.
- **`cleanOrphanedTmpFiles` (`image-queue.ts:30-71`)** — parallel `Promise.all` over 3 dirs, `Promise.allSettled` unlinks, narrowed ENOENT catch. Good.

---

## Areas covered

Diff sweep (all 54 files reviewed); plus full-repo sweep of: `admin-backfill-runner.ts` (deep), `image-queue.ts` (deep — claim/lock/bootstrap/retry-maps), `db/index.ts` (pool wrapper + limits), `analytics-data.ts` (all 5 aggregation queries), `public.ts` (view-record buffering), `data.ts` (public/admin select shapes, `getTopics`, prev/next adjacency), `sw.template.js` (image SWR + HTML network-first + LRU eviction), `search.tsx` (debounce/race), `api/search/semantic/route.ts` (scan/score/enrich), `clip-embeddings.ts` (cosine loop), `histogram.tsx` (worker/canvas/INP), `photo-title.ts`, `caption-constants.ts`/`caption-generator.ts` (server-only guard), `home-client.tsx` (masonry/CLS), `process-image.ts` + sidecar backfill (double-decode). Race/shared-state, CPU, memory/allocator, DB index use + N+1, UI INP/CLS, SW cache behavior, connection-pool pressure all examined.

**Verdict: FIX AND SHIP.** One MED (PERF-R5C3-01, bounded by default config but a real foot-gun the docs actively encourage stepping on) + three LOW. No CRIT, no HIGH, no new race, no unbounded growth, no UI-thread blocking introduced by the cycle-2 work. The diff is high-quality; the only genuinely new runtime surface (backfill per-image lock) is correct on the concurrency axis but quietly expensive on the connection-pool axis.
