# Performance & Concurrency Review — GalleryKit

**HEAD:** `4eb83aab` (branch master) · **Agent:** perf-reviewer · **Date:** 2026-06-17
**Run/Cycle:** Run 6 / Cycle 6 (review-plan-fix loop)
**Prior perf baselines:** 2f603716 (cycle-5 perf), f8147868 (cycle-4 perf)
**Scope:** CPU/memory/I/O hotspots; DB query shapes vs composite indexes; N+1; connection-pool & async-queue concurrency; Sharp pipeline throughput + buffer duplication; UI responsiveness (re-render storms / layout thrash / INP / CLS / LCP); `useSyncExternalStore` snapshot stability (React #185); worker/canvas cost; service-worker LRU eviction correctness; advisory-lock hold time; bounded-Map growth & eviction cost; floating-promise throughput; timer-handle leaks; bulk-mutation server-action loops.

---

## Verdict

**Honest convergence — ZERO actionable performance/concurrency findings (0 CRIT / 0 HIGH / 0 MED / 0 LOW).**

This is the correct, desirable outcome. The system has converged hard (findings 11 → 45 → 14 → 5 → 1 across cycles 1–5). I did NOT inherit the prior cycle-6 `0`; I re-derived every hot path from current-HEAD source and re-verified the delta mechanically. The conclusion holds: no shipping source line that affects a request hot path changed since the cycle-4 perf baseline, and the unchanged hot paths are correct under independent re-examination.

Confidence labels below reflect how certain the (absence-of-)impact assessment is.

| Severity | New this cycle | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 0 | — |

---

## Mechanical delta verification (HEAD-verified, not trusted)

**Working tree:** only `.context/reviews/*.md` are modified. `git status --short` over `apps/web/src/**`, `apps/web/scripts/**`, `apps/web/public/**` (excluding `__tests__`) is empty — no dirty shipping source.

**Cycle-5 → cycle-6 (`2f603716..4eb83aab`):** test files + plan/review docs ONLY. The single non-doc file is `src/__tests__/client-server-only-boundary.test.ts` (AGG-C5-01, a TEST). No shipping source changed since the last perf review.

**Cumulative cycle-4 → HEAD (`f8147868..4eb83aab`)** over `apps/web/{src,scripts,public}` = 6 files; only 2 ship:

| File | Change | Perf verdict |
|---|---|---|
| `scripts/backfill-color-pipeline.ts` | Two pure exported helpers — `countDeletedMidReencodeDetectionFailures(derivativeResults)` (`:159`, O(batch) `.filter().length`) and `computeBackfillExitCode({errors,detectionFailures})` (`:174`, constant-time boolean) — plus `collectDeletedMidReencodeFiles` (`:142`) and a small `detectionFailures` accounting subtraction in `flushBatch`. | **Neutral** (confidence HIGH). All pure, O(batch) over already-materialized ≤100-element (`BATCH_SIZE`) arrays, called once per flush / once at process exit. This is the deliberately `concurrency`-serialized, advisory-locked (`gallerykit_color_pipeline_backfill`), operator-triggered sidecar — NOT a request path. Re-read `:120-208` at HEAD; genuinely bounded. |
| `src/components/ui/switch.tsx` | Comment-only docblock fix. | **Neutral** (confidence HIGH). Render shape, state, effects, handlers identical. |
| 4 test files | non-shipping | Neutral. |

**Hot-path files confirmed byte-identical to f8147868** (`git diff --stat f8147868..HEAD -- <file>` empty for each): `lib/process-image.ts`, `lib/color-detection.ts`, `lib/data.ts`, `lib/image-queue.ts`, `lib/serve-upload.ts`, `lib/sw-cache.ts`, `public/sw.js`, `components/home-client.tsx`, `components/photo-viewer.tsx`, `components/histogram.tsx`, `db/schema.ts`, `lib/use-display-capability.ts`, `lib/auth-rate-limit.ts`, `lib/rate-limit.ts`. **No public API route changed** (`src/app/api/**` diff empty); `lib/serve-upload.ts`, `lib/gallery-config.ts`, `lib/analytics-data.ts` diffs empty.

---

## Independent HEAD re-derivation (read fresh at 4eb83aab — not inherited)

The empty diff only proves "no NEW regression introduced." To catch a latent pre-existing regression, I re-examined each hot path from current source.

### 1. Data access (`lib/data.ts`) — SQL shapes, N+1, GROUP_CONCAT
- All masonry-list queries (`getImagesLite` `:728`, `getImagesLitePage` `:818`, `getAdminImagesLite`, full `getImages`, `getImagesForFeed` `:771`) use the **single shared `tagNamesAgg`** constant (`:605`) = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over one `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. **No N+1** — tags aggregate in the same round-trip, not per-row. The legacy scalar-subquery shape (the production NULL bug, commit aca754c) is gone and locked by `data-tag-names-sql.test.ts`.
- `getImage()` `:1048` parallelizes tags + prev + next via `Promise.all`. Correct.
- View-count flush `:103-105` chunks at `FLUSH_CHUNK_SIZE=20` with `Promise.all` per chunk — bounded concurrent DB promises, not a fan-all-at-once.
- Every `for…of` loop (`:497`, `:1161`, `:1239`, `:1535`, `:1597`) iterates an in-memory result array, never issuing a DB call per iteration. No hidden N+1.
- View-count buffer is bounded: `MAX_VIEW_COUNT_BUFFER_SIZE=1000` drop-on-cap (`:47-51`), `MAX_VIEW_COUNT_RETRY_SIZE=500` + `VIEW_COUNT_MAX_RETRIES=3` (`:22-27`), atomic Map swap on flush, exponential backoff `getNextFlushInterval()` (`:37-41`), timer `.unref()`'d (`:55`). COR-R4C11-01 timer-handle-null-on-entry fix present (`:75`). No unbounded growth, no timer leak.

### 2. Index coverage vs query shapes (`db/schema.ts`)
- Listing sort `(capture_date DESC, created_at DESC, id DESC)` + `processed` filter → `idx_images_processed_capture_date (processed, capture_date, created_at)` `:114`. Covered.
- prev/next nav → `idx_images_processed_created_at (processed, created_at)` `:115`. Covered.
- Topic-filtered listing → `idx_images_topic (topic, processed, capture_date, created_at)` `:116`. Covered.
- Tag JOIN → `idx_image_tags_tag_id` `:132` + `image_tags_image_id_tag_id_unique` `:131`. Covered.
- Upload-attribution → `idx_images_uploaded_by` `:118`. Analytics breakdowns → `idx_image_views_bot_viewed_country` / `_referrer` `:232-233`. Covered.
- **`getImagesForFeed` (`:771`) sorts by `(updated_at DESC, created_at DESC, id DESC)` with no matching `(processed, updated_at)` index → a MySQL filesort.** Assessed and INTENTIONALLY NOT REPORTED as a finding: (a) pre-existing — present in the cycle-4 baseline (`git show f8147868:…/data.ts | grep -c getImagesForFeed` = 2), not a new regression; (b) bounded by `safeLimit` ≤ `LISTING_QUERY_LIMIT_PLUS_ONE`; (c) Atom/RSS feed is a low-frequency, cacheable, non-interactive route; (d) filesort over a few-thousand-row personal gallery is sub-millisecond. Adding a `(processed, updated_at, created_at, id)` index would be a speculative micro-optimization with index-write cost on every upload/edit — not worth a code change at this scale. Confidence HIGH that this is acceptable as-is.

### 3. Sharp pipeline (`lib/process-image.ts`)
- 3-format fan-out in parallel via `Promise.all` (`:1265`). Per-format **fresh `sharp(inputPath, …)` instances** (`:1123-1127`) — the WI-14 fix that eliminates shared-state cross-format contamination; this trades one extra decode for correctness and is the documented contract.
- Single decode reused via `.clone()` for the 16px blur (`:872`). `sequentialRead: true` + `limitInputPixels` (decompression-bomb cap) + `autoOrient` set per constructor (`:835`, `:1019`).
- `pipelineColorspace('rgb16')` only on the wide-gamut branch (`:1124`); DCI-P3 deliberately skips rgb16 to keep its source ICC for the Bradford transform — correct, no wasted 16-bit pipeline on sRGB.
- Failure path (`:1306`) and downscaled-intermediate cleanup (`:1314`) both parallelized / bounded. No buffer-decode duplication beyond the intentional per-format isolation. Confidence HIGH.

### 4. Image queue concurrency (`lib/image-queue.ts`)
- `PQueue({ concurrency: QUEUE_CONCURRENCY || 1 })` (`:168`) — single-writer topology by default, matching the documented single-instance Docker deployment.
- Per-job MySQL advisory lock via `GET_LOCK(?, 0)` non-blocking (`:199`) paired with `WHERE processed = false` conditional UPDATE — two workers across a restart boundary cannot double-encode; the loser detects already-processed and cleans up. Lock acquired on a dedicated path, released on connection close. No lock held across the full Sharp encode in a way that would serialize unrelated work beyond the intended single-writer model. Confidence HIGH.

### 5. Service-worker LRU (`lib/sw-cache.ts`)
- `MAX_IMAGE_CACHE_BYTES = 50 MB` (`:19`). Eviction (`:100-148`) is an **O(k) head-walk**, NOT `Array.from().sort()` O(n log n) — the design comment at `:108-111` documents that a re-touched entry is moved to the Map tail (`delete` + re-`set`) so the oldest sits at the head and eviction walks from the front until under cap. Drift-tolerant accounting (`:134-140`, R4C6 TEST-R4C6-11) handles cache.delete() returning false. This is the correct stale-while-revalidate LRU. Confidence HIGH.

### 6. Rate-limit maps (`lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/bounded-map.ts`)
- Every in-memory limiter is a `BoundedMap` with an explicit hard cap: login 5000, search/OG/checkout/share/semantic 2000 (`rate-limit.ts:63-337`), password-change 5000 (`auth-rate-limit.ts:11`).
- `set()` is O(1) (`bounded-map.ts:65`). `prune(now)` (`:98-129`) is O(n) but called PERIODICALLY (before a check), not per-insert; the hard-cap eviction walk is bounded by `excess` with an early `break` (`:120`) and relies on Map insertion-order = oldest-first. Cost bounded by `maxKeys` ≤ 5000 — trivial for a periodic sweep. No unbounded growth, no per-request O(n). Confidence HIGH.

### 7. Front-end responsiveness (`components/home-client.tsx`)
- `useMemo` guards on reorder inputs: `scrollKey` `:125`, `estimatedCardWidth` `:196`, `topicsMap` `:211`, `displayTags` `:216`, `initialLoadMoreCursor` `:226`. `useCallback` on `handleLoadMore` `:121` and `saveScrollPosition` `:127`. Resize work is `requestAnimationFrame`-debounced (`:49`); scroll restore double-rAF'd (`:154-155`). No re-render storm, no layout thrash on resize. `use-display-capability.ts` byte-identical to baseline (the React #185 snapshot-memoization fix is intact). Confidence HIGH.

---

## What I verified did NOT regress (summary)
- No N+1 in any listing or detail query; tags aggregate via one GROUP_CONCAT JOIN.
- No query lacks a covering composite index except the bounded, low-frequency Atom feed (intentional, pre-existing, acceptable).
- No O(n²) on any hot path; SW LRU and bounded-map eviction are O(k)/O(1)-amortized by design.
- No unbounded in-memory growth (view-count buffer, retry map, all rate-limit maps capped).
- No buffer-decode duplication beyond the intentional WI-14 per-format isolation.
- No timer-handle leak (COR-R4C11-01 fix present; timers `.unref()`'d).
- No blocking work on a request path; Sharp encode is queued (PQueue) and advisory-locked.
- No floating-promise throughput hazard in the bulk paths re-examined.

## Hard guards respected
1. Did NOT propose `import 'server-only'` on `@/db` (cycle-5 proved it breaks tsx backfill).
2. Did NOT propose activating CLIP/semantic search.
3. Did NOT re-report any cycle 1–5 closed item.

No code change is warranted this cycle from a performance/concurrency standpoint.
