# Perf Reviewer — Run-8 Cycle-2 (HEAD `f63af3b9`)

**NEW FINDINGS: 0**

**Verdict:** No new performance findings. The codebase is mature/converged; every assigned hot path was independently inspected and is already optimized with prior perf findings addressed and annotated in-source. The Stripe paid-download removal is **independently re-confirmed strictly subtractive** on every hot path — it never lost a `WHERE` clause, a JOIN, or a render guard; it only removed columns, a rate-limit bucket, render-side state/effects/allocations, and page-render awaits. A justified "0 new" per the run brief.

---

## Scope covered (hot-path inventory)

| File | Hot path | State |
|---|---|---|
| `apps/web/src/lib/data.ts` | masonry/listing queries, `tagNamesAgg` GROUP_CONCAT, `Cached` wrappers, `getImage` Promise.all, cursor pagination, N+1 batching | OPTIMIZED |
| `apps/web/src/lib/process-image.ts` | per-format fresh decode (WI-14), rgb16 wide-gamut path, 10-bit Promise-singleton probe, 50 MP downscale guard | OPTIMIZED |
| `apps/web/src/lib/image-queue.ts` | PQueue concurrency, chunked view-count flush, keyset bootstrap, bounded Map pruning | OPTIMIZED |
| `apps/web/src/lib/admin-backfill-runner.ts` | `resolveBackfillConcurrency` connection-budget cap, keyset batch O(batch) memory | OPTIMIZED |
| `apps/web/src/lib/serve-upload.ts` | settings-hash debounce (5 s TTL + SWR + inflight dedup), HEAD short-circuit, ETag 304 | OPTIMIZED |
| `apps/web/src/lib/sw-cache.ts` | LRU insertion-order recency head-walk (O(n), no per-write sort) | OPTIMIZED |
| `apps/web/src/lib/use-display-capability.ts` | snapshot memoization (React #185 fix) | OPTIMIZED |
| `apps/web/src/components/histogram.tsx` | 256 px canvas cap, worker O(n), module singletons, AbortController | OPTIMIZED |
| `apps/web/src/components/image-zoom.tsx` | ref-based DOM transform (no re-render on move) | OPTIMIZED |
| `apps/web/src/components/home-client.tsx` | pure-CSS masonry, rAF-debounced resize, memoized derivations, CLS reservation | OPTIMIZED |

---

## Evidence — DB query layer (`data.ts`)

- `tagNamesAgg` (`data.ts:603`) is the single shared `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. Reused by `getImagesLite`/`getImagesLitePage`/`getAdminImagesLite`/`getImages`/`getImagesForSmartCollection`/`getImagesForFeed` — no per-row N+1, no scalar-correlated-subquery NULL trap (the documented production regression). Listing payload is capped (`LISTING_QUERY_LIMIT=100`, `data.ts:609`) and `blur_data_url` is excluded from listings (`_largePayloadGuard`, `data.ts:445-448`) to keep SSR HTML lean.
- `getImage` (`data.ts:1046-1092`) parallelizes tags + prev + next in ONE `Promise.all` (3 queries → 1 round-trip). Prev/next conditions are built dynamically to eliminate dead `sql\`FALSE\`` branches (C6-AGG6R-01). `getImage` retains 1 of the file's 4 `Promise.all` sites — unchanged by the removal.
- `getSharedGroup` batches all image tags in a single `inArray` query (`data.ts:1227-1234`) — N+1 explicitly avoided; result `.limit(100)` matches `SHARE_MAX_IMAGES`.
- `getLatestImageForOg` (`data.ts:871-885`) is the purpose-built minimal `id,title` accessor for the home OG card — no tag JOIN, no aggregation, single `LIMIT 1` over the homepage composite index. Correctly NOT a substitute for `getImagesLite`.
- `getMapImages` (`data.ts:1574-1604`) carries the `MAP_MAX_MARKERS=10000` cap (AGG-H4) closing the prior unbounded-result path.
- `searchImages` (`data.ts:1453-1540`) short-circuits when the main query fills the limit (`data.ts:1476`), then runs tag+alias queries in parallel — 3 sequential rounds collapsed to ≤ 2.
- 10 `Cached` wrappers + `getSeoSettings` provide React `cache()` SSR dedup (`data.ts:1606-1660`).

## Evidence — Sharp pipeline (`process-image.ts`)

- Per-format fresh `sharp(processingInputPath, …)` per output (`process-image.ts:1121-1127`) is the WI-14 cross-format-isolation trade-off — documented as deliberately trading decode reuse for correctness. Within a format, same-size variants dedup via zero-copy `fs.link` (`process-image.ts:1090-1099`).
- The 10-bit AVIF probe is a Promise-singleton (`_highBitdepthAvifProbePromise`, `process-image.ts:69,119-123`) — first caller triggers a 2×2 probe, all concurrent callers await the same promise (C12-LOW-04). No per-image race or repeated probe.
- 50 MP wide-gamut downscale guard (`process-image.ts:1022-1042`) writes a lossless TIFF intermediate before rgb16 fan-out, capping peak RAM. `rgb16` (double peak RAM) is only entered on the wide-gamut, non-DCI-P3 path (`process-image.ts:1121`).
- Metadata is read once per call with `autoOrient` (`process-image.ts:1019`); the +10–30 ms re-read vs threading metadata through callers is an explicitly-accepted personal-gallery-scale trade-off (R7-L7).

## Evidence — queue / backfill

- PQueue default concurrency 1 (`image-queue.ts:168`), tunable via `QUEUE_CONCURRENCY`; one job already fans AVIF/WebP/JPEG in parallel.
- View-count flush chunks at `FLUSH_CHUNK_SIZE=20` (`data.ts:61,103-105`) to bound concurrent promises against the 10-connection pool; exponential backoff on DB outage.
- `resolveBackfillConcurrency` (`admin-backfill-runner.ts:129-142`) clamps to `max(1, floor((LIMIT−RESERVED−1)/2))` with `RESERVED=max(3, ceil(LIMIT/2))` = 2 at pool 10, reserving ≥ 5 connections for a live `getImage` fan-out. Keyset-paginated `fetchCandidateBatch` (`admin-backfill-runner.ts:387-411`) keeps memory O(batch=100) not O(gallery).

## Evidence — serving / SW / React

- `getServingColorSettingsHash` (`serve-upload.ts:50-83`) is a module-scoped 5 s TTL + stale-while-revalidate + single-inflight dedup — restores the "no per-file `admin_settings` SELECT under a masonry flood" contract while preserving R8-H1 validated-value semantics. HEAD short-circuit (`serve-upload.ts:257-259`) and ETag 304 (`serve-upload.ts:223-235`) avoid body/fd work.
- `recordAndEvict` (`sw-cache.ts:95-149`) uses delete-then-set upsert so Map insertion order tracks recency → eviction is an O(n) head-walk, eliminating the prior per-write O(n log n) sort (AGG-H3). SW HEAD revalidate is bounded by `AbortSignal.timeout(300 ms)` (per CLAUDE.md AGG-R8-05) so a slow network never stalls a warm paint.
- `useDisplayCapability.detect()` (`use-display-capability.ts:76-84`) returns a value-memoized stable reference, the documented `useSyncExternalStore` React #185 infinite-loop fix.
- Histogram: 256 px canvas cap (`histogram.tsx:180`), worker-driven O(n) with transferable `ArrayBuffer` (`histogram.tsx:165`), module-scope canvas-P3 / AVIF-support / `P3_CTX_OPTIONS` singletons, per-load AbortController. Clip-% sums per channel (`histogram.tsx:322,332`) — correct; the MED-R7C2-01 "divide by red-total only" claim was 3-way REFUTED and is NOT re-filed.
- ImageZoom applies transforms via `innerRef.current.style.transform` (`image-zoom.tsx:56-68`) — pan/pinch/wheel mutate refs, never state, so no React re-render on move. `reducedMotionRef` keeps the MQ off the render path.
- home-client masonry is pure CSS columns with rAF-debounced resize (`home-client.tsx:47-53`), memoized `topicsMap`/`displayTags`/`estimatedCardWidth`/`initialLoadMoreCursor`, and per-card `aspectRatio` + `containIntrinsicSize` CLS reservation with a 0-dimension guard (AGG-R8-08).

---

## Removal blast-radius re-verification (independent)

Diffed `6c5e0b61^..47b1e21f` (the full Stripe-removal range) on every hot-path file:

- `data.ts`: ONLY change is dropping `license_tier: images.license_tier` from `adminSelectFields` (one column). Strictly fewer bytes per row on every listing/detail query; no WHERE/JOIN/GROUP BY change. (Confirms cycle-1 perf-reviewer.)
- `rate-limit.ts`: DELETED the `checkoutRateLimit` bucket + `CHECKOUT_WINDOW_MS`/`CHECKOUT_MAX_REQUESTS`. Net **−1** per-process Map and **−1** `prune()` call on the relevant request paths — a memory/CPU reduction. (The remaining per-request `prune()` calls are the same carried R7C1-CR-02 deferral class; NOT re-raised, and the removal only made it lighter.)
- `process-image.ts`: comment-only (`:1534-1539`). Zero functional change.
- `photo-viewer.tsx`: −108 lines including a deleted `useState(isCheckingOut)`, a `useEffect`, and a per-render `new Intl.NumberFormat(...).format(...)` price-format allocation → strictly fewer hooks + allocations on the photo-viewer render path.
- `images.ts`: removed `licenseTier` validation branches + a `setClause` write → fewer per-action operations; no query added.
- `p/[id]/page.tsx`: removed the `searchParams` await (paid `?session_id=` handling) → one fewer await on the photo-page render path.
- `grep` for `license_tier|licenseTier|entitlement|CHECKOUT_|stripe` in `src` (non-test): **0 live references** — no dangling cost.

No query lost a `processed = true` / WHERE guard; no render lost a memo/guard. The removal is monotonically cheaper.

---

## Carried perf-class deferrals (re-verified UNCHANGED — NOT re-raised)

- **R7C1-CR-02** [LOW] — 1000-literal `NOT IN` bootstrap scan (`image-queue.ts:626-628`, cap `MAX_PERMANENTLY_FAILED_IDS=1000` at `:83`). Bootstrap-only (not request hot path), latency-only, MySQL handles it fine. Re-verified no regression; per the run brief this and the unconditional per-request rate-limit `prune()` observation are the SAME deferral class — do not re-file.

## Refuted (NOT re-filed)

- **MED-R7C2-01** — Histogram RGB clip % "divides by red-channel total only" — REFUTED 3-way; the worker increments r/g/b once per pixel so `sum(r)=sum(g)=sum(b)=N`; per-channel divide-by-its-own-total is correct. Stays refuted.

## Recommendation

**COMMENT** — no actionable perf findings; no perf regression from the Stripe removal (independently re-confirmed strictly subtractive on every hot path). NEW FINDINGS: 0.
