# GalleryKit Performance Review

- **Reviewer:** perf-reviewer (r2-perf)
- **Date:** 2026-07-07
- **Scope:** apps/web — data layer, image pipeline, background queues, DB schema/pool, API routes, server actions, middleware, service worker, client components.
- **Method:** full read of core pipeline files (`data.ts`, `image-queue.ts`, `process-image.ts`, `admin-backfill-runner.ts`, `serve-upload.ts`, `rate-limit.ts`, `db/schema.ts`, `db/index.ts`, `restore-maintenance*`, `bounded-map.ts`) plus two exhaustive delegated passes covering all client components + SW template and all API routes/actions/lib helpers. Final sweep: grep for sync fs/crypto in hot paths (only startup/script-path `statSync` found), call-site verification for GPS strip and topics queries.
- **No source files were modified.** (This file replaces a stale cycle-35 report.)

Overall verdict: this codebase is unusually well-hardened for performance (bounded maps, pre-increment limiter fast paths, TTL + inflight-dedupe caches, chunked deletes, LIMIT caps with N+1 lookahead, keyset pagination, worker-offloaded histogram, ref-based zoom transforms). **No CRIT findings.** The remaining issues cluster in four areas: (1) per-render DB work that landed on `revalidate = 0` hot pages after its original slow-path assumption, (2) the semantic-search embedding scan, (3) warm-path service-worker write amplification, and (4) a handful of client re-render hotspots that ignore the repo's own best-practice patterns.

---

## MED findings

### PERF-01 — Service worker rewrites the full cached image body on every 304-confirmed view
- **Severity:** MED · **Confidence:** High (mechanism confirmed; latency magnitude needs runtime validation)
- **Where:** `apps/web/public/sw.template.js:219-223` (`refreshCachedImageTimestamp`), invoked at `:316-321` (304 branch) and `:334-338` (same-ETag branch); reference logic in `apps/web/src/lib/sw-cache.ts`
- **Why:** On the common warm-cache path (server answers 304, or 200 with identical ETag), the SW rebuilds the cached `Response` (double body tee) and `await`s `imageCache.put(...)` **before returning the response to the page** — a full body storage write per view whose only purpose is refreshing the `sw-cached-at` header, even though `touchMeta` records the same timestamp in the meta store on the next line.
- **Scenario:** returning visitor, warm 30-tile masonry page on mobile → ~30 concurrent 100 KB–1 MB Cache-storage rewrites per page view: serve latency per tile, storage I/O contention, flash wear, battery.
- **Fix:** make `evictExpiredCachedImage` (`:233`) read the timestamp from the LRU meta entry (already updated under the same mutation queue) and return `cached` directly on 304/same-ETag; keep the header only as fallback for pre-change entries. Minimum viable: drop the `await` (fire-and-forget). Mirror in `sw-cache.ts` + the template-contract test.
- **Status:** confirmed from code.

### PERF-02 — Map renders up to 10,000 individual Leaflet DOM markers with no clustering
- **Severity:** MED (escalates toward HIGH once a few thousand geotagged photos are map-visible) · **Confidence:** High on mechanism; magnitude depends on GPS density
- **Where:** `apps/web/src/components/map/map-client.tsx:120-139`; cap at `apps/web/src/lib/data.ts:1714` (`MAP_MAX_MARKERS = 10000`)
- **Why:** each `<Marker>` is a full DOM element + React instance; Leaflet DOM markers degrade visibly in the hundreds. Every pan/zoom repositions all markers on the main thread. Secondary: `FitBounds` (`:87-90`) spreads up-to-10k-element arrays into `Math.min/max` args.
- **Scenario:** photographer with a few thousand geotagged photos opens `/map` on a phone → multi-second hang on mount, janky pan/zoom, high memory.
- **Fix:** marker clustering (`leaflet.markercluster`/supercluster) or canvas-rendered `CircleMarker` with `preferCanvas`; replace the spread-arg min/max with a reduce loop.
- **Status:** confirmed from code; hang magnitude needs device validation.

### PERF-03 — `getTopics()` correlated `MAX(updated_at)` subquery runs on every public page render
- **Severity:** MED (grows linearly with gallery size) · **Confidence:** High
- **Where:** `apps/web/src/lib/data.ts:516-528`; consumed via `getTopicsCached` by `app/[locale]/(public)/page.tsx:166` (home, `revalidate = 0`), `[topic]/page.tsx`, `c/[slug]/page.tsx`, and `components/nav.tsx`
- **Why:** the R18-M1 comment justifies the per-topic `MAX(updated_at)` subquery by the sitemap's `revalidate = 3600` ISR window — but `getTopicsCached` is also the nav/home/topic-page accessor on `revalidate = 0` surfaces. React `cache()` only dedupes within one request. `updated_at` is not part of `idx_images_topic` (topic, processed, capture_date, created_at), so each topic's MAX requires row lookups across its entire (topic, processed) index range → O(total processed images) row probes per anonymous render of the hottest pages.
- **Scenario:** 50k-photo gallery, home-page crawler burst → every render pays a full per-topic scan on top of the masonry query, count query, and on-this-day scan (PERF-06), all against a 10-connection pool.
- **Fix (pick one):** split into a sitemap-only accessor with the subquery and a lean `getTopics` for nav/pages; or append `updated_at` to `idx_images_topic` (covering index makes the MAX a b-tree edge probe); or micro-cache the topics list (5-60 s TTL, same pattern as `serve-upload.ts:46-83`).
- **Status:** confirmed from code (call sites verified by grep).

### PERF-04 — Semantic/similar search: ~4 MB DB fetch + ~1M scalar decode calls per anonymous request, no cross-request caching
- **Severity:** MED · **Confidence:** High (mechanism); impact needs runtime measurement
- **Where:** `apps/web/src/app/api/search/semantic/route.ts:270-311`, `apps/web/src/app/api/search/similar/[id]/route.ts:173-206`, `apps/web/src/lib/clip-embeddings.ts:104-113`
- **Why:** every admitted request re-fetches up to `SEMANTIC_SCAN_LIMIT` (2000) rows × 2048-byte MEDIUMBLOBs (~4 MB off the single MySQL writer) and decodes each with a 512-iteration `buf.readFloatLE` loop (~1,024,000 bounds-checked calls + a fresh `Float32Array` per row per request). CLIP inference is concurrency-capped, but the scan+decode stage is guarded only by a per-IP, per-process, in-memory limiter (30/min/IP).
- **Scenario:** 50 IPs × 30 req/min → ~200 MB/min MEDIUMBLOB reads + sustained decode CPU; latency rises on all pool-sharing surfaces.
- **Fix:** (a) zero-copy decode: `new Float32Array(buf.buffer, buf.byteOffset, EMBEDDING_DIM)` (write path allocates fresh aligned buffers; platforms are little-endian); (b) short-TTL in-process cache of the decoded active-model embedding matrix keyed by model version + max `updated_at`, so concurrent searches share one scan.
- **Status:** confirmed from code.

### PERF-05 — Anonymous view recording costs 4 sequential DB round-trips per page view
- **Severity:** MED · **Confidence:** High (round-trip count); benefit size needs measurement
- **Where:** `apps/web/src/app/actions/public.ts:436-461` (`recordPhotoView`), `:464-493` (`recordTopicView`), `:496-529` (`recordSharedGroupView`); the increment-then-select pair also on `loadMoreImages`/`searchImagesAction` (`:88-130`, `:291-307`); `apps/web/src/lib/rate-limit.ts:451-496`
- **Why:** each anonymous page load performs: `incrementRateLimit` (INSERT…ON DUPLICATE) → `checkRateLimit` (SELECT) → target-existence SELECT → view INSERT — sequential round-trips on the hottest anonymous write path, stacked on `revalidate = 0` page queries against pool 10/queue 20. The in-memory saturated fast path (C1-01) is correct; the DB pair is simply 2 statements where 1 suffices.
- **Fix:** fold increment+check into one statement via the `count = LAST_INSERT_ID(count + 1)` upsert (new count returns in the OK packet's `insertId`); optionally micro-batch view INSERTs like the shared-group `view_count` buffer already does.
- **Status:** confirmed from code.

### PERF-06 — Non-sargable `MONTH()/DAY()/YEAR()` scans run per-request on `revalidate = 0` pages, including the home page
- **Severity:** MED · **Confidence:** Medium (shape confirmed and acknowledged in comments; severity depends on gallery size)
- **Where:** `apps/web/src/lib/data-timeline.ts:97-119` (`getOnThisDayImages`), `:129-146`/`:186-214` (timeline/year); invoked by `OnThisDayWidget` on every home render (`app/[locale]/(public)/page.tsx:19` `revalidate = 0`, widget at `:234`, query at `components/on-this-day-widget.tsx:21`, no cache wrapper)
- **Why:** `MONTH(capture_date)/DAY(capture_date)` defeat the index beyond the `processed = true` prefix → per-row evaluation across all processed images with a 3-table tag JOIN + GROUP BY, per home-page render. The in-code "personal-gallery scale" acceptance predates the widget landing on the home hot path.
- **Fix:** range predicates for year queries (already proposed in a code comment); generated month/day columns (or a `(processed, month, day)` functional index) for on-this-day; and/or a module-scoped TTL cache keyed `(month, day)` — the result changes at most daily.
- **Status:** confirmed shape; impact needs measurement at scale.

### PERF-07 — `updateTag`/`deleteTag` materialize every image ID for the tag and UPDATE via unbounded `IN (...)` inside a transaction
- **Severity:** MED · **Confidence:** High (shape); admin-triggered likelihood scales with data
- **Where:** `apps/web/src/app/actions/tags.ts:90-105` (`updateTag`), `:160-174` (`deleteTag`)
- **Why:** `SELECT imageId … WHERE tagId = ?` with no LIMIT, then `UPDATE images SET updated_at = … WHERE id IN (<all ids>)` inside the transaction. A tag on tens of thousands of photos → multi-MB SQL packet, long-held row-lock set on `images`, pool connections pinned while public traffic queues (queueLimit 20 → hard "Queue limit reached" errors).
- **Fix:** single-statement join update: `UPDATE images JOIN image_tags ON image_tags.image_id = images.id SET images.updated_at = CURRENT_TIMESTAMP WHERE image_tags.tag_id = ?`. (Contrast: `bulkUpdateImages` in images.ts correctly caps at 100 ids.)
- **Status:** confirmed from code.

### PERF-08 — Info bottom sheet re-renders its whole subtree on every `touchmove` during drag
- **Severity:** MED · **Confidence:** High (mechanism); jank magnitude needs low-end-device validation
- **Where:** `apps/web/src/components/info-bottom-sheet.tsx:89-94` (`setLiveTranslateY` per touchmove), consumed in inline style at `:211-214`
- **Why:** drag fires state updates at 60–120 Hz; each re-renders the expanded sheet's full EXIF `<dl>` grid + `ColorDetailsSection` + `WideGamutHint` + `Histogram`, purely to update one `transform` string — the exact pattern `image-zoom.tsx:57` deliberately avoids with ref-based direct DOM writes.
- **Fix:** write `sheetRef.current.style.transform` directly in touch handlers; commit React state once on `touchend` (same idiom as `applyTransform` in image-zoom.tsx).
- **Status:** confirmed from code.

### PERF-09 — Masonry grid re-renders every loaded card on each infinite-scroll append (no card memoization)
- **Severity:** MED · **Confidence:** High (mechanism); practical impact moderated by `content-visibility: auto`
- **Where:** `apps/web/src/components/home-client.tsx:310-438` (inline card render in `orderedImages.map`), state append at `:142-144`
- **Why:** per-card body runs title/alt derivation, `isWideGamutPrimary`, and builds 4+ srcset strings; because cards are inline (not `React.memo` children), every `allImages` append, viewport-bucket change, and `showBackToTop` flip re-runs this for ALL loaded cards. CSS `content-visibility` contains browser paint, not React reconciliation.
- **Scenario:** 10 pages deep (~300 images) → each append re-renders 300+ cards to add 30; main-thread stall grows linearly with scroll depth, during scrolling.
- **Fix:** extract a `React.memo` `MasonryCard` (props: `image`, `estimatedCardWidth`, `isAboveFold`, `topicLabel`, `locale`).
- **Status:** confirmed from code.

### PERF-10 — `stripGpsFromOriginal` reads the entire original (≤200 MB) into memory per file
- **Severity:** MED · **Confidence:** High (mechanism); RSS impact needs concurrency measurement
- **Where:** `apps/web/src/lib/process-image.ts:1752` (`const input = await fs.readFile(filePath)`); called per uploaded file from `app/actions/images.ts:415` (sequential within one action, `:367` for-loop) and `app/api/admin/lr/upload/route.ts:416`
- **Why:** with `strip_gps_on_upload` enabled, every upload materializes the full original on the heap for the lossless scrub (Tier 1), in addition to the framework's own formData buffering. Sequential within a request, but concurrent upload requests (dashboard + LR clients) each hold a full-file buffer simultaneously.
- **Scenario:** 3 concurrent 200 MB TIFF uploads with GPS strip on → ~600 MB transient RSS + GC pressure on a small VPS, on top of Sharp encode memory.
- **Fix:** the JPEG/TIFF/ISOBMFF scrubbers only need header/metadata regions plus a byte-splice; read a bounded head (metadata always precedes pixel data in these containers) and stream-copy the remainder, or at minimum gate concurrent strips with a small semaphore like the LR route's parse slot.
- **Status:** confirmed read; streaming feasibility per container needs validation against `gps-exif-strip.ts` internals.

### PERF-11 — Feed and sitemap queries ORDER BY `updated_at DESC` with no supporting index → full filesort of the processed set
- **Severity:** MED (LOW at personal scale) · **Confidence:** High (shape)
- **Where:** `apps/web/src/lib/data.ts:841-852` (`getImagesForFeed`), `:863-873` (`getFeedUpdatedAt`), `:1692-1703` (`getImageIdsForSitemap`); indexes at `apps/web/src/db/schema.ts:117-123` cover `(processed, capture_date, created_at)` and `(processed, created_at)` only
- **Why:** `WHERE processed = true ORDER BY updated_at DESC LIMIT n` cannot use any index for the sort — MySQL filesorts every processed row before applying LIMIT 50 (feed) / 24000 (sitemap). Each uncached feed hit runs this twice (`getFeedUpdatedAt` for conditional-GET + the entry query). Mitigated by feed rate limiting (60/min/IP), `s-maxage=1800`, and sitemap ISR 3600, so this is pressure, not outage.
- **Fix:** add `(processed, updated_at, id)` index, or order feeds by `created_at` (indexed) and treat `updated_at` as display metadata.
- **Status:** confirmed from code.

### PERF-12 — Admin image table: per-row `TagInput` memo-defeat + one document-level listener per row
- **Severity:** MED-LOW · **Confidence:** Medium-High (cost matters at large tables × large tag vocabularies)
- **Where:** `apps/web/src/components/image-manager.tsx:502` (fresh `selectedTags` array identity per render); `apps/web/src/components/tag-input.tsx:58-66` (`filteredTags` memo re-computes NFKC-normalize over `availableTags × selectedTags`), `:158-166` (per-instance `document.addEventListener('mousedown')`)
- **Scenario:** 100 rows × 500 tags: one checkbox toggle (new `Set` at `:129-137`) → ~10⁵ Unicode normalizations + full-table reconciliation per click; every page click fans out to 100 mousedown handlers.
- **Fix:** memoize a row component; derive split tag arrays once per image; attach the click-outside listener only while a dropdown is open (or one delegated listener).
- **Status:** confirmed from code.

---

## LOW findings

### PERF-13 — `revalidate = 0` public pages fan out 6–10 queries/render against pool 10 / queueLimit 20 → hard errors on burst
- **Confidence:** Medium; needs load validation. `apps/web/src/db/index.ts:31-33` (`connectionLimit: 10, queueLimit: 20` — waiters beyond 20 reject immediately). Home render ≈7 queries; photo page ≈8; topic page +4 via view recording. ~25–30 concurrent anonymous renders can overflow the acquire queue → request errors rather than graceful slowdown. This is the documented freshness contract (CLAUDE.md: reintroduce ISR only with an invalidation plan) — reported as an accepted-risk pressure point. PERF-03/05/06 fixes and short-TTL micro-caches of `getTagsCached`/`getTopicsCached`/`getSeoSettings` (pattern: `serve-upload.ts:46-83`) are the levers.

### PERF-14 — SW LRU metadata is one JSON blob, fully parsed + re-serialized per cache event
- **Confidence:** High. `apps/web/public/sw.template.js:75-196`; explicitly deferred in `src/lib/sw-cache.ts:120-124`. A 30-tile paint = 30 sequential whole-document read-modify-write cycles of tens-of-KB JSON in the SW thread. Reported for completeness; per-URL meta keys or IndexedDB if revisited.

### PERF-15 — SW per-cached-image synchronous HEAD probe on the display path (design-accepted)
- **Confidence:** High. `apps/web/public/sw.template.js:307-343`. 300 ms-bounded (AGG-R8-05) but doubles request count on warm paints; on a degraded network each tile eats up to 300 ms. Compatible improvement: record last-probe time in the meta entry and skip the HEAD within a ~60 s cooldown — preserves the admin-settings-change freshness intent (changes are hours/days apart) while removing same-session repeat probes.

### PERF-16 — Encoder fan-out decodes the source once per size per format (up to 8 sizes × 3 formats = 24 full decodes)
- **Confidence:** Medium. `apps/web/src/lib/process-image.ts:1236-1284` — a fresh `sharp(processingInputPath)` per size inside `generateForFormat`. WI-14/R8-R8 mandates per-FORMAT isolation (documented, correct); the per-size cost is inherent to sharp (clone() shares input, not decoded pixels), so the only real win is a pyramid strategy (encode largest, resize subsequent sizes from a lossless intermediate) — which changes resampling provenance and needs a photographer-quality sign-off. Flagged as a throughput opportunity (seconds per 40 MP image), not a defect. Needs validation: benchmark + quality review before touching.

### PERF-17 — Public search is a 6-column leading-wildcard LIKE full scan (includes a TEXT column)
- **Confidence:** High. `apps/web/src/lib/data.ts:1601-1619`; up to 3 such queries per underfilled search. Well-guarded (30/min/IP + DB-backed limiter, 200-codepoint cap). Scale note: FULLTEXT index or search strategy change past tens of thousands of rows.

### PERF-18 — Atom feeds rebuild the full query + XML even for 304 responses
- **Confidence:** High; deliberate (C32-FEED). `apps/web/src/app/feed.xml/route.ts:163-174` and the topic feed twin `:185-196` — content-derived ETag means a 304 saves bandwidth only. Bounded (50 rows) + edge-cached. If it ever profiles hot: memoize `{xml, etag}` keyed by `(topic, feedUpdated)`.

### PERF-19 — `PhotoNavigation` swipe updates React state per unthrottled `touchmove`
- **Confidence:** High (mechanism), low impact (small subtree). `apps/web/src/components/photo-navigation.tsx:115` (`setSwipeOffset` per move; non-passive listener at `:156`). Fix alongside PERF-08 (same ref+direct-style idiom).

### PERF-20 — Upload dropzone: O(n²) grid re-renders during batch upload + full-resolution object-URL previews
- **Confidence:** Medium (admin-only, ≤100 files). `apps/web/src/components/upload-dropzone.tsx:284-295` (3-4 state updates per completed file, each re-rendering the whole grid of TagInput-bearing cards), `:526-532` (object URLs point at the raw originals — browsers decode up to 200 MB images for thumbnail boxes). Fix: memoized file card, single progress-state object, `createImageBitmap(file, { resizeWidth })` previews.

### PERF-21 — `backfillClipEmbeddings` server action can run ~2000 real CLIP inferences inline in one request
- **Confidence:** High; heavily gated (admin-only, 1/hour, advisory lock, currently unwired from UI; sidecar is canonical). `apps/web/src/app/actions/embeddings.ts:129-193`. Flag: do not wire to a UI button without moving to a background runner (`admin-backfill-runner` pattern).

### PERF-22 — Backfill candidate COUNT scans all processed rows per admin status poll
- **Confidence:** Medium (needs poll-frequency validation). `apps/web/src/lib/admin-backfill-runner.ts:390-399` (`fetchCandidateCount`: `WHERE processed = TRUE AND (pipeline_version IS NULL OR pipeline_version < N)` — `pipeline_version` unindexed → full processed-slice scan) exposed via `getAdminBackfillCandidateCount()` (`:921-923`). Admin-only; matters only if the settings UI polls it on an interval during a long run. Fix if polling: cache the count in runner state, or add `(processed, pipeline_version)` index.

### PERF-23 — LR upload route buffers the whole ≤200 MiB file in RAM at the framework layer (mitigated; informational)
- **Confidence:** High. `apps/web/src/app/api/admin/lr/upload/route.ts:60-74, 178-186` — `request.formData()` materializes the file; the route deliberately gates parsing to 1 in-flight (`LR_MULTIPART_PARSE_MAX_IN_FLIGHT`), bounding peak RSS; the browser action then streams to disk correctly (`process-image.ts:905-914`). No action needed — recorded so the parse slot isn't removed casually. Interacts with PERF-10 (strip adds a second full-file buffer after the framework one is released).

---

## Explicitly verified non-findings (final sweep)

- **Sync fs/crypto in hot paths:** only `fs.statSync/mkdirSync/writeFileSync` in `lib/restore-maintenance-durable.ts:39,67-68` — startup/sidecar-script path only; the per-request `isRestoreMaintenanceActive()` (`lib/restore-maintenance.ts`) is a pure in-memory boolean. Clean.
- **serve-upload.ts:** exemplary — 5 s SWR settings-hash cache with inflight dedupe (prevents the per-derivative `admin_settings` SELECT stampede), 304 + HEAD fast paths, fd cleanup on client abort.
- **image-queue.ts:** concurrency clamped against the pool budget (`resolveImageQueueConcurrency`), bounded retry maps with FIFO eviction, in-flight dedupe on the embedding bootstrap scan (C1-06), one-shot hourly GC arm (AGG-M12). The advisory-lock connection held per in-flight job is budgeted. Clean.
- **data.ts shared-group view buffer:** capped, chunked, exponential backoff, retry-count hygiene, shutdown drain handle. Clean.
- **admin-backfill-runner.ts:** keyset-paginated batches, pool-budget concurrency clamp, per-image claim with locked-skip semantics. Clean besides PERF-22.
- **db/index.ts:** `group_concat_max_len` init promise race is timer-hygienic (cleared + unref'd). Clean besides the PERF-13 queueLimit note.
- **rate-limit.ts / auth-rate-limit.ts / bounded-map.ts:** bounded maps, throttled prunes, batched indexed purges. Clean besides the PERF-05 two-statement pattern.
- **Analytics:** aggregations ride the `(bot, viewed_at, dim)` covering indexes (schema.ts:238-266); retention deletes are chunked + iteration-capped on `(viewed_at, id)` indexes. Clean.
- **OG routes / og-photo-fetch:** rate-limited, ETag short-circuit before Satori render, per-attempt (3.5 s) + total (10 s) budgets, 1 MB caps. Clean.
- **clip-model.ts:** lazy singleton, bounded slots/queue/timeouts. Clean.
- **proxy.ts:** no DB, no heavy crypto per request. Clean.
- **smart-collections.ts:** depth/node/IN budgets, parameterized. (Unindexed EXIF predicates share PERF-17's accepted scale class.)
- **Client components judged clean:** photo-viewer, histogram (exemplary), image-zoom (+math), load-more, lightbox (+color pip), grid-picture (+boundary), map-loader, similar-photos, search, tag-filter, optimistic-image, on-this-day-widget (client part), nav-client, register-service-worker, use-display-capability, bulk-edit-dialog, admin-user-manager, wide-gamut-hint.

## Coverage statement

All files named in the review brief were examined: `src/lib/data.ts`, `image-queue.ts`, `process-image.ts`, `admin-backfill-runner.ts`, `serve-upload.ts`, `sw.template.js` (+ `sw-cache.ts`), heavy client components (full `components/` list above), all API route handlers, all server actions, `db/schema.ts` indexes vs live query shapes, both in-memory and DB-backed rate limiters, middleware, config/settings-hash layers, analytics/timeline/view-retention/audit helpers, and CLIP libs. Not deep-audited (bounded, per-upload, self-capped parsers with documented scan limits): `color-detection.ts`, `gps-exif-strip.ts` internals, `icc-*`, `gain-map-detection.ts` — no unbounded-input path reaches them (inputs capped at 200 MiB and scans capped at 1 MB where applicable), except as consumed by PERF-10.
