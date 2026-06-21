# Perf Reviewer — Run-9 Cycle-1 (HEAD `d3858cfc`)

**NEW FINDINGS: 0**

**Verdict (COMMENT):** No new performance or concurrency findings. HEAD `d3858cfc`
is **executable-byte-identical to the converged `f63af3b9`** — `git diff
f63af3b9..d3858cfc` is 12 files / +1310 lines, ALL of them `.context/reviews/run8-cycle2/`
review markdown (zero `apps/web/src` change). I did NOT rely on that fact alone:
every assigned hot path was re-opened and validated from source this cycle (not
from comments), and each is already optimized with prior findings addressed.
ZERO new findings is the honest result of a deep sweep, not a skipped one.

---

## Hot-path inventory (built first, then validated from source)

| File | Hot path | LoC | Validated state |
|---|---|---|---|
| `lib/data.ts` | masonry/listing queries, `tagNamesAgg` GROUP_CONCAT, `getImage` Promise.all, batched share-tags, cursor pagination, `Cached` dedup | 1660 | OPTIMIZED |
| `lib/process-image.ts` | 3-format parallel fan-out, serial size ladder, per-format fresh decode (WI-14), rgb16 path, 10-bit probe singleton, 50 MP downscale, `sharp.concurrency`/`cache(false)` | 1650 | OPTIMIZED |
| `lib/image-queue.ts` | PQueue concurrency, hourly GC interval (guarded+unref), keyset bootstrap, `NOT IN` failed-id exclusion | 786 | OPTIMIZED |
| `lib/admin-backfill-runner.ts` | `resolveBackfillConcurrency` pool-budget cap (+NaN guard), keyset batch loop | 871 | OPTIMIZED |
| `lib/serve-upload.ts` | settings-hash 5 s TTL + SWR + inflight dedup, HEAD/ETag short-circuit | 309 | OPTIMIZED |
| `lib/sw-cache.ts` | LRU insertion-order recency head-walk (no per-write sort) | 174 | OPTIMIZED |
| `lib/bounded-map.ts` | rate-limit prune+evict (O(maxKeys) bounded) | 143 | OPTIMIZED |
| `lib/rate-limit.ts` / `lib/auth-rate-limit.ts` | per-IP buckets, prune-on-increment | 449 / 137 | OPTIMIZED (carried deferral) |
| `lib/view-retention.ts` | chunked DELETE (5000/batch, 200-batch cap, indexed range) | 83 | OPTIMIZED |
| `lib/use-display-capability.ts` | snapshot value-memoization (React #185), paired MQ listeners | 140 | OPTIMIZED |
| `proxy.ts` | per-request CSP nonce + admin-cookie format guard (no DB, no crypto-verify) | 141 | OPTIMIZED |
| `components/histogram.tsx` | 256 px cap, worker O(n), transferable buffer, terminate-on-unmount, stale-response guard | — | OPTIMIZED |
| `components/lightbox.tsx` | slideshow `setInterval` cleared on 3 paths, ref-based advance callback | — | OPTIMIZED |
| `components/image-zoom.tsx` / `home-client.tsx` | ref-based transforms, rAF-debounced resize, memoized derivations | — | OPTIMIZED |

---

## Evidence validated from source this cycle

### DB query layer (`data.ts`)
- `tagNamesAgg` (`data.ts:603`) = ONE shared `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`, reused by all 4 masonry/listing queries + smart-collection/feed. No per-row N+1, no scalar-correlated-subquery NULL trap.
- Listing limit clamped to `LISTING_QUERY_LIMIT(=100)` / `…+1` on every listing query (`data.ts:747,770,828,909,933,1353`). Map markers capped at `MAP_MAX_MARKERS=10000` (`data.ts:1592`).
- `getImage` (`data.ts:1046`) collapses tags+prev+next into ONE `Promise.all` (3 queries → 1 round-trip), each with `.limit(1)`.
- `getSharedGroup` (`data.ts:1223-1246`) batches ALL image tags in a single `inArray` then groups in-memory — explicit N+1 avoidance verified at the source (not just the comment); result capped `.limit(100)` = `SHARE_MAX_IMAGES`.
- `searchImages` (`data.ts:1471-1528`) short-circuits the tag/alias queries when the main query fills the limit, else runs them in `Promise.all`.
- Composite indexes in CLAUDE.md match the actual sort/filter shapes (`processed,capture_date,created_at` etc.); view-retention range scan rides `(…, viewed_at)`.

### Sharp pipeline (`process-image.ts`)
- Fan-out is **3 formats in parallel, each format's size ladder serial** (`generateForFormat` `for (const size of sortedSizes)` at `:1082`, invoked via `Promise.all([webp,avif,jpeg])` at `:1265`). This correctly bounds peak memory at 3 concurrent decode pipelines, NOT N×3. Same-resize-width sizes within a format dedup via zero-copy `fs.link` (`:1096`, copyFile fallback).
- Per-format fresh `sharp(processingInputPath, …)` (`:1123/1126`) = the WI-14 cross-format-isolation tradeoff (decode reuse traded for correctness) — confirmed deliberate.
- `sharp.concurrency(max(1, floor((cores-1)/3)))` (`:44,50`) keeps per-image libvips threads ≈ `cores-1` across the 3-format fan-out — prevents libuv-pool drowning at `QUEUE_CONCURRENCY>1`. `sharp.cache(false)` (`:53`) for steady RSS (every UUID is a fresh decode, no cache hits anyway).
- 10-bit AVIF probe is a Promise-singleton (`_highBitdepthAvifProbePromise` `:69,120-122`) with 3-retry/backoff and permanent-vs-transient error split — observed once, no per-image race.
- 50 MP wide-gamut downscale guard (`:1004-1042`) writes a lossless-TIFF intermediate before the rgb16 fan-out, cleaned up in `finally` (`:1313-1316`). rgb16 (double peak RAM) only on the wide-gamut non-DCI-P3 path.

### Queue / backfill / pool
- PQueue default concurrency 1 (`image-queue.ts:168`), env-tunable; hourly GC interval guarded by `!state.gcInterval` (no double-arm) + `.unref?.()` (never blocks exit) + every callback `.catch()` (`:712-722`).
- `resolveBackfillConcurrency` (`admin-backfill-runner.ts:129-142`): `floor((10−5−1)/2)=2` workers, pinning ≤5 connections, leaving ≥5 for a live `getImage` fan-out. Has a NaN-guard (a NaN concurrency would silently freeze PQueue) — strong defensive design. Batch loop `for(;;)` (`:684`) breaks on empty keyset batch + restore-maintenance.
- Pool: `connectionLimit:10`, `queueLimit:20`, `enableKeepAlive:true` (`db/index.ts:23,31-35`) — matches docs.

### Serving / SW / React render paths
- `getServingColorSettingsHash` (`serve-upload.ts:50-83`) = 5 s TTL + stale-while-revalidate + single-inflight dedup ⇒ ≤1 `admin_settings` SELECT per 5 s under a masonry flood, and only on the SW-HEAD / missing-file fallback path (the static path — majority of traffic — never reaches serve-upload).
- `recordAndEvict` (`sw-cache.ts:95-149`): delete-then-set upsert makes Map insertion order = recency, so eviction is an O(n) head-walk — the prior O(n log n) per-write sort is gone. The remaining O(n) sum is inherent to whole-blob storage (off the main thread, in the SW).
- `useDisplayCapability.detect()` (`use-display-capability.ts:76-84`) returns the cached snapshot reference when `colorGamut`+`isHdr` are value-equal ⇒ satisfies `useSyncExternalStore` Object.is stability (React #185). All MQ + focus + visibilitychange listeners paired with removers (`:93-115`).
- Histogram: 256 px max-dim downscale before `getImageData` (`:180-219`), raw buffer transferred (zero-copy) to a Web Worker created once + `terminate()` on unmount (`:526-532`), `aborted` flag + AbortController discard stale responses, all `.catch()` handled.
- Lightbox slideshow `setInterval` cleared on `!isSlideshowActive`, effect cleanup, AND unmount (`:202-229`); advance via `onSlideshowAdvanceRef.current` ref (no stale closure / re-subscription).
- proxy middleware: per-request `crypto.randomUUID()` nonce (prod-only) + 2-iteration LOCALES loop + one regex; NO DB call, NO session crypto-verify (deferred to actions). Lightweight.

---

## Commonly-missed sweep — explicitly checked, none found

| Check | Method | Result |
|---|---|---|
| Sync FS on hot path | `grep readFileSync\|writeFileSync\|existsSync\|statSync\|readdirSync` in `lib/ app/api/ app/actions/` (non-test) | ZERO matches |
| `while(true)`/`for(;;)` unbounded | grep all of `lib/ app/ components/` | 1 hit (`admin-backfill-runner.ts:684`) — bounded by keyset empty-batch + restore-maintenance break |
| `setInterval` leak | grep + read each | gcInterval guarded+unref'd; lightbox slideshow cleared on 3 paths |
| Unbounded `for await` | grep | 1 hit (`process-image.ts:521`) — bounded directory scan, `dirHandle.close()` in finally |
| N+1 in listings/enrichment | read each query | None — `tagNamesAgg`, batched `inArray`, `Promise.all` prev/next/tags |
| Floating promise / unhandled rejection | grep bare `db.insert/update/delete` | Only deliberate fire-and-forget analytics writes (`public.ts:360/381/…`), each `.catch()`-guarded + per-IP rate-limited (120/min) |
| Per-render allocation (`new Intl` etc.) | grep components (non-memoized) | ZERO |
| Unbounded Map/Set growth | read bounded-map + all rate-limit buckets | All use `BoundedMap`/`createResetAtBoundedMap` with maxKeys + prune + FIFO evict; view-record + retry maps bounded |
| Unbounded GROUP BY / result set | read analytics + map + listing | Every query `.limit()`-capped |
| Lock leak on throw | (carried) `GET_LOCK`/`RELEASE_LOCK` in finally | Unchanged — evidence holds |
| Re-render storm (mousemove / MQ) | read image-zoom + use-display-capability | Ref-based DOM mutation; value-memoized snapshot |
| Pool exhaustion under backfill | read `resolveBackfillConcurrency` | Capped at 2, ≥5 reserved, NaN-guarded |

---

## Carried deferrals re-verified UNCHANGED — NOT re-raised (no new evidence)

- **R7C1-CR-02** [LOW] — two facets, same class:
  (a) the 1000-literal `notInArray(images.id, [...permanentlyFailedIds])` bootstrap scan (`image-queue.ts:627`, cap `MAX_PERMANENTLY_FAILED_IDS=1000`) — bootstrap-only, keyset-paginated, not a request hot path;
  (b) the unconditional per-request `prune(now)` O(maxKeys≤2000) scan on the OG/share/semantic/view-record buckets (`rate-limit.ts:222,267,296`; `public.ts:331`) — the search bucket already has a 1 s debounce (`SEARCH_RATE_LIMIT_PRUNE_INTERVAL_MS`, `:198`) and the others don't, but each bucket is itself per-IP rate-limited (30–120/min) so legitimate load is capped, and maxKeys≤2000 bounds worst case. No measured regression; exit criterion (measured CPU regression) not met. Adjudicated LOW, deferred. NOT re-filed.

## Refuted — NOT re-raised

- **MED-R7C2-01** — histogram clip-% "divides by red-channel total only" — REFUTED (the worker increments r/g/b once per pixel ⇒ `sum(r)=sum(g)=sum(b)=N`; per-channel divide-by-own-total is correct). Stays refuted.

---

## Recommendation

**COMMENT.** No actionable performance or concurrency findings. The codebase is
converged on this axis at HEAD `d3858cfc` (executable code byte-identical to the
converged `f63af3b9`). Every assigned hot path independently re-validated from
source; the two carried deferrals re-verified unchanged with no new evidence;
the one refuted item stays refuted. **NEW FINDINGS: 0.**
