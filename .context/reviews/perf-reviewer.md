# Performance / Concurrency / Memory Review — GalleryKit

**Reviewer:** perf-reviewer (code-reviewer lane)
**Date:** 2026-06-13
**HEAD:** `ce0029aa` (working tree clean for source; only `.context/reviews/*` + untracked `plan/*` dirty)
**Scope:** image pipeline (`process-image.ts`, `image-queue.ts`), in-app backfill runner, data layer (`data.ts`, `data-timeline.ts`), DB pool + indexes (`db/schema.ts`), service worker (`sw.js` / `sw.template.js`), masonry/home-client/histogram components, heavy API routes (OG photo, feed, search), home page SSR.

## Verdict

**COMMENT.** No CRITICAL or HIGH performance defects at any confidence. This is a convergence cycle for performance: the two perf items from the run-8 cycle-3 aggregate that touched the hot path are both **CLOSED and verified at HEAD**, not on the plan's word:

- **AGG-R8c3-05 / PERF-1 (home double heavy query) — CLOSED** (commit `e9040d17`). `generateMetadata` now calls `getLatestImageForOgCached` → `getLatestImageForOg` (`data.ts:873`), which selects ONLY `{ id, title }` with NO `LEFT JOIN imageTags + tags`, NO `GROUP_CONCAT`, NO `GROUP BY` — a single `LIMIT 1` scan over the `(processed, capture_date, created_at)` composite index, `cache()`-wrapped. The page body still issues exactly ONE `getImagesLitePage` (`page.tsx:162`). The redundant full-listing query in the metadata path is gone.
- **AGG-R8c3-03 (backfill orphaned-derivative leak on delete-during-reencode) — CLOSED** (commit referenced in `admin-backfill-runner.ts`). Both UPDATE branches now check `affectedRows === 0 → cleanupDeletedMidReencodeVariants(row)` (`:573`, `:605`) with a dedicated `deletedMidReencode` tally, mirroring the upload-queue worker's `affectedRows===0 → cleanup` guard (`image-queue.ts:372-381`). The disk-leak/observability gap is fixed; the new tally is correctly excluded from the WITH-FAILURES banner (`:791`).

The codebase remains unusually well-tuned: Sharp libvips threads divided by the AVIF/WebP/JPEG fan-out (`maxConcurrency = floor((cores-1)/3)`), `sharp.cache(false)` for steady RSS, React `cache()` SSR dedup on every `*Cached` accessor, keyset pagination with shared `tagNamesAgg`, `COUNT(*) OVER()` window count (no second count query on public pages), batched-keyset backfill (O(batch) residency), worker-driven histogram with `AbortController` + 256px cap + `terminate()` on unmount, ref-based zoom (no re-render on move), rAF-debounced masonry resize, snapshot-memoized `useDisplayCapability` (React #185 guarded), and the AGG-R8-05 bounded SW HEAD probe.

All findings below are LOW. None regressed; one is a pre-existing latent best-effort-cache item.

---

## Findings

### PERF-L1 — SW image-cache metadata is a lost-update (whole-doc overwrite, no CAS) [= AGG-R8c3-10, latent]
**Severity:** LOW · **Confidence:** HIGH · **Disposition:** record-only / defensible to defer
**File:** `apps/web/public/sw.js` `recordAndEvict` (`:95-122`), `touchMeta` (`:152-161`), `getMeta`/`setMeta` (`:70-91`)

`recordAndEvict` and `touchMeta` both do `getMeta() → mutate the Map → setMeta()` against a single `/__meta__` JSON document in `META_CACHE`, with no single-flight lock or compare-and-set. A warm masonry paint fires ~30 concurrent `staleWhileRevalidateImage` calls; on the cache-miss/200-revalidate path each one runs its own read-modify-write of the *whole* meta doc, so concurrent writers silently clobber each other's entries. **Effect is cache-housekeeping ONLY** — no served-byte impact: the running `total` can drift LOW (the LRU under-counts, so the IMAGE_CACHE may exceed the 50 MB cap until the browser's own quota eviction kicks in) and some recency timestamps are lost (slightly wrong LRU victim order). Pre-existing (not from any recent cycle), and consistent with the documented best-effort cache posture.

**Scenario:** Return visitor cold-cache-filling a 30-tile gallery; N parallel `recordAndEvict` writes land near-simultaneously, last-writer-wins drops the others' size bookkeeping. Over many paints the tracked `total` undershoots actual cached bytes.

**Fix (only if wanted):** a single-flight meta-write lock (serialize `getMeta→mutate→setMeta` through one in-flight promise), or store per-URL size as individual cache entries keyed by URL rather than one monolithic JSON doc (makes each write independent — no read-modify-write of shared state). LOW priority; the 50 MB cap is a soft hint and the browser quota is the real backstop.

### PERF-L2 — Bootstrap pending-image query uses `notInArray` over ≤1000 permanently-failed IDs [= AGG-R8c3-A2, re-confirmed]
**Severity:** LOW · **Confidence:** MEDIUM · **Disposition:** record-only (happy path zero-cost)
**File:** `apps/web/src/lib/image-queue.ts:601-603`

When `permanentlyFailedIds` is non-empty (FIFO-capped at `MAX_PERMANENTLY_FAILED_IDS=1000`), the bootstrap `SELECT … WHERE processed=false AND id>cursor AND id NOT IN (…≤1000 ids…) ORDER BY id ASC LIMIT 500` inlines up to 1000 literals into a `NOT IN` anti-join, run on every bootstrap pass + continuation. The happy path (empty set) skips the clause entirely (`:601` guard) — **zero cost**. The in-memory set is also lost on restart, so a restart re-enqueues every permanently-failed row once until it re-fails `MAX_RETRIES` times.

**Fix (only if a large permanent-failure population is observed):** filter on the already-persisted column with `AND processing_error IS NULL` (set on permanent failure, `image-queue.ts:503-504`) instead of the in-memory `NOT IN`. That also survives restarts. LOW; the cap keeps the current form bounded and correct.

---

## Re-confirmed documented tradeoffs (NOT defects — unchanged)

- **AGG-R8c3-A3 / decode-once-per-format (~18 decodes/image):** Confirmed at `process-image.ts:1109-1115` — `generateForFormat` opens a fresh `sharp(processingInputPath, …)` per (format × size). The `lastRendered` hard-link dedup (`:1078-1087`) only avoids re-encoding identical resize widths WITHIN one format (e.g. original smaller than the smallest configured size), never cross-format decode reuse. This is the deliberate WI-14 / R8-R8 "fresh instance per format eliminates shared-state contamination" decision. CPU-only, background `PQueue` at `QUEUE_CONCURRENCY=1` default, libvips threads capped at `floor((cores-1)/3)` to keep the foreground responsive. No change.
- **AGG-R8c3-A1 / SW per-tile 300ms-bounded HEAD probe:** Confirmed intact — `sw.js:230` AND `sw.template.js:230` both carry `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS=300)`; on abort the `catch` (`:245`) falls through to `startRevalidate(); return cached` (stale-serve). This is the documented R10-H3 freshness behavior, already bounded by AGG-R8-05. Optional micro-opt (per-URL probe TTL in `META_CACHE`) noted in prior cycles; not a regression, not a defect.
- **Atom feed `updated_at` filesort:** `data.ts:792` `getImagesForFeed` orders by `updated_at DESC, created_at DESC, id DESC`; no `(processed, updated_at)` composite index exists (schema has `(processed, capture_date, created_at)` + `(processed, created_at)`). Bounded by `safeLimit ≤ LISTING_QUERY_LIMIT_PLUS_ONE` (≤101) + route cache + low-traffic syndication path. Sub-ms at gallery scale. Record-only.
- **Timeline `YEAR()/MONTH()/DAY()` predicates non-sargable:** `data-timeline.ts:108-109,188-191` use `MONTH()/DAY()/YEAR()` function filters that evaluate per-row within the `processed=true` index prefix (documented at `:176-182`). `getOnThisDayImages` is bounded by LIMIT 6; `getTimelineImages` by `TIMELINE_PAGE_LIMIT+1=501`. Acceptable at personal-gallery scale, documented re-open criterion (range predicate) already noted in source. Record-only.
- **`OnThisDayWidget` runs a third home-render query:** `on-this-day-widget.tsx` is a SERVER component rendered inline on the home page (`page.tsx:219`), firing `getOnThisDayImages(month, day)` on every home SSR. Unlike the old OG double-query this is a legitimately DISTINCT dataset (today's anniversary photos, not the latest 30) and is NOT redundant; bounded (LIMIT 6) and not `cache()`-wrapped because its args change daily. Record-only — necessary, bounded work.
- **Single-pool / single-writer topology:** `db/index.ts` `POOL_CONNECTION_LIMIT=10`, `queueLimit=20`. Backfill connection budget (`admin-backfill-runner.ts:105-142`) reserves `max(3, ceil(10/2))=5` for live traffic, caps backfill at `floor((10-5-1)/2)=2` workers (≤5 connections pinned: 1 lock + 2×2), leaving ≥5 for a full `getImage` 3-way `Promise.all` fan-out. NaN-guard at `:137` prevents a frozen PQueue. Inherent topology tradeoff, well-defended. No change.

---

## VERIFIED-CLEAN (stress-checked this cycle, no action)

- **PERF-1 / AGG-R8c3-05 (home double-query):** CLOSED. `getLatestImageForOg` (`data.ts:873-887`) is `{id,title}` + `LIMIT 1`, no JOIN/GROUP BY/filesort; `getLatestImageForOgCached` exported (`:1597`); `page.tsx:93` uses it; body does one `getImagesLitePage`. The optional tag filter rides `buildImageConditions` as `IN(subquery)`, keeping the outer query a single index scan.
- **AGG-R8c3-03 (backfill orphan-on-delete race):** CLOSED. `affectedRows===0` cleanup on BOTH backfill UPDATE branches (`admin-backfill-runner.ts:573,605`); dedicated `deletedMidReencode` tally; excluded from the failures banner (`:791`). Mirrors the upload-queue cleanup guard.
- **AGG-R8-05 (SW HEAD bound):** intact, template/built parity verified (both files line 230).
- **OG photo route (`api/og/photo/[id]/route.tsx`):** per-request Satori render is amortized by `OG_SUCCESS_CACHE_CONTROL = public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400` (`:16,214`) + rate-limited (`:47`). The home `og:image` points at this route (a META tag fetched by crawlers, not every visitor — and cached). Candidate buffers are double-bounded by `OG_PHOTO_MAX_BYTES=1 MB` pre- (Content-Length) AND post-buffer reject (`og-photo-fetch.ts:57,59`), ascending-size biased toward small files. No unbounded memory.
- **Data layer:** `tagNamesAgg` shared across all 4 listing queries + `data-timeline.ts` (locked by `data-tag-names-sql.test.ts`); `getImage` parallelizes tags+prev+next via `Promise.all` (`:1048`) with dynamically-built prev/next conditions (no dead `sql FALSE` branches); `getSharedGroup` batches tags via one `inArray` (no N+1, `:1229-1236`); `getImageByShareKey` collapses image+tags into one query; search short-circuits tag/alias queries when the title query fills the limit (`:1478`) and runs the remaining two in parallel (`:1511`). Composite indexes (`schema.ts:114-119`) match the `(processed, capture_date, created_at)` sort exactly; `idx_image_tags_tag_id` covers the tag JOIN.
- **Image queue:** PQueue concurrency=1 default; per-image advisory-lock claim; conditional `WHERE processed=false` UPDATE with `affectedRows===0 → cleanup` (`:372-381`); retry/claim/lastError Maps + permanentlyFailedIds all FIFO-bounded with collect-then-delete prune; bootstrap keyset cursor; fire-and-forget caption/embedding hooks don't block the job. Quiesce uses the deadlock-free `pause→clear→onIdle` order.
- **Components:** histogram worker `terminate()` on unmount (`:526-532`) + AbortController on URL change + image handlers nulled; canvasDims dependency correct (redraw from cached data, cheap); home-client rAF-debounced `useColumnCount`, memoized `topicsMap`/`displayTags`/`estimatedCardWidth`/`scrollKey`/`initialLoadMoreCursor`, passive scroll listener, no-op-skipping `setShowBackToTop`.
- **`revalidate = 0`** on all 9 public pages is the documented freshness choice (async processing visible immediately); admin pages dynamic. Not a perf defect.

---

## Summary of findings

| ID | Severity | Conf | One-liner |
|----|----------|------|-----------|
| PERF-L1 | LOW | HIGH | SW image-cache meta is a lost-update (no CAS); cache-housekeeping only, no served-byte impact (= AGG-R8c3-10, latent). |
| PERF-L2 | LOW | MED | Bootstrap `notInArray` over ≤1000 failed IDs; happy path zero-cost; prefer `processing_error IS NULL` (restart-safe) if a large failure population appears (= AGG-R8c3-A2). |

**No CRITICAL/HIGH at any confidence.** PERF-1 (home double-query, AGG-R8c3-05) and AGG-R8c3-03 (backfill orphan race) — the two prior perf items that touched behavior/hot-path — are both CLOSED and verified at HEAD `ce0029aa`. AGG-R8c3-A1/A2/A3 + feed filesort + timeline non-sargable + single-writer all re-confirmed as unchanged documented tradeoffs. The only open items are LOW and best-effort by design.
