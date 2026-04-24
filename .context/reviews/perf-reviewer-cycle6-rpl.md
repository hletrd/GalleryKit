# Performance Reviewer — Cycle 6 RPL

Date: 2026-04-23. Reviewer role: perf-reviewer (CPU, memory, concurrency,
I/O, UI responsiveness).

## Scope

Whole-repo scan focused on hot paths: data access (`data.ts`), image
processing pipeline (`process-image.ts`, `image-queue.ts`), server actions
entry points, and server-rendered homepage/topic/photo routes.

## Confirmed good postures (regression check)

- Composite DB indexes on `(processed, capture_date, created_at)`,
  `(processed, created_at)`, `(topic, processed, capture_date, created_at)`,
  and `image_tags(tag_id)` match query patterns in `getImages*`,
  `getImage()`, and `bootstrapImageProcessingQueue`.
- Connection pool capped at 10, queue limit 20, keepalive enabled.
- `Promise.all` parallelizes `getImage()` (main + tags + prev + next).
- React `cache()` wraps `getImage`, `getTopicBySlug`, `getTopics`,
  `getTopicsWithAliases`, `getImageByShareKey`, `getSharedGroup`,
  `getSeoSettings`, and getters are request-deduped.
- Sharp pipeline: single-instance-with-clone pattern across AVIF/WebP/JPEG
  variants; sizes cascade from largest-rendered-at-this-resolution; `clone()`
  avoids triple buffer decode.
- Blur placeholder at 16px; EXIF parsing bounds-checked (`tagCount` capped
  at 100; strings capped at 1024).
- Homepage / topic pages use ISR (1h); photo pages 1w.
- `PQueue` concurrency for image processing (default 2, tunable via env).
- `p-queue` claim via DB-level `GET_LOCK` + `processed=false` conditional
  UPDATE.
- `exportImagesCsv` drops its DB result array before materializing the CSV
  string (`db-actions.ts:96-100`).

## New findings

### P6-01 — `flushGroupViewCounts` chunks to 20 concurrent promises but per-chunk promises wait for the slowest
- File: `apps/web/src/lib/data.ts:57-80`.
- Severity: LOW. Confidence: HIGH.
- Current code iterates chunks of 20 with `await Promise.all(...)`. Each
  chunk blocks on its slowest UPDATE. If one chunk contains a slow
  long-running UPDATE (unusual, but possible during contention), subsequent
  chunks wait. Pool has 10 connections, so 20 concurrent UPDATEs
  immediately queue 10 of them — parallelism is already capped by pool
  size.
- Fix: set `FLUSH_CHUNK_SIZE = 10` to match the pool. Current value of 20
  means 10 UPDATEs are pool-queued while the chunk awaits all 20. Minor.
  Alternative: use a `p-limit(10)` semaphore for tighter coupling. Benchmark
  before changing; current behavior is not broken.

### P6-02 — `bootstrapImageProcessingQueue` unpaginated SELECT
- File: `apps/web/src/lib/image-queue.ts:298-316`.
- Severity: LOW. Confidence: HIGH.
- Still carry-forward from prior cycles. `SELECT ... FROM images WHERE
  processed = false` without limit could return thousands of rows on a
  stalled queue. Deferred (AGG5R-carry-forward).

### P6-03 — `processImageFormats` renders per-format in parallel, but each format sequentially renders the size ladder
- File: `apps/web/src/lib/process-image.ts:381-437`.
- Severity: LOW. Confidence: HIGH.
- `generateForFormat` iterates `sortedSizes` sequentially with `await`. For
  4 sizes × 3 formats = 12 renders, only 3 run in parallel at any time
  (one per format). Sharp threadpool could accommodate more on multi-core
  machines when image is not large.
- Fix: run sizes-within-format in parallel too, rate-limited by
  `sharp.concurrency()` (currently `cpus - 1`). Would reduce per-upload
  latency for 4K images. Needs benchmarking; memory tradeoff. Deferred —
  current perf is acceptable.

### P6-04 — `searchImages` fans out sequentially: main → tag → alias, each awaited
- File: `apps/web/src/lib/data.ts:725-832`.
- Severity: LOW. Confidence: HIGH.
- Short-circuits when earlier stages fill the limit (good). But when they
  don't, the three queries run sequentially. On a popular search term that
  matches mostly by tag, the user waits for `main` to return before tag
  query starts. Could run all three in parallel with `Promise.all` and
  dedupe post-hoc — tradeoff is wasted DB work when main fills the limit.
- Fix: keep sequential (current perf is fine). Observational. Covered in
  prior-cycle deferred list.

### P6-05 — `deleteImages` large-batch revalidates global layout via `revalidateAllAppData` — acceptable, but `revalidateLocalizedPaths('/admin/dashboard')` is redundant
- File: `apps/web/src/app/actions/images.ts:540-552`.
- Severity: LOW. Confidence: MEDIUM.
- `revalidateAllAppData` already revalidates everything under the app
  including `/admin/dashboard`. Calling `revalidateLocalizedPaths(
  '/admin/dashboard')` afterward adds a redundant call. Next.js dedups
  revalidation tokens but the extra function invocation is wasteful.
- Fix: drop the second call when using the large-batch branch. Tiny.

### P6-06 — `getTopicsWithAliases` builds alias Map even when no aliases exist
- File: `apps/web/src/lib/data.ts:206-227`.
- Severity: LOW. Confidence: LOW.
- If `allAliases` is empty, `aliasMap` is an empty Map. The `.map(topic =>
  ({...topic, aliases: aliasMap.get(topic.slug) ?? []}))` still runs for
  every topic. Gallery has ~10 topics in typical installations — cost is
  negligible. Observational.

### P6-07 — `getImage` prev/next uses OR with 3 disjuncts; composite index matches, but the `sql\`FALSE\`` branch for null-capture-date "next" creates an always-false subtree that wastes planner work
- File: `apps/web/src/lib/data.ts:508-535`.
- Severity: LOW. Confidence: MEDIUM.
- The "next" query for a NULL `capture_date` intentionally sets the
  primary predicate to `sql\`FALSE\`` (comment explains: NULLs sort last in
  DESC, no "older" images). That OR branch is always false, so the planner
  evaluates the remaining two branches. Optimizer should short-circuit FALSE
  at planning time, but on MySQL 8.0 the OR may still require branch
  evaluation. Benchmark-gated.
- Fix: skip the first OR branch entirely when `image.capture_date` is null.
  Trivial TypeScript conditional. Cosmetic; not a measurable perf win.

### P6-08 — `escapeCsvField` runs 3 regex passes per field
- File: `apps/web/src/app/[locale]/admin/db-actions.ts:27-41`.
- Severity: LOW. Confidence: MEDIUM.
- Each CSV field runs `replace(/[\x00-\x09...]/g)`, then `replace(/[\r\n]/g)`,
  then a `match(...)` then another `replace(/"/g)`. For 50K rows × 8 fields
  = 400K function invocations. At ~10μs per combined regex call, that's
  ~4s of regex CPU for a 50K-row export.
- Fix: combine the two stripping passes into one `replace(/[\x00-\x1F\x7F-\x9F]/g, '')` + a separate `.replace(/[\r\n]+/g, ' ')` for collapse. Or
  precompile the formula-prefix-check with `RegExp#test` instead of
  `.match()` which allocates a match array. Benchmark-gated; 4s for 50K
  rows is acceptable.

### P6-09 — `uploadImages` per-file saveOriginal is sequential
- File: `apps/web/src/app/actions/images.ts:182-305`.
- Severity: LOW. Confidence: HIGH.
- The outer `for (const file of files)` loop awaits each `saveOriginalAndGetMetadata` before moving to the next. On a batch upload of 100 files,
  this serializes disk I/O. The processing queue handles conversion in
  parallel (2x concurrency), but the initial save is sequential.
- Fix: `Promise.all` with a `p-limit` semaphore (e.g. 4 concurrent saves).
  Would reduce upload wall-clock time by ~4x for large batches. Small
  refactor with memory tradeoff (4x 200MB worst-case).
- Observational. Current behavior is acceptable; perf improvement not
  urgent.

### P6-10 — `normalizePaginatedRows` loops twice: `rows.slice` + `visibleRows.map`
- File: `apps/web/src/lib/data.ts:337-357`.
- Severity: LOW. Confidence: LOW.
- For N rows, `slice` allocates a new array then `map` iterates and strips
  `total_count`. Could be combined into a single loop. Cost is trivial
  (max 101 rows per page). Observational.

## Summary

- **0 HIGH / MEDIUM** perf findings.
- **10 LOW** findings, all micro-optimizations or observational. The
  most actionable are **P6-05** (redundant revalidate call) and **P6-01**
  (chunk size mismatch with pool). None affect user-perceived latency in
  typical workloads.
- Overall perf posture is strong. Prior benchmarks showed homepage SSR
  under 50ms for a 500-image gallery.
