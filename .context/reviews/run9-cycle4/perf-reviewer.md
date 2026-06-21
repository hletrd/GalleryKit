# PERF-REVIEWER — Run-9 Cycle-4 (HEAD `094842a4`)

**Date:** 2026-06-21
**Mode:** READ-ONLY performance review. High bar: report ONLY a genuine, measurable, on-the-hot-path performance DEFECT.

## Verdict: ZERO new performance defects — convergence holds.

No N+1 query, missing index for a frequent query, unbounded result set, blocking
CPU/IO on the request event loop, or cache()-dedup miss was found on any hot path.
Every candidate examined is either already optimized with documented rationale or
is a bounded admin-only / off-traffic surface. I am not manufacturing a finding.

---

## Source-delta scope (why convergence is plausible without re-deriving every path)

- `git diff --stat c2d3857a..HEAD -- apps/web/src apps/web/scripts apps/web/drizzle` =
  **two files only**: `__tests__/upload-tracker-state.test.ts` (test) and
  `components/bulk-edit-dialog.tsx` (added `aria-label`s — a11y, no logic/query).
- `git diff --stat f63af3b9..HEAD -- apps/web/src/lib apps/web/src/app` (production
  logic since run-8 convergence) = **EMPTY**.
- Conclusion: NO change has landed on any data-access, query, index, Sharp-pipeline,
  serving, or connection-pool surface since these paths were last cleared. The
  perf review is therefore a fresh skeptical re-derivation, not a delta scan, and it
  re-confirms the prior CONFIRMED-clean verdict.

---

## Hot paths examined (source-validated this cycle)

### 1. Data-access layer (`apps/web/src/lib/data.ts`) — CLEAN
- **`getImage(id)`** (`:954-1105`): one PK+processed SELECT, then a single
  `Promise.all([tags, prev, next])` — 4 queries total, fixed regardless of result
  size. Prev/next are `LIMIT 1` keyset lookups on the `(processed, capture_date,
  created_at)` sort order. No N+1.
- **`getImagesLite` / `getImagesLitePage` / `getImages` / `getAdminImagesLite`**
  (`:726-935`): shared `tagNamesAgg` = `GROUP_CONCAT(DISTINCT tags.name …)` over one
  `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id`. ONE query returns the
  page + per-row tag names — the explicit anti-N+1 shape. Bounded by
  `LISTING_QUERY_LIMIT(_PLUS_ONE)` = 100/101. `getImagesLitePage` folds the total via
  `COUNT(*) OVER()` (no second count query).
- **`getSharedGroup`** (`:1181-1272`): group SELECT → bounded (`LIMIT 100`) images
  SELECT → ONE batched `inArray(imageIds)` tag fetch grouped in JS (`:1223-1246`,
  explicitly "avoids N+1"). 3 queries, fixed.
- **`getImageByShareKey`** (`:1115-1175`): single query, image+tags collapsed via
  `GROUP_CONCAT` with `CHAR(0)`/`CHAR(1)` delimiters (the C14-MED-01 collapse of the
  prior 2-query shape).
- **`getLatestImageForOg`** (`:871-885`): minimal `id,title` `LIMIT 1` with NO tag
  JOIN / GROUP_CONCAT / GROUP BY (the AGG-R8c3-05 PERF-1 trim of the home OG path).
- React `cache()` wraps the 10 read fns + `getSeoSettings`; verified the public
  pages call the SAME cached accessor in both `generateMetadata` and the page body
  (`p/[id]` → `getImageCached` ×2; `[topic]` → `getTopicBySlugCached` ×2;
  `getSeoSettings`/`getTagsCached`/`getTopicsCached` shared) so request-scoped dedup
  collapses them to one DB hit each. No redundant-query-that-cache-should-dedup miss.

### 2. DB indexes vs query patterns (`apps/web/src/db/schema.ts`) — CLEAN
- Listing sort `(capture_date DESC, created_at DESC, id DESC)` filtered on
  `processed` is covered by `idx_images_processed_capture_date (processed,
  capture_date, created_at)`. Topic-filtered listing covered by `idx_images_topic
  (topic, processed, capture_date, created_at)`. prev/next covered by the same.
- `image_views` has `(imageId, viewed_at)` + the two `(bot, viewed_at, country/referrer)`
  composites. The analytics GROUP-BY-imageId aggregation (`getTopPhotosByViews`) is
  NOT index-skip-scan-optimal, but it is admin-only, retention-bounded (395 d via
  `purgeOldViewEvents`), and the index-utilization tradeoff is already documented +
  DEFERRED (PERF-R5C2-01, plan-322 entry 3 — "do not reorder without EXPLAIN
  evidence"). Not a new finding.
- `map_visible`/GPS map query is `LIMIT MAP_MAX_MARKERS(10000)` bounded (AGG-H4).

### 3. Sharp pipeline (`apps/web/src/lib/process-image.ts`) — CLEAN
- Fan-out: 3 formats in `Promise.all`, sizes sequential WITHIN each format
  (`:1265-1269`, `generateForFormat`); whole pipeline serialized by
  `QUEUE_CONCURRENCY=1` default, so only ONE image encodes at a time.
- Memory: every encode opens a FRESH `sharp(processingInputPath, {…mmap/sequentialRead})`
  per size (file path, not heap buffer); `rgb16` only on the wide-gamut non-DCI-P3
  path (documented 2× peak-RAM cost, deliberately paid). 50 MP wide-gamut sources
  pre-downscaled to `WIDE_GAMUT_MAX_SOURCE_PIXELS` (`:1022-1042`) — OOM bound.
- `canUseHighBitdepthAvif()` (`:119`) is a memoized Promise singleton — the
  `await` inside the per-size AVIF loop (`:1152`) resolves instantly after the first
  2×2 probe; NOT a per-size re-probe.

### 4. Image queue / bootstrap (`apps/web/src/lib/image-queue.ts`) — CLEAN
- Bootstrap is cursor-paginated (`bootstrapCursorId` + `gt(id, cursor)`),
  `LIMIT BOOTSTRAP_BATCH_SIZE(500)` per pass, continuation gated on `queue.onIdle()`.
  The 1000-literal `NOT IN` (`:626-628`) is the already-DEFERRED R7C1-CR-02
  (capped, startup-only, MySQL-fine) — NOT re-filed per instructions.
- Hourly GC timer armed ONCE (`!state.gcInterval` guard, AGG-M12); retry maps
  bounded + collect-then-delete pruned.

### 5. Serving / ETag (`apps/web/src/lib/serve-upload.ts`) — CLEAN
- Settings-hash on the serve path is behind a module-scoped 5 s TTL +
  stale-while-revalidate + single-inflight dedup (`getServingColorSettingsHash`,
  PERF-R4C3-05 / R4C4-01) — a masonry-paint flood does NOT issue one
  `admin_settings` SELECT per file. HEAD short-circuits before opening an fd; 304
  short-circuits before streaming. fd released on client abort.

### 6. Public view-recording (`apps/web/src/app/actions/public.ts`) — CLEAN
- `recordPhotoView/Topic/SharedGroup` are `void`-fired (non-blocking),
  per-IP rate-limited (120/min, bounded Map), single fire-and-forget INSERT each.
- `loadMoreImages` / `searchImages` rate-limited; `searchImages` short-circuits the
  tag+alias queries when the main query fills the limit (`:1476`), else runs the
  remaining two in `Promise.all` (2 sequential rounds worst case, documented).

### 7. Connection pool (`apps/web/src/db/index.ts`) — CLEAN
- 10 connections, `queueLimit 20`, keepalive. Per-connection
  `SET group_concat_max_len` init promise is awaited via a Symbol on the wrapper.
  Backfill concurrency budget-capped at 2 so background re-encode can't starve the
  5-reserved live-traffic connections (resolveBackfillConcurrency).

---

## Confirmed-benign / out-of-scope (not findings, recorded for provenance)

- **Upload tag re-resolution per file** (`apps/web/src/app/actions/images.ts:403-419`):
  for an N-file upload sharing the same `tagNames`, `ensureTagRecord` is called per
  file rather than once for the batch. POLISH at most — admin-only WRITE path, ≤100
  files × handful of tags, each an indexed unique-key hit, dominated by Sharp encode
  cost. Not a measurable hot-path defect; not filed.
- **`settings.ts` / `seo.ts` per-key tx delete/insert** (`settings.ts:138`,
  `seo.ts:139`): bounded admin-settings set (~20 keys), admin-only, infrequent,
  inside one transaction. POLISH; not filed.
- **`batchUpdateImageTags` per-tag tx queries** (`tags.ts:397/431`): capped at 100,
  admin-only, indexed lookups inside a transaction. POLISH; not filed.
- **Analytics GROUP-BY-imageId not skip-scannable**: already documented + DEFERRED
  (PERF-R5C2-01). Re-confirmed; not re-filed.
- **Timeline `YEAR()/MONTH()` non-sargable** (`data-timeline.ts:184`): already
  DEFERRED (R7C1-CR-04), cap-500 + limit+1 bounded. Re-confirmed; not re-filed.
- **Bootstrap 1000-literal `NOT IN`** (`image-queue.ts:626`): already DEFERRED
  (R7C1-CR-02). Not re-filed per instructions.

---

## Disposition

- **NEW perf defects:** 0.
- **Convergence:** holds on the performance axis. The data-access layer, indexes,
  Sharp pipeline, image queue, serve-upload/ETag path, public actions, and
  connection pool are all source-validated optimized at HEAD `094842a4`, and zero
  performance-relevant code has changed since the last cleared convergence point.
