# Performance / Concurrency / Memory Review — GalleryKit

**Reviewer:** perf-reviewer (code-reviewer lane)
**Date:** 2026-06-13
**HEAD:** `1dde9b1e` (working tree CLEAN for source; `.context/reviews/*` + untracked `plan/*` dirty only)
**Prior perf pass HEAD:** `ce0029aa` (cycle 4). All 6 gates re-confirmed GREEN this pass: `lint` exit 0, `typecheck` (app + scripts) exit 0.
**Scope:** image pipeline (`process-image.ts`, `image-queue.ts`), in-app + sidecar backfill, data layer (`data.ts`, `data-timeline.ts`), DB pool + indexes (`db/schema.ts`), service worker (`sw.js`), masonry/home-client/histogram/image-zoom components, heavy routes (home SSR + OG), Atom feed, timeline/analytics queries.

## Verdict

**COMMENT.** **No CRITICAL or HIGH performance defects at any confidence. NET-NEW perf findings this cycle: 0.**

This is an honest convergence cycle on the performance axis. The full source delta from the prior perf HEAD (`ce0029aa..1dde9b1e`) is exactly the 7 scheduled fixes from the cycle-4 aggregate (AGG-C4-01..07) — touch-target regex, sales a11y contrast, two delete-race orphan-cleanup fixes, one backfill test, and doc/comment honesty. I verified the precise source diff:

```
git diff --stat ce0029aa..HEAD -- src/lib src/components src/app public
  p/[id]/page.tsx          +11   (comment-honesty only — AGG-C4-07)
  (public)/page.tsx        +10/-3 (og:image comment-honesty only — AGG-C4-07)
  sales/sales-client.tsx   +8/-2  (LIGHT-mode color tokens — AGG-C4-03; admin surface, no perf)
  image-queue.ts           +16/-4 (delete-race cleanup arg [] — AGG-C4-04; COLD path)
```

**None of the four touches the happy path.** The two behavioral changes are both on cold (delete-during-processing) branches and are strictly *more correct* at no steady-state cost (analysis below). Everything the prior pass recorded as a documented-intentional tradeoff is re-verified unchanged at current line numbers. The two prior LOW findings (PERF-L1 SW lost-update, PERF-L2 bootstrap `notInArray`) are byte-for-byte identical and remain LOW/record-only.

The codebase remains unusually well-tuned: libvips threads divided by the 3-way fan-out (`maxConcurrency = floor((cores-1)/3)`), `sharp.cache(false)`, React `cache()` SSR dedup on every `*Cached` accessor (now 10), keyset pagination with shared `tagNamesAgg`, `COUNT(*) OVER()` window count, batched-keyset backfill (O(batch) residency), worker-driven histogram (`terminate()` on unmount + `AbortController` + 256px cap), fully ref-based zoom (no setState on mousemove), rAF-debounced masonry resize, snapshot-memoized `useDisplayCapability` (React #185 guarded), CSS-multicolumn masonry (zero JS reorder/layout cost), and the AGG-R8-05 bounded SW HEAD probe.

---

## Behavioral-change analysis (the two cold-path fixes — confirmed zero happy-path cost)

### `image-queue.ts:382-388` — delete-race cleanup now passes `[]` (dir scan)
The 2-arg `deleteImageVariants(dir, fn)` defaulted `sizes` to `DEFAULT_OUTPUT_SIZES`; the 3-arg `[]` form triggers the directory-scan branch (`process-image.ts`, scan runs only when `sizes.length === 0`). This executes **only** on the `updateResult.affectedRows === 0` branch — i.e. the image row was deleted between enqueue and the post-encode conditional UPDATE. On the happy path (row still present) the branch is never entered. The added cost on the rare race is one `readdir` per format directory (3 total) instead of N targeted `unlink`s — negligible, and the only correct way to catch non-default-size derivatives. **No steady-state cost; strict correctness gain.** UUID filenames make the per-directory scan's prefix match (`{name}_{size}{ext}`) collision-free across images.

### `scripts/backfill-color-pipeline.ts:340-396` — sidecar `flushBatch` now captures `affectedRows` + post-commit cleanup
Verified the transaction loop was **already** per-row `await tx.execute(...)` before this fix (`git show 300009d4`); the diff only adds `const [res] =` destructuring + an `affectedRows === 0` push into `deletedMidReencodeFiles`. **No new DB round-trips.** The filesystem cleanup `Promise.all(...cleanupDeletedMidReencode)` runs only when `deletedMidReencodeFiles.length > 0` (delete-race only) and — correctly — only AFTER the transaction commits, so a best-effort unlink error can never roll back legitimate sibling-row UPDATEs in the same batch. The `processed`/`deletedMidReencode` tally arithmetic is O(batch) integer work. **Zero happy-path overhead; closes the production-path orphan leak the in-app runner already fixed.**

---

## Re-verified at current HEAD (CLOSED items from prior perf pass — re-checked, not trusted)

- **AGG-R8c3-05 / PERF-1 (home double heavy query) — STILL CLOSED.** `getLatestImageForOg` (`data.ts:873-887`) selects ONLY `{ id, title }`, orders by the `(processed, capture_date, created_at)` composite, `LIMIT 1` — NO `LEFT JOIN imageTags + tags`, NO `GROUP_CONCAT`, NO `GROUP BY`. `getLatestImageForOgCached` exported at `data.ts:1597`. The `(public)/page.tsx` diff this cycle is a comment correction ONLY — the `getLatestImageForOgCached` call site and the single body-path `getImagesLitePage` are untouched.
- **AGG-R8c3-03 (backfill orphan-on-delete race) — STILL CLOSED + now extended.** In-app runner guards both UPDATE branches; the upload queue (`image-queue.ts:374`) and the sidecar (this cycle) now share the `affectedRows===0 → dir-scan cleanup` contract. The three writers are now consistent on the cleanup invariant (the AGG-C4-R1 triplication is a maintainability concern, not a perf one).
- **AGG-R8-05 (SW HEAD bound):** `sw.js:230` `signal: AbortSignal.timeout(HEAD_REVALIDATE_TIMEOUT_MS=300)` intact; on abort the `catch` falls through to `startRevalidate(); return cached`.

---

## RECORD-ONLY / RE-VERIFIED documented tradeoffs (NOT defects — all unchanged)

| ID | File:line (current) | Mechanism | Why bounded / intentional |
|----|--------------------|-----------|---------------------------|
| **PERF-L1** (= AGG-R8c3-10 / AGG-C4-08) | `public/sw.js` `recordAndEvict` :95-122, `touchMeta` :152-161, `getMeta`/`setMeta` :70-91 | SW image-cache meta is a `getMeta→mutate→setMeta` lost-update over one `/__meta__` JSON doc, no CAS/single-flight. N concurrent tile writes on a warm paint clobber each other's size bookkeeping → tracked `total` can drift LOW (LRU under-counts; IMAGE_CACHE may exceed 50 MB soft cap until browser quota eviction). | **Cache-housekeeping ONLY — no served-byte / correctness / crash impact.** Browser quota is the real backstop; 50 MB is a soft hint. Documented best-effort cache posture. Byte-identical to prior cycle. Re-open only if a hard cap is required (needs `build-sw.ts` re-stamp + `sw-template-contract.test.ts` update). |
| **PERF-L2** (= AGG-R8c3-A2) | `image-queue.ts:601-603` | Bootstrap `SELECT … WHERE processed=false AND id>cursor AND id NOT IN (…≤1000 ids…)` inlines up to 1000 literals into a `notInArray` anti-join per bootstrap pass when `permanentlyFailedIds` is non-empty. In-memory set lost on restart → re-enqueues failed rows once until they re-fail `MAX_RETRIES`. | **Happy path (empty set) skips the clause entirely (`:601` guard) — zero cost.** FIFO-capped at `MAX_PERMANENTLY_FAILED_IDS=1000` keeps it bounded. Restart-safe alternative (`AND processing_error IS NULL`, already persisted on permanent failure) noted for if a large failure population appears. Unchanged. |
| Decode-once-per-format (~18 decodes/image) | `process-image.ts:1109-1115` | `generateForFormat` opens a fresh `sharp(processingInputPath, …)` per (format × size); `lastRendered` hard-link dedup (:1078-1087) only avoids re-encode of identical resize widths WITHIN one format, never cross-format decode reuse. | Deliberate **WI-14 / R8-R8** "fresh instance per format eliminates shared-state contamination" decision. CPU-only, background `PQueue` (`QUEUE_CONCURRENCY=1` default), libvips threads capped at `floor((cores-1)/3)`. Unchanged. |
| Atom feed `updated_at` filesort | `data.ts` `getImagesForFeed` (orders by `updated_at DESC, created_at DESC, id DESC`) | No `(processed, updated_at)` composite index → filesort. | Bounded by `safeLimit ≤ LISTING_QUERY_LIMIT_PLUS_ONE` (≤101) + route cache + low-traffic syndication. Sub-ms at gallery scale. Unchanged. |
| Timeline non-sargable `YEAR()/MONTH()/DAY()` | `data-timeline.ts:108-109` (on-this-day), `:188-191` (timeline) | Function predicates evaluate per-row within the `processed=true` index prefix; only the prefix narrows the scan. | `getOnThisDayImages` LIMIT 6; `getTimelineImages` LIMIT 501. Self-documented re-open criterion (range predicate) at `:176-182`. Acceptable at personal-gallery scale. Unchanged. |
| `getTimelineYears` distinct-year full scan | `data-timeline.ts:127-144` | `selectDistinct YEAR(capture_date)` over `processed=true AND capture_date IS NOT NULL`, no LIMIT. | Pre-existing (commit `954e8bde`, predates this loop — NOT a regression). Output cardinality = number of distinct years (tiny); scan bounded by the `processed` index prefix. Year scrubber is a low-frequency surface. Record-only. |
| `OnThisDayWidget` third home-render query | `on-this-day-widget.tsx` inline on `page.tsx:219` | Server component fires `getOnThisDayImages(month, day)` on every home SSR. | Legitimately DISTINCT dataset (today's anniversary photos, not latest 30) — NOT redundant with the OG/listing queries; bounded (LIMIT 6); not `cache()`-wrapped because args change daily. Necessary, bounded work. Unchanged. |
| Single-pool / single-writer topology | `db/index.ts` `POOL_CONNECTION_LIMIT=10`, `queueLimit=20`; backfill budget `admin-backfill-runner.ts` | Backfill reserves `max(3, ceil(10/2))=5` for live traffic, caps backfill at `floor((10-5-1)/2)=2` workers (≤5 connections pinned), leaving ≥5 for a `getImage` 3-way fan-out. NaN-guard prevents a frozen PQueue. | Inherent single-web-instance topology tradeoff, well-defended. Documented in CLAUDE.md. Unchanged. |

---

## VERIFIED-CLEAN (stress-checked this cycle, no action)

- **Composite indexes unchanged** (`schema.ts:114-118`): `(processed, capture_date, created_at)`, `(processed, created_at)`, `(topic, processed, capture_date, created_at)`, `(user_filename)`, `(uploaded_by)`; `idx_image_tags_tag_id` (:132) covers the tag JOIN; analytics indexes `image_views(bot, viewed_at, country_code|referrer_host)` (:232-233) intact. They match the documented sort patterns exactly.
- **Data layer:** `tagNamesAgg` shared across all 4 listing queries (`data.ts:734,783,833,899,923,1359`) + both timeline queries (locked by `data-tag-names-sql.test.ts`); `getImage` parallelizes tags+prev+next via `Promise.all` (`:1048`); search short-circuits + parallelizes (`:1513`). `getLatestImageForOg` is the lean LIMIT-1 outlier-fixer. No N+1 introduced.
- **Sharp pipeline:** `lastRendered` hard-link dedup (`:1078-1087`) zero-copy on same FS with copyFile fallback; 10-bit AVIF gated on the Promise-singleton libheif probe with per-image 8-bit fallback (`:1140-1176`, `.clone()` + explicit `bitdepth:8`); rgb16 only on the wide-gamut non-DCI-P3 path (`:1109`, doubles peak RAM only there); 50 MP cap before fan-out. Memory lifecycle sound.
- **Components:** histogram worker `terminate()` on unmount (`histogram.tsx:529`) + `AbortController` (`:537`, abort `:572`) + StrictMode-safe worker lifecycle; image-zoom fully ref-based (positionRef/zoomLevelRef/isDraggingRef — no setState on mousemove, `image-zoom.tsx:17-39`); home-client memoizes `topicsMap`/`displayTags`/`estimatedCardWidth`/`scrollKey`/`initialLoadMoreCursor` + rAF-debounced `useColumnCount` (`:49,196,211,216,226`); masonry is CSS multicolumn (`columns-1 … 2xl:columns-5`) — browser-native layout, no JS reorder cost.
- **SW:** `recordAndEvict` adjusts `total` only when `imageCache.delete` actually removed an entry (`:114` — quota-eviction-safe); `staleWhileRevalidateImage` lazy single-flight revalidate (`:179-194`) so the 304 path short-circuits the body GET (R4C9 PERF-R4C9-02); string cache keys throughout (C18-MED-01). `networkFirstHtml` bounded (50-entry cap, 24 h TTL, admin-excluded).
- **`revalidate = 0`** on public pages is the documented freshness choice (async processing visible immediately), not a perf defect.

---

## Summary of findings

| ID | Severity | Conf | One-liner |
|----|----------|------|-----------|
| PERF-L1 | LOW | HIGH | SW image-cache meta lost-update (no CAS); cache-housekeeping only, no served-byte impact. UNCHANGED (= AGG-R8c3-10 / AGG-C4-08). |
| PERF-L2 | LOW | MED | Bootstrap `notInArray` over ≤1000 failed IDs; happy path zero-cost; prefer `processing_error IS NULL` if a large failure population appears. UNCHANGED (= AGG-R8c3-A2). |

Both are RECORD-ONLY / pre-existing. Neither is new, neither regressed.

**NET-NEW PERF FINDINGS THIS CYCLE: 0**
