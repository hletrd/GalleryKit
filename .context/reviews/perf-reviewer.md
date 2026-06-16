# Performance & Concurrency Review — GalleryKit

**HEAD:** `a7758ef0` (branch master) · **Agent:** perf-reviewer · **Date:** 2026-06-17
**Run/Cycle:** Run 6 / Cycle 7 (review-plan-fix loop)
**Prior perf baselines:** 4eb83aab (cycle-6 perf), 2f603716 (cycle-5), f8147868 (cycle-4)
**Scope:** CPU/memory/I/O hotspots; DB query shapes vs composite indexes; N+1; connection-pool & async-queue concurrency; Sharp pipeline throughput + buffer duplication; UI responsiveness (re-render storms / layout thrash / INP / CLS / LCP); `useSyncExternalStore` snapshot stability (React #185); worker/canvas cost; service-worker LRU eviction; advisory-lock hold time; bounded-Map growth & eviction cost; floating-promise throughput; timer-handle leaks; bulk-mutation server-action loops; sync-fs in request paths.

---

## Verdict

**Honest convergence — ZERO actionable performance/concurrency findings (0 CRIT / 0 HIGH / 0 MED / 0 LOW).**

This is the correct outcome. The loop has converged hard (findings 11 → 45 → 14 → 5 → 1 → 2 → **0** perf). I did NOT inherit the prior cycle-6 perf `0`; I re-derived every hot path from current-HEAD source and re-verified the delta mechanically. The conclusion holds: no shipping source line that affects a request hot path changed since the cycle-6 perf baseline, and every unchanged hot path is correct under independent re-examination.

| Severity | New this cycle | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 0 | — |

Confidence labels below reflect how certain the (absence-of-)impact assessment is.

---

## Mechanical delta verification (HEAD-verified, not trusted)

**Working tree:** clean over shipping source. `git status --short` shows only `.context/reviews/*.md` + new plan files dirty.

**Cycle-6 → HEAD (`4eb83aab..a7758ef0`):** exactly the two briefed commits plus the cycle-6 review/plan doc commit:
- `5af25dc7` — HDR badge contrast a11y fix (AGG-C6-01). **4 shipping files, 1 token each.**
- `204e8594` — test-only (client→server boundary classifier hardening, AGG-C6-02). Non-shipping.
- `a7758ef0` — review/plan docs + plan-file moves. Non-shipping.

**The entire cycle-6→HEAD SHIPPING delta is four single-token `className` swaps** (`text-white` → `text-amber-950`):

| File:line | Change | Perf verdict |
|---|---|---|
| `components/color-details-section.tsx:526` | `text-white`→`text-amber-950` on `.hdr-badge` span | **Neutral** (HIGH). Static class-string literal swap. No change to render shape, component tree, conditional logic, effects, state, handlers, or DOM. |
| `components/lightbox-color-pip.tsx:151` | same | **Neutral** (HIGH). Same. |
| `components/info-bottom-sheet.tsx:278` | same | **Neutral** (HIGH). Same. |
| `components/image-manager.tsx:526` | same | **Neutral** (HIGH). Same. |

A `className` string-literal change carries zero runtime/render cost — Tailwind class membership is resolved at build time; the rendered span count, props, and reconciliation are identical. This is purely a WCAG 1.4.3 contrast fix. No perf surface touched.

**Hot-path files confirmed byte-identical to the cycle-6 baseline** (`git diff --stat 4eb83aab..HEAD -- <file>` empty for each): `lib/process-image.ts`, `lib/color-detection.ts`, `lib/data.ts`, `lib/image-queue.ts`, `lib/serve-upload.ts`, `lib/sw-cache.ts`, `lib/bounded-map.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/admin-backfill-runner.ts`, `lib/use-display-capability.ts`, `components/home-client.tsx`, `components/photo-viewer.tsx`, `components/histogram.tsx`, `db/schema.ts`, `public/sw.js`, `scripts/backfill-color-pipeline.ts`. **No public/admin API route changed** (`src/app/api/**` diff empty).

---

## Independent HEAD re-derivation (read fresh at a7758ef0 — not inherited)

The empty diff only proves "no NEW regression." To catch a latent pre-existing regression, I re-examined each hot path from current source.

### 1. Data access (`lib/data.ts`) — SQL shapes, N+1, GROUP_CONCAT
- All masonry/listing queries (`getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`, full `getImages`, `getImagesForFeed`) reference the **single shared `tagNamesAgg`** constant (`:605` = `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)`) at the six `tag_names: tagNamesAgg` sites (`:734,:783,:833,:899,:923,:1359`) over one `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. **No N+1** — tags aggregate in the same round-trip. The legacy scalar-subquery NULL bug (commit aca754c) is gone, locked by `data-tag-names-sql.test.ts`.
- The full-tag-object path (`getImagesWithTags`, `:1137`) uses a separate combined `GROUP_CONCAT(DISTINCT CONCAT(slug, CHAR(0), name) … SEPARATOR CHAR(1))` (C16-MED-02) — still ONE round-trip, parsed client-side. No N+1.
- View-count buffer bounded: `MAX_VIEW_COUNT_BUFFER_SIZE=1000` drop-on-cap (`:47-51`), `MAX_VIEW_COUNT_RETRY_SIZE=500` + `VIEW_COUNT_MAX_RETRIES=3` (`:22-27`), flush chunked at `FLUSH_CHUNK_SIZE=20` with `Promise.all` per chunk (`:103-104` — bounded concurrent DB promises, not fan-all), atomic Map swap on flush, exponential backoff `getNextFlushInterval()` (`:37`), timer `.unref()`'d, hard re-cap drain `while (size > MAX) shift` (`:143`). No unbounded growth, no timer leak.

### 2. Index coverage vs query shapes (`db/schema.ts` — unchanged at HEAD)
- Listing sort `(capture_date, created_at, id)` + `processed` → `idx_images_processed_capture_date`. Covered.
- prev/next nav → `idx_images_processed_created_at`. Covered.
- Topic-filtered → `idx_images_topic (topic, processed, capture_date, created_at)`. Covered.
- Tag JOIN → `idx_image_tags_tag_id` + unique `image_tags_image_id_tag_id`. Covered.
- Upload-attribution → `idx_images_uploaded_by`; analytics breakdowns → `idx_image_views_bot_viewed_country/_referrer`. Covered.
- **`getImagesForFeed` sorts by `(updated_at DESC, created_at DESC, id DESC)` with no `(processed, updated_at)` index → MySQL filesort.** AWARENESS-ONLY, NOT A FINDING: pre-existing (not a delta), bounded by `safeLimit`, low-frequency cacheable Atom feed, sub-ms over a few-thousand-row personal gallery. An index would add write cost on every upload/edit for no observable gain. Confidence HIGH.

### 3. Sharp pipeline (`lib/process-image.ts`)
- 3-format fan-out in parallel via `Promise.all` (`:1265`, results `:1272`). Per-format **fresh `sharp(inputPath, …)` instances** (`:1123,:1126`) — the WI-14 cross-format-contamination fix; one extra decode traded for correctness (documented contract).
- Single decode reused via `.clone()` for the 16px blur (`:872`) and the base-format derivative loop (`:1176`).
- `limitInputPixels` (bomb cap) + `sequentialRead:true` (peak-memory cap) + `failOn:'error'` + `autoOrient` set per constructor (`:835,:1019,:1123,:1126,:1608`).
- `pipelineColorspace('rgb16')` ONLY on the wide-gamut branch (`:1124`); DCI-P3 skips rgb16 to keep source ICC for the Bradford transform — no wasted 16-bit pipeline on sRGB.
- `WIDE_GAMUT_MAX_SOURCE_PIXELS` (default 50 M, `:1004`) downscales huge wide-gamut sources before fan-out (`:1022-1035`) — OOM guard. Failure path (`:1306`) cleanup parallelized. Confidence HIGH.

### 4. Image queue concurrency (`lib/image-queue.ts`)
- `PQueue({ concurrency: QUEUE_CONCURRENCY || 1 })` (`:168`) — single-writer default, matching the single-instance Docker topology.
- Per-job MySQL advisory lock via non-blocking `GET_LOCK(?, 0)` (`:199`), released on `RELEASE_LOCK` (`:218`), paired with `WHERE processed = false` conditional UPDATE (`:287,:372`) + `affectedRows === 0` cleanup (`:374`). Two workers across a restart boundary cannot double-encode; the loser detects already-processed and cleans up its leftover variants. Lock not held across unrelated work beyond the intended single-writer model. Confidence HIGH.

### 5. Service-worker LRU (`lib/sw-cache.ts`)
- `MAX_IMAGE_CACHE_BYTES = 50 MB` (`:19`). Upsert is **delete-then-set** (`:111-112`, AGG-H3) so Map insertion order tracks recency. Eviction (`:120-148`) is an **O(k) head-walk** from the front until under cap — explicitly NOT `Array.from().sort()` O(n log n) (design comment `:104-110`). Drift-tolerant accounting handles `cache.delete()` returning false (`:139-143`). Correct stale-while-revalidate LRU. Confidence HIGH.

### 6. Rate-limit / bounded maps (`lib/bounded-map.ts`, `rate-limit.ts`, `auth-rate-limit.ts`)
- Every limiter is a `BoundedMap` with a hard cap (login 5000, search/OG/checkout/share/semantic 2000, password-change 5000).
- `set()` is O(1) (`bounded-map.ts:65`). `prune(now)` (`:98-128`) is O(n) but called PERIODICALLY before checks, not per-insert; collect-then-delete two-pass (C7-MED-01); hard-cap eviction walk bounded by `excess` with early `break` (`:120`), relying on Map insertion-order = oldest-first. Cost bounded by `maxKeys` ≤ 5000 — trivial periodic sweep. No per-request O(n), no unbounded growth. Confidence HIGH.

### 7. Front-end responsiveness (`components/home-client.tsx`, `histogram.tsx`, `use-display-capability.ts`)
- `home-client`: reorder inputs `useMemo`'d (`scrollKey :125`, `estimatedCardWidth :196`, `topicsMap :211`, `displayTags :216`, `initialLoadMoreCursor :226`); `useCallback` on `handleLoadMore :121` / `saveScrollPosition :127`; resize work `requestAnimationFrame`-debounced with `cancelAnimationFrame` cleanup (`:48-58`); scroll listener `{ passive: true }` removed on unmount (`:183-184`); scroll restore double-rAF'd (`:154-155`). No re-render storm, no layout thrash.
- `histogram`: O(n) histogram compute offloaded to a Web Worker via `postMessage` with a **transferable** `imageData` buffer (`:165`); main thread only extracts pixels into a **256-px-capped** canvas (`maxDim=256`, `:180`). No main-thread blocking.
- `use-display-capability`: `getSnapshot` returns the memoized `_cachedSnapshot` stable reference when `colorGamut`/`isHdr` are unchanged (`:74-81`) — the React #185 `useSyncExternalStore` infinite-loop fix is intact.

### 8. serve-upload request path (`lib/serve-upload.ts`)
- Async I/O only: `createReadStream` + `fs/promises` `lstat`/`realpath` (`:3-4`). ETag built from `(IMAGE_PIPELINE_VERSION, mtimeMs, size, settingsHash)` (`:215`) — the documented design that avoids 30-50 DB round-trips per masonry paint (`:27`); `getServingColorSettingsHash()` is an in-memory cached helper. 304 short-circuit on If-None-Match (`:219-229`). fd cannot accumulate (single stream per request, `:124`). No sync fs, no per-request heavy work.

### 9. Bulk-mutation server-action loops (admin-only, swept fresh)
A repo-wide `await`-inside-`for` scan over `src/app/actions` + `src/lib` + `src/app/api` flagged the expected admin-mutation sites. Each verified bounded, correct, and OFF the request hot path:
- `tags.ts:397/431` — iterate admin `addTagNames`/`removeTagNames` (handful of tags) in one txn; per-tag `ensureTagRecord`/`INSERT IGNORE` is intrinsic to slug-collision semantics.
- `seo.ts:139` / `settings.ts:138` — iterate `Object.entries(sanitizedSettings)`, a fixed small key set; upsert-or-delete in one txn.
- `images.ts:268` (`uploadImages`) — iterate `files`, hard-capped at `UPLOAD_MAX_FILES_PER_WINDOW=100`; per-file original-save is intrinsic I/O, heavy Sharp work is enqueued not inline.
- `images.ts:1017/1032/1048` (bulk-update) — alt-text apply is a per-row UPDATE (each caption differs, so a single statement is impossible without CASE; admin-batch bounded). The tag add/remove paths correctly **batch** via `inArray(imageTags.imageId, ids)` and a single `INSERT IGNORE … ids.map(...)` — exactly right.
- `embeddings.ts:110` — US-P51 CLIP stub, deferred surface, not active.

### 10. Sync-fs sweep (request/render paths)
Repo-wide grep for `readFileSync`/`writeFileSync`/`existsSync`/`statSync`/`readdirSync`/`lstatSync`/`execSync` over `src/app` + `src/lib` (excluding tests): **zero hits.** No synchronous fs blocking any request/render path.

---

## What I verified did NOT regress (summary)
- No N+1 in any listing/detail/feed query; tags aggregate via one GROUP_CONCAT JOIN (two shapes, both single round-trip).
- No query lacks a covering composite index except the bounded, low-frequency Atom feed (intentional, pre-existing, acceptable).
- No O(n²) on any hot path; SW LRU and bounded-map eviction are O(k)/O(1)-amortized by design.
- No unbounded in-memory growth (view-count buffer, retry map, all rate-limit maps capped).
- No buffer-decode duplication beyond the intentional WI-14 per-format isolation.
- No timer-handle leak (timers `.unref()`'d; null-on-entry handling intact).
- No blocking work on a request path; Sharp encode is queued (PQueue) and advisory-locked; serve-upload is fully async.
- No floating-promise throughput hazard in the bulk paths re-examined.
- The delta (4 HDR-badge `className` swaps) carries zero render/perf cost.

## Hard guards respected
1. Did NOT propose `import 'server-only'` on `@/db` (proven to break tsx backfill).
2. Did NOT propose activating CLIP/semantic search.
3. Did NOT re-report any cycle 1–6 closed item; the `getImagesForFeed` filesort remains awareness-only.

No code change is warranted this cycle from a performance/concurrency standpoint.
