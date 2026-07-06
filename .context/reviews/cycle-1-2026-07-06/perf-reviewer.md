# Cycle 1 (2026-07-06) — Performance & Concurrency Review

Reviewer: perf-reviewer (performance, concurrency, CPU/memory, DB efficiency, caching).
HEAD reviewed: `657eb024` (== `origin/master`, clean tree; untracked review dirs only).
Mode: read-only. No source files modified.

Prior-context read first to avoid duplication: `.context/plans/cycle-96-2026-07-01-deferred.md`,
`.context/plans/cycle-98-2026-07-01-deferred.md`, `.context/reviews/cycle-99-2026-07-01/perf-reviewer.md`
(no confirmed findings at `d6912560`), `.context/reviews/cycle-99-2026-07-01/architect.md`
(load_more/view_record saturated-fast-path asymmetry — NOT re-filed here), and the four sibling
lanes in `.context/reviews/cycle-1-2026-07-06/` (critic, security-reviewer, test-engineer, verifier).

The two files with the most recent source changes (`rate-limit.ts`, `image-queue.ts`, both last
touched by cycle-97 commit `6f40f66d`) were read in full and their cycle-97 diffs re-derived from
git; the diffs themselves (feed limiter, age-gated `.tmp`/`.bak` cleanup) are sound.

---

## Findings

### PERF-01 — Unguarded overlapping `bootstrapMissingActiveEmbeddings` scans can duplicate CLIP work and starve the shared inference queue

- Severity: Medium (production semantic mode) / Low (stub mode).
- Confidence: High on the mechanism; Medium on real-world frequency.
- Classification: confirmed mechanism / likely impact.
- Files:
  - `apps/web/src/lib/image-queue.ts:412-468` (`bootstrapMissingActiveEmbeddings` — no in-flight guard)
  - `apps/web/src/lib/image-queue.ts:981-984` (fire-and-forget launch inside `bootstrapImageProcessingQueue`)
  - `apps/web/src/lib/image-queue.ts:888-902` (`scheduleBootstrapContinuation`) and `:878-886` (`scheduleBootstrapRetry`) — both re-enter `bootstrapImageProcessingQueue`
  - `apps/web/src/lib/clip-model.ts:56-76` (module-level `activeInferenceCount` + `inferenceWaiters`, `CLIP_INFERENCE_CONCURRENCY` default 1) — shared between `embedImageReal` (this loop) and `embedTextReal` (visitor semantic search)

- Why: every invocation of `bootstrapImageProcessingQueue()` launches a **new**
  `bootstrapMissingActiveEmbeddings(state)` as an un-awaited tracked side effect. The function has
  no "already running" flag (unlike the bootstrap pass itself, which is guarded by
  `state.bootstrapped` / `state.bootstrapContinuationScheduled`). `bootstrapImageProcessingQueue`
  is re-invoked by (a) every continuation batch of a multi-batch bootstrap (`BOOTSTRAP_BATCH_SIZE`
  = 500), (b) every 30 s `scheduleBootstrapRetry` after a permanently-failed job or empty
  continuation, and (c) `resumeImageProcessingQueueAfterRestore`. Each scan starts from cursor 0
  and walks ALL processed rows missing the active-model embedding, embedding each one. Two or more
  overlapping scans therefore fetch the same still-missing rows and compute the same embeddings
  redundantly (the upsert is idempotent, the CPU is not).

- Concrete failure scenario: production semantic mode is active
  (`SEMANTIC_SEARCH_ALLOW_PRODUCTION=true` + DB `semantic_search_mode='production'`) and a backlog
  of processed rows lacks embeddings (mode flipped without a complete sidecar backfill, or a batch
  of embedding side effects failed transiently). The startup scan begins real ONNX inference —
  hundreds of ms to seconds per image at `CLIP_INFERENCE_CONCURRENCY=1`, so a 1-5k-row backlog is
  an hours-long loop inside the web process. During that window one upload permanently fails →
  `bootstrapped=false` + 30 s retry → a second full scan launches and re-embeds the same rows the
  first scan hasn't reached; each further retry stacks another. All scans submit image embeds into
  the SAME module-level inference-slot queue that visitor semantic-search text embeds wait on, so
  public searches queue up to `CLIP_INFERENCE_QUEUE_TIMEOUT_MS` (30 s) behind backfill work or
  fail `ClipInferenceQueueFullError` at `CLIP_INFERENCE_MAX_PENDING` (32). CPU burned is roughly
  multiplied by the number of overlapping scans.

- Secondary observation (same function, no fix required at current scale): when zero rows are
  missing, the anti-join (`images LEFT JOIN image_embeddings ON imageId AND modelVersion … WHERE
  … IS NULL`) must probe the embeddings PK for every processed image row before returning an
  empty batch — a full-table walk per bootstrap invocation whenever semantic mode ≠ disabled.
  Bounded and cheap at personal scale; worth remembering if the table grows.

- Suggested fix: add an in-flight guard mirroring `bootstrapContinuationScheduled` — e.g.
  `state.embeddingRetryInFlight: Promise<void> | null`, set before launch, cleared in `finally`,
  and skip the launch when non-null. Alternatively (or additionally) move the retry off the
  per-bootstrap-pass path onto the existing hourly GC interval so it runs at a fixed cadence.
  A one-line dedupe preserves the current recovery semantics (C9-07) with no schema change.

### PERF-02 — Masonry gallery re-renders every card on every resize frame (unquantized `viewportWidth` state)

- Severity: Low.
- Confidence: High (mechanism read from code); impact limited to interactive resize/orientation
  changes on long (post-load-more) galleries.
- Classification: confirmed mechanism.
- Files:
  - `apps/web/src/components/home-client.tsx:29` (`viewportWidth` state), `:44-53` (`update()` runs per rAF'd resize event and stores raw `window.innerWidth`)
  - `apps/web/src/components/home-client.tsx:216-222` (`estimatedCardWidth` memo keyed on raw `viewportWidth`)
  - `apps/web/src/components/home-client.tsx:299-427` (per-card map: title/alt derivation, srcSet string building, per-card inline `containIntrinsicSize` style derived from `estimatedCardWidth`)

- Why: `useColumnCount` stores the raw pixel viewport width in React state. The rAF debounce
  coalesces resize events to one per frame, but during an interactive window drag the width
  changes every frame, so `setViewportWidth` triggers a re-render of `HomeClient` **per frame**.
  Because `estimatedCardWidth` derives from the raw width, the memo invalidates every frame too,
  and every card's inline `style.containIntrinsicSize` value changes → React re-renders and the
  browser restyles the full card list. Cards are not extracted into a memoized child component, so
  the whole map body (display-title/alt-text helpers + four `imageUrl` srcSet strings per card)
  re-executes for N cards per frame. With the initial 30-card page this is negligible; after
  load-more accumulates several hundred cards (`allImages` grows unboundedly by design), a desktop
  resize drag or repeated mobile orientation/URL-bar viewport changes do O(cards) work per frame.

- Concrete failure scenario: a visitor deep-scrolls a large gallery (10+ load-more pages ≈ 300+
  cards), then resizes the window / rotates the device repeatedly. Every frame re-renders 300+
  cards and forces style recalculation on each, producing visible resize jank on mid-range
  hardware — while the actual layout-relevant output (column count 1-5, card width estimate) only
  meaningfully changes at 4 breakpoints.

- Suggested fix: quantize the stored width (e.g. `Math.round(w / 48) * 48`) or store only what the
  render consumes — `columnCount` plus a bucketed card-width estimate — so state (and therefore
  re-renders) change only when a bucket boundary is crossed. Optionally wrap the card in
  `React.memo` keyed on image id + estimatedCardWidth. Either half of the fix removes the
  per-frame full-grid work.

### PERF-03 — VALIDATION of the critic's `COUNT(*) OVER()` finding (CRIT-05; ledgered as deferred C94-11) — confirmed real at current HEAD, not re-filed

- Severity: Medium (unchanged from ledger). Confidence: High. Classification: confirmed; ALREADY
  DEFERRED (C94-11 in `.context/plans/cycle-96-2026-07-01-deferred.md:144-149`) — this entry is
  validation evidence for the critic lane, not a new finding.
- Files: `apps/web/src/lib/data.ts:913` (`getImagesLitePage`), `apps/web/src/lib/data.ts:1497`
  (`getImagesForSmartCollection`, offset/first-page branch).

- My independent analysis agrees with the critic: both first-page queries select
  `COUNT(*) OVER()` inside a `LEFT JOIN image_tags/tags` + `GROUP BY images.id` +
  `ORDER BY … LIMIT pageSize+1` shape. MySQL evaluates window functions after grouping, so the
  exact group count forces materialization of the FULL grouped, filtered result set before
  `LIMIT 31` can cut it — the composite index `(processed, capture_date, created_at)` can order
  the scan but cannot let it short-circuit. Callers confirmed hot: `app/[locale]/(public)/page.tsx:177`
  and `[topic]/page.tsx:187` (both `revalidate = 0`, i.e. every uncached request) and
  `c/[slug]/page.tsx:111`. The `totalCount` is consumed ONLY as header copy
  (`t('home.metaTitle', { count })`, `home-client.tsx:280`).
- Two pieces of supporting evidence beyond the critic's write-up:
  1. The lean shape already exists in-repo: the cursor/load-more branch of the SAME smart-collection
     helper deliberately omits the window column (`data.ts:1463` comment, returns `totalCount: 0`),
     and `getImageCount()` (`data.ts:592-616`) computes the same total as an index-friendly
     `COUNT(*)` over `images` with the tag filter as an `IN (subquery)` — no tag join, no GROUP BY.
     Running that in parallel (`Promise.all`) with a window-free page query would preserve the
     exact header count at strictly lower cost than the grouped window scan.
  2. `__tests__/data-tag-names-sql.test.ts` pins the window function in place (the critic's
     CRIT-04 point), so the fix must retire that assertion in the same change.
- Disposition: keep tracked under C94-11's exit criterion; schedule rather than re-defer if listing
  latency evidence appears.

### PERF-04 — Multipart uploads are fully materialized on the heap by the framework before the "stream to disk" step

- Severity: Low. Confidence: Medium. Classification: needs-manual-validation (framework-internal
  behavior; validate by measuring RSS during a 200 MB upload).
- Files: `apps/web/src/app/actions/images.ts:141` (`formData.getAll('files')` in the server
  action), `apps/web/src/app/api/admin/lr/upload/route.ts` (route-handler `formData()` path),
  `apps/web/src/lib/process-image.ts:905-914` (streams `file.stream()` to disk "to avoid
  materializing up to 200MB on the heap").
- Why: the disk-streaming in `saveOriginalAndGetMetadata` avoids a SECOND copy, but the `File`
  objects it receives come from Next/undici multipart parsing, which buffers part payloads in
  memory (there is no disk spooling for `FormData` files in the Node web-streams implementation;
  `NEXT_UPLOAD_BODY_MAX_BYTES` = 266 MiB caps the body precisely because it is held). So each
  in-flight 200 MB upload transiently pins ≥ 200 MB of RSS regardless of the streaming write, and
  concurrent uploads (browser sends files individually, but nothing serializes two admins or an
  LR client + browser) multiply that.
- Concrete failure scenario: two 200 MB TIFF uploads in flight simultaneously on a small deploy
  host (e.g. 2 GB container) push Node RSS up ~400 MB+ on top of Sharp encode memory, risking
  OOM-kill during the encode fan-out.
- Suggested action: measure (RSS trace during a large upload) and, if confirmed, document the
  memory envelope per concurrent upload in CLAUDE.md's operational notes — an app-level fix is
  not realistically available while uploads ride server actions/`formData()`.

---

## Duplicate-avoidance notes (validated current, NOT re-filed)

- `load_more` / `view_record` limiters still lack the saturated in-memory fast path and still
  increment-then-rollback the persistent bucket on every over-limit request
  (`apps/web/src/app/actions/public.ts:93-116`, `:370-395`) — exactly as filed by the cycle-99
  architect. Confirmed unfixed at `657eb024`; nothing new to add beyond noting
  `loadMoreSmartCollectionImages` shares the same helper and is covered by the same fix.
- Public `LIKE '%term%'` search, feed/sitemap `updated_at` ordering without a dedicated index,
  and brute-force bounded semantic scans — all remain the cycle-99 residual risks; no change.
- Sidecar backfill queueing behavior, view-retention chunked GC, audit-log sweep — ledgered.

## Confirmed controls re-verified this pass (spot list)

- DB pool: 10 connections / queue 20; per-connection `group_concat_max_len` init guarded by a
  10 s raced, unref'd, `finally`-cleared timer — no timer or connection leak (`db/index.ts:94-112`).
- `rate_limit_buckets` purge is indexed (`idx_rate_limit_buckets_bucket_start`, `schema.ts:221`)
  and batch-bounded (1000 × 50); hourly GC timer armed once (`image-queue.ts:1042-1052`).
- New cycle-97 feed limiter is a bounded map with interval pruning; cycle-97 `.tmp`/`.bak` cleanup
  is age-gated (1 h) so it cannot race a live sidecar backfill's transient files.
- Upload quota claim is synchronous-before-first-await with settle-on-throw rollback
  (`images.ts:232-313`); batch delete uses one transaction + `IMAGE_CLEANUP_CONCURRENCY`-bounded
  (default 5, max 32) file cleanup; >20-image batches collapse revalidation to one layout call.
- Image-serving fallback path: settings-hash ETag behind a 5 s stale-while-revalidate module cache
  (never blocks on refresh once warm), HEAD short-circuit, 304 support, abort-signal fd cleanup
  (`serve-upload.ts:46-89`, `:239-306`).
- SW: lazy single-flight revalidate GET, 300 ms-bounded HEAD probe, O(1)-amortized LRU head-walk,
  serialized meta mutations (`sw.template.js:98-141`, `:259-352`) — matches `lib/sw-cache.ts`
  reference and the pinned contract test.
- Shared-group view-count buffer: swap-before-drain, chunked flush, retry caps, exponential
  backoff, shutdown drain handle (`data.ts:18-249`).
- `getImage` prev/next + tags run as one `Promise.all` (3 parallel queries); shared-group page
  batches tags in one `inArray` query (no N+1); `getImageByShareKey` is a single grouped query.
- Timeline/On-This-Day non-sargable `YEAR()/MONTH()` predicates are documented and row-capped
  (`data-timeline.ts:88-116`, `:159-214`); map markers capped at 10k; analytics queries are
  admin-only and ride the `(bot, viewed_at, …)` composite indexes.
- `getLatestImageForOg` avoids the grouped listing query for the home OG card (AGG-R8c3-05).
- Middleware does no DB work; restore-maintenance checks on hot paths are an in-memory boolean
  (`restore-maintenance.ts`); the sync `statSync/writeFileSync` durable-marker calls are confined
  to the restore flow and instrumentation startup.

## Files/areas examined

- Context/ledgers: CLAUDE.md; cycle-96/98 deferred; cycle-99 perf + architect; cycle-1 critic,
  security-reviewer, test-engineer, verifier.
- DB layer: `db/index.ts`, `db/schema.ts` (full).
- Data layer: `lib/data.ts` (lines 1-320, 560-1000, 999-1400, 1400-1803 — full coverage across
  passes), `lib/data-timeline.ts`, `lib/analytics-data.ts` (full).
- Queue/pipeline: `lib/image-queue.ts` (full), `lib/queue-shutdown.ts`,
  `lib/process-image.ts` (`saveOriginalAndGetMetadata` + pipeline entry points; encoder body
  covered by prior cycles and unchanged since `d6912560`), `lib/process-topic-image.ts` (grep),
  `lib/upload-tracker-state.ts`/`upload-tracker.ts` (re-verified via cycle-99 + grep).
- Rate limiting: `lib/rate-limit.ts` (full), `lib/bounded-map.ts` (via cycle-99 + spot checks),
  `lib/auth-rate-limit.ts` (spot).
- Actions: `app/actions/public.ts` (full), `app/actions/images.ts` (upload path lines 1-530 +
  delete path 769-905 + loop inventory), other actions spot-checked via grep (loops, awaits).
- Serving/caching: `lib/serve-upload.ts` (full), `lib/settings-hash.ts` (via serve-upload +
  cycle-99), `public/sw.template.js` (full), `lib/gallery-config.ts` (resolution + caching).
- Routes: `api/search/semantic`, `api/search/similar/[id]`, `api/og/*`, `feed.xml` (validated in
  cycle-99 at identical code — commits since are docs-only; re-checked file lists + rate-limit
  wiring via grep), `app/uploads/[...path]/route.ts` (grep), `api/admin/lr/upload/route.ts`
  (multipart handling + saveOriginal call sites).
- CLIP: `lib/clip-model.ts` (inference queue), `lib/clip-embeddings.ts`/`clip-inference.ts` (grep).
- Components: `home-client.tsx` (full), `load-more.tsx` (full), `photo-viewer.tsx` +
  `histogram.tsx` (structure/hot-path pattern scan — worker + transferable buffer confirmed),
  `image-zoom.tsx` (ref-based per CLAUDE.md, unchanged).
- Infra: `proxy.ts` (full), `instrumentation.ts` (grep), `lib/restore-maintenance.ts` (full),
  `lib/restore-maintenance-durable.ts` (call-site scan), `lib/revalidation.ts` (full).
- Git: cycle-97 diffs for `rate-limit.ts` and `image-queue.ts` (the most recent source changes).

## Commonly-missed-issues sweep

- Sync I/O on request paths: swept `readFileSync/statSync/execSync/…` across lib/app/components —
  only the restore durable marker (restore flow + startup) uses sync fs; hot paths are clean.
- `JSON.parse` of large payloads: five sites, all bounded (smart-collection AST has depth/size
  caps; processing snapshots are small; semantic route caps body bytes before parse).
- Regex catastrophic backtracking: SW route regexes, `normalizeIp`, `SAFE_SEGMENT`, cursor
  datetime regexes are all linear (character classes / anchored, no nested quantifiers).
- Per-request compilation/allocation: CSP string build in middleware is trivial; no per-request
  schema/regex compilation found.
- Unbounded module state: all module-level Maps/Sets are capped (bounded maps, retry maps
  MAX 10000, permanentlyFailedIds 1000, view buffer 1000/500, upload tracker capped) — except the
  intentional client-side `allImages` accumulation (see PERF-02).
- Server-only imports leaking to client: `clip-model`/`sharp`/`onnxruntime` are lazily imported
  server-side and guarded by the client-server-only-boundary test; `serve-upload` imports the
  pipeline version from client-safe `gallery-config-shared` (R4C1 fix intact).
- Connection-pool starvation: queue concurrency, in-app backfill concurrency, and sidecar budgets
  re-verified against `POOL_CONNECTION_LIMIT=10` math (image-queue cap 2 at pool 10; reserve 5).
- Event-loop blockers: no sync crypto beyond per-key `createHash` (cheap); Argon2 is async native.
- No relevant file class skipped: lib/, actions/, api routes, db/, heavy components, scripts entry
  points (backfill scripts examined in prior cycles; unchanged since), sw.template.js.

## Caveats

- Static review only: no EXPLAIN, load test, RSS measurement, or browser profiling was run.
  PERF-01's impact sizing and PERF-04's memory claim would both benefit from a short dynamic probe.
- PERF-02's practical impact depends on gallery depth (load-more count) and device; the mechanism
  is certain, the user-visible jank threshold is estimated.
- Routes verified as unchanged since cycle-99 were re-checked by commit inspection (docs-only
  commits `8b09ce64`, `657eb024`), not re-read line-by-line.
