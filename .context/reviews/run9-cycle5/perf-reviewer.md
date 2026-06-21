# PERF-REVIEWER — Run-9 Cycle-5 (HEAD `e34c04cf`)

**Date:** 2026-06-21
**Mode:** READ-ONLY performance/scalability review. High bar: report ONLY a
genuine, measurable, on-the-hot-path performance DEFECT. Do NOT manufacture
micro-optimizations; do NOT re-file carried deferrals without new evidence.

## Verdict: ZERO new performance defects — convergence holds.

No N+1 query, missing index for a frequent query shape, unbounded result set or
loop, blocking sync I/O on the request event loop, expensive per-request work
that should be cached, or unbounded Map/cache memory leak was found on any hot
path. Every candidate examined is either already optimized with documented
rationale, a bounded admin-only / background surface, or a previously-cleared
deferral with no new evidence meeting its exit criterion. I am not manufacturing
a finding.

---

## Source-delta scope (independently verified this cycle)

- `git diff --stat f63af3b9..HEAD -- apps/web/src/lib apps/web/src/app` (production
  logic since run-8 convergence) = **EMPTY**. Re-ran the exact command; confirmed.
- The only production-code touches in the last ~15 commits are
  `components/similar-photos.tsx` (a11y: accessible name on thumbnail links,
  DES-R9C4-01) and `components/bulk-edit-dialog.tsx` (a11y aria-labels) — neither
  alters a query, loop, allocation, or render-loop shape. `similar-photos.tsx`
  lazy-fetches `/api/search/similar/{id}` only on panel-open (gated by
  `fetchedRef.current`), so it is NOT a per-page-load path.
- Conclusion: NO change has landed on any data-access, query, index,
  Sharp-pipeline, serving, connection-pool, queue, analytics, or render surface
  since these paths were last cleared. This review is therefore a fresh skeptical
  re-derivation from source (not a delta scan), and it re-confirms the prior
  CONFIRMED-clean verdict at a new HEAD.

---

## Hot paths examined (source-validated this cycle)

### 1. Data-access layer (`apps/web/src/lib/data.ts`, 1660 LOC) — CLEAN
- **Masonry-listing family** (`getImagesLite` / `getImagesLitePage` /
  `getImages` / `getAdminImagesLite`): all share `tagNamesAgg` =
  `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over ONE
  `LEFT JOIN imageTags … LEFT JOIN tags … GROUP BY images.id` (`:603`, `:732`,
  `:781`, `:831`, `:897`, `:921`). One query returns page + per-row tag names —
  the explicit anti-N+1 shape. Bounded by `LISTING_QUERY_LIMIT(_PLUS_ONE)`=100/101
  (`:609-611`, `:747`, `:770`, `:909`, `:933`). `getImagesLitePage` folds the
  total via `COUNT(*) OVER()` (`:832`, `:1358`) — no separate count query.
- **`getImage(id)`** (`:954-1105`): PK+processed SELECT (`.limit(1)`), then a
  single `Promise.all([tags, prev, next])` — 4 queries total, fixed regardless of
  result size. Prev/next are disjunctive-keyset (seek) lookups, each
  `.orderBy(...).limit(1)` (`:1056-1090`) on the `(processed, capture_date,
  created_at)` sort order. No N+1, no offset scan.
- **`getSharedGroup`** (`:1181-1234`): group SELECT → bounded images SELECT
  (`.limit(100)` `:1221`) → ONE batched `inArray(imageIds)` tag fetch
  (`:1234`) grouped in JS. 3 queries, fixed.
- **`getImageByShareKey`** (`:1115-1148`): single query, image+tags collapsed via
  `GROUP_CONCAT(... CHAR(0) ... SEPARATOR CHAR(1))` + `.limit(1)`.
- **`getLatestImageForOg`** (`:871-883`): minimal `id,title` `.limit(1)` with NO
  tag JOIN / GROUP_CONCAT / GROUP BY (the AGG-R8c3-05 home-OG trim).
- **`getSeoSettings`** (`:1636-1658`) and **`getGalleryConfig`**
  (`gallery-config.ts:210`): each one `inArray(... SETTING_KEYS)` query, React
  `cache()`-wrapped for SSR dedup. Single DB hit per request.
- React `cache()` wraps the 10 `*Cached` read fns + `getSeoSettings`; public
  pages call the SAME cached accessor in both `generateMetadata` and the page
  body, so request-scoped dedup collapses them to one DB hit each.
- **`viewCountBuffer`** (`:17`, `:96`): module-level shared-group view buffer,
  HARD-CAPPED at `MAX_VIEW_COUNT_BUFFER_SIZE`=1000 with overflow-drop guards on
  BOTH the increment path (`:47`) and the retry re-add path (`:125`, `:143`),
  flushed on an exponential-backoff timer. Bounded by design — not a leak.

### 2. DB indexes vs query patterns (`apps/web/src/db/schema.ts`) — CLEAN
- Listing sort `(capture_date DESC, created_at DESC, id DESC)` filtered on
  `processed` covered by `idx_images_processed_capture_date`. prev/next covered by
  the same. Topic-filtered listing covered by `idx_images_topic (topic, processed,
  capture_date, created_at)`. Upload dedup by `idx_images_user_filename`.
  Atom-feed author by `idx_images_uploaded_by`.
- `image_views` has the `(imageId, viewed_at)` index + two `(bot, viewed_at,
  country/referrer)` composites; the analytics aggregations run as covering
  range scans on these for the windowed case (the dominant case).
- `image_embeddings` semantic/similar scan
  (`WHERE model_version=? ORDER BY updated_at DESC LIMIT 5000`) is covered by
  `idx_image_embeddings_model_version_updated` (migration 0022, AGG-C8-03).
- `shared_group_images` covered by `(group_id, position)` for the ordered group
  read. No query shape lacks a supporting index.

### 3. Semantic / similar search (`api/search/similar/[id]/route.ts`,
   `api/search/semantic/route.ts`, `lib/clip-embeddings.ts`) — CLEAN (bounded)
- The one truly public path that does real per-request CPU. Gated in order:
  same-origin -> restore-maintenance -> id validation -> rate-limit pre-increment
  -> **production-only mode gate (503 in disabled/stub)** -> target-embedding
  lookup -> bounded scan. The DB scan is `.limit(SEMANTIC_SCAN_LIMIT=5000)` and
  index-covered. The in-JS cosine pass uses the `dotProduct` unit-vector fast
  path (skips per-row norm + sqrt). At the production reality of ~445 embeddings
  this is sub-millisecond; even at the 5000 cap it is ~2.5M float MACs — a few ms
  of synchronous CPU, rate-limited (shared `preIncrementSemanticAttempt` budget),
  production-only. Bounded and acceptable; NOT a defect.

### 4. Sharp pipeline (`apps/web/src/lib/process-image.ts`, 1650 LOC) — CLEAN
- Fan-out: 3 formats in `Promise.all`, sizes sequential WITHIN each format; the
  whole pipeline serialized by `QUEUE_CONCURRENCY=1` default, so only ONE image
  encodes at a time. Per-format FRESH `sharp(inputPath, …)` per output (WI-14
  cross-format isolation). 50 MP wide-gamut sources pre-downscaled to
  `WIDE_GAMUT_MAX_SOURCE_PIXELS` (OOM bound). `canUseHighBitdepthAvif()` is a
  memoized Promise singleton — not a per-size re-probe. Per-job dedup Sets
  (`:1068-1070`) are scoped to one encode and GC'd.

### 5. Image queue / bootstrap / GC (`apps/web/src/lib/image-queue.ts`) — CLEAN
- Bootstrap is cursor-paginated (`gt(id, bootstrapCursorId)` + `LIMIT
  BOOTSTRAP_BATCH_SIZE=500`, `:624`/`:652`), continuation gated on `onIdle()`.
- Hourly GC timer armed ONCE (`!state.gcInterval` guard); fires `purgeOldBuckets`
  / `purgeOldAuditLog` / `purgeOldViewEvents` as fire-and-forget (`:696-702`).
- Retry maps bounded + collect-then-delete pruned (`:99-107`).
- The 1000-literal `notInArray` (`:627`) is the already-DEFERRED R7C1-CR-02
  (capped, startup-only, MySQL-fine) — NOT re-filed per instructions; no new
  measured evidence.

### 6. Serving / ETag (`apps/web/src/lib/serve-upload.ts`) — CLEAN
- Settings-hash on the serve path behind a module-scoped 5 s TTL +
  stale-while-revalidate + single-inflight dedup (`getServingColorSettingsHash`,
  `:50-83`) — a masonry-paint flood does NOT issue one `admin_settings` SELECT per
  file. HEAD short-circuits before opening an fd (`:257`); 304 short-circuits
  before streaming (`:223-235`); fd released on client abort (`:269-290`). This
  is the route-handler FALLBACK path; the static path (Next's static server)
  carries the majority of real derivative traffic with its own mtime+size ETag.

### 7. Analytics (`apps/web/src/lib/analytics-data.ts`, admin page) — CLEAN
- The admin /analytics page runs its 5 aggregations in `Promise.all`
  (`analytics/page.tsx:20-29`). Each query is `.limit()`-bounded, time-windowed
  (range scan on a composite index for the dominant windowed case), excludes
  bots, and is retention-bounded (395 d via `purgeOldViewEvents`). Admin-only,
  off the public traffic path.

### 8. No blocking sync I/O on request paths — CLEAN
- Grep for `readFileSync|existsSync|statSync|writeFileSync|execSync` across
  `src/lib` + `src/app` (excluding `__tests__`) returned ZERO hits.
- `site-config.json` is a static ES-module `import` (bundled at build time) — no
  per-request fs read.

### 9. Render hot path (`apps/web/src/components/home-client.tsx`) — CLEAN
- CSS-only masonry (`columns-N` + `break-inside-avoid`) — no JS reorder pass.
  `orderedImages = allImages` (no per-render sort/copy). Per-tile loop does O(1)
  work (pure title/alt helpers, guarded aspect-ratio math); no nested `.find()`
  per card. `topicsMap` is `useMemo`-built into an O(1) `Record` lookup.
  `displayTags`' `tags.find()` runs over the ~1-3 active filter tags (memoized,
  once per filter change), not per masonry card. Resize handler is
  rAF-debounced; scroll listener is `{ passive: true }`.

### 10. Rate-limit memory (`apps/web/src/lib/rate-limit.ts`) — CLEAN
- Every in-memory bucket (login/search/og/share/semantic) uses a bounded factory
  (`createResetAtBoundedMap` / `createWindowBoundedMap`) with a `MAX_KEYS` cap and
  oldest-entry eviction. By-design bounded Maps — explicitly NOT leaks per the
  cycle directive.

---

## Carried deferrals — re-confirmed, NOT re-filed (no new evidence)

- **Bootstrap 1000-literal `notInArray`** (`image-queue.ts:627`): DEFERRED
  R7C1-CR-02. Startup-only, capped. No measured >1s latency. Not re-filed.
- **Timeline `YEAR()/MONTH()` non-sargable** (`data-timeline.ts:108/188`):
  DEFERRED R7C1-CR-04. `idx_images_processed_capture_date` still narrows the
  scan; cap-500 + limit+1 bounded. No new evidence. Not re-filed.
- **Analytics GROUP-BY-imageId not skip-scannable** (`analytics-data.ts:44`,
  PERF-R5C2-01): admin-only, retention-bounded, deferred pending EXPLAIN
  evidence. Re-confirmed; not re-filed.
- **Upload tag re-resolution per file** (`actions/images.ts`): POLISH on an
  admin-only WRITE path dominated by Sharp encode cost; <=100 files x indexed
  unique-key hits. Not a hot-path defect; not filed.

---

## Disposition

- **NEW perf defects:** 0.
- **Convergence:** holds on the performance/scalability axis. The data-access
  layer, indexes vs actual query shapes, semantic-scan bound, Sharp pipeline,
  image queue/GC, serve-upload/ETag path, analytics, render hot path, sync-I/O
  surface, and all in-memory Maps are source-validated optimized at HEAD
  `e34c04cf`, and zero performance-relevant production code has changed since the
  last cleared convergence point (`f63af3b9`).
