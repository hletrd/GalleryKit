# Performance Review — Cycle 9/100 (review-plan-fix)

**Reviewer:** perf-reviewer (fresh independent pass — NOT trusting the prior cycle-8 carryover; every surface re-read at current HEAD).
**Date:** 2026-06-14
**HEAD:** `0ce84b1b` (working tree clean)
**Verdict:** **0 NEW genuine performance findings.** Convergence holds. Reporting zero is the correct, evidence-backed outcome.

---

## What changed since the prior perf pass (HEAD `9c40d261` → `0ce84b1b`)

Four commits, **none touch a perf surface**:

| Commit | Nature | Perf impact |
|---|---|---|
| `0ce84b1b` | docs(plans): backfill Item-1 SHA in plan-345 | none (markdown) |
| `71ab0f41` | test(security): pin `generateBase56` rejection-sampling uniformity (AGG-C8-01) | none (test-only; the prod primitive was already correct) |
| `aa8a6f8a` | docs: add public route group to touch-target SCAN_ROOTS doc (AGG-C8-02) | none (CLAUDE.md) |
| `7669217b` | docs(reviews,plans): cycle-8 fan-out artifacts | none (review md + plans) |

The most recent **production** source change on any perf-critical file remains `85bca582` (`isLosslessWebpByChunk` in `process-image.ts`), already re-verified perf-clean below.

---

## Surfaces inspected this cycle (file:line evidence)

### 1. Query performance / N+1 — `data.ts` (1649 LOC) — CLEAN

- **`tagNamesAgg` GROUP_CONCAT pattern** (`data.ts:605`, used at `:734,783,833,899,923,1359`) — single shared `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` over `LEFT JOIN imageTags → LEFT JOIN tags → GROUP BY images.id`. One JOIN+aggregate per listing query, not per-row. No N+1.
- **`getImagesLite` / `getImagesLitePage` / `getAdminImagesLite` / `getImagesForSmartCollection`** (`:728,818,915,1350`) — all bounded by `LISTING_QUERY_LIMIT_PLUS_ONE`, cursor-paginated (`buildCursorCondition`), and use `COUNT(*) OVER()` window function (`:834,1360`) to return page + total in ONE round-trip rather than a second `COUNT` query. Correct keyset shape.
- **`getImage`** (`:956`) — PK lookup + `Promise.all([tags, prev, next])` (`:1048`); 3 navigation queries run in parallel, not serial. Prev/next conditions are dynamically built (`:991-1046`) to eliminate dead `FALSE` branches, keeping the generated SQL sargable against the composite indexes.
- **`getLatestImageForOg`** (`:873`, commit `e9040d17`) — verified the heavy `getImagesLite(undefined, tagSlugs, 1, 0)` OG path is GONE; only the explanatory comment at `:862` references it. The replacement selects ONLY `id, title` with no tag JOIN / no `GROUP_CONCAT` / no `GROUP BY` — a single `LIMIT 1` index scan. Real improvement, already landed.
- **`tag_concat` reshaping** (`:1162`) — splits in-memory `GROUP_CONCAT` output on `\x01` (record SEP) then `\0` (field delim); both are control chars that validation forbids in slugs/names, so collision-free. This is post-query CPU over one already-fetched row, not a loop of DB calls.
- **await-in-loop scan** — every `for` loop in `data.ts` (`:103,180,184,498,1162,1240,1536,1585`) iterates already-fetched in-memory rows (chunk flush, eviction key sweep, GROUP_CONCAT split, map-leak guard). **Zero per-iteration DB queries.** No N+1 in `data.ts` or `app/actions/*.ts`.

### 2. DB index coverage vs query patterns — CLEAN

Re-read `schema.ts:114-132`. Index ↔ query alignment confirmed:
- listing sort `(capture_date DESC, created_at DESC, id DESC)` → `idx_images_processed_capture_date (processed, capture_date, created_at)` ✓
- prev/next nav → `idx_images_processed_created_at` ✓
- topic-filtered listings → `idx_images_topic (topic, processed, capture_date, created_at)` ✓
- tag JOIN → `idx_image_tags_tag_id (tagId)` ✓
- upload dedup → `idx_images_user_filename` ✓; admin attribution → `idx_images_uploaded_by` ✓
- analytics breakdowns → `idx_image_views_bot_viewed_country` / `..._referrer` (migration 0021, commit `55458f95`) ✓

No missing index for any hot query path.

### 3. Sharp image pipeline — `process-image.ts` (1638 LOC) — CLEAN

- **Concurrency math** (`:44-53`): `sharp.concurrency(max(1, floor((cores-1)/3)))` — the per-call libvips thread cap is divided by the 3-format `Promise.all` fan-out so one image stays near `(cores-1)` total threads (won't drown libuv when `QUEUE_CONCURRENCY>1`). `sharp.cache(false)` for steady RSS (every UUID is a fresh decode, so cache only pins heap). Sound.
- **Parallel fan-out** (`:1253`): WebP/AVIF/JPEG via `Promise.all`; stat-verification also parallelized (`:1260`).
- **WI-14 fresh `sharp()` per format** (`:1110-1115`, = RC-3): intentional anti-contamination (~18 decodes/image). Documented, deliberate; not a regression.
- **rgb16 wide-gamut path** (`:1109-1115`): `pipelineColorspace('rgb16')` gated on `isWideGamutSource && !isDciP3` only — the 2× peak-RAM cost is paid only where it's needed; DCI-P3 correctly skips it to preserve source ICC for the Bradford transform.
- **Same-width dedup** (`:1078-1087`): when `processingBaseWidth < size` collapses multiple configured sizes to one resize width, the loop hard-links (`fs.link`, zero-copy) instead of re-encoding identical output. Avoids redundant encodes for small originals.
- **`clone()` reuse** (`:860,1164`): blur placeholder and the explicit 8-bit AVIF fallback reuse the decoded pipeline via `clone()` rather than re-decoding.
- **`isLosslessWebpByChunk`** (`:1498-1518`, called `:1609`, commit `85bca582`): bounded RIFF walker (`while (offset+8 <= buf.length)`, monotonic `if (next <= offset) return false`), no alloc, no decode, runs once per upload on the rare Tier-2 GPS re-encode path. Perf-clean (re-confirmed; AGG-C7-05 stays CLOSED).

### 4. Backfill runner concurrency — `admin-backfill-runner.ts` (871 LOC) — CLEAN

- **Pool-budget cap** (`:105-142`, commit `0d17a362`): `resolveBackfillConcurrency` enforces `1 + 2N <= LIMIT − RESERVED` with `RESERVED = max(3, ceil(pool/2))`. At pool=10 the cap is 2, leaving ≥5 connections (≥ one full `getImage` fan-out) for live traffic. Operators raising `ADMIN_BACKFILL_CONCURRENCY` are clamped DOWN. NaN-guarded (`:137`) so a mocked pool can't freeze PQueue. Rigorous.
- Keyset-paginated batch fetch (commit `8bc3c51b`) drains each batch through PQueue before fetching the next (`:383,624`) — bounded memory regardless of library size.

### 5. React render performance — CLEAN

- **Masonry grid** (`home-client.tsx`): CSS-native `columns-N` (`:259`) — browser does layout, no JS reflow. Resize handler (`:47-59`) is rAF-debounced AND cancels the pending frame on both re-trigger and unmount (`:48,58`) — no leaked frames, no listener leak. `useMemo` for column counts / `topicsMap` / `displayTags` / `estimatedCardWidth` / `initialLoadMoreCursor` (`:196,211,216,226`); `useCallback` for `handleLoadMore` / `saveScrollPosition` (`:121,127`).
- **Histogram worker** (`histogram.tsx`): Web Worker with **transferable** `imageData` buffer (`:165` — zero-copy `postMessage` transfer); 256×256 canvas cap (`:122-125`); worker `terminate()` on unmount (`:527-529`); per-request `AbortController` cancellation (`:536-542`). No leak, off-main-thread O(n) compute.
- **`useDisplayCapability`** — snapshot-memoized `getSnapshot` (stable reference, avoids the React #185 `useSyncExternalStore` infinite loop). Unchanged.

### 6. Service worker LRU cache — `sw-cache.ts` (166 LOC) — CLEAN

- 50 MB cap (`:19`); `recordAndEvict` (`:95`) sorts oldest-first and the eviction loop provably terminates (`total <= maxBytes` break at `:122`, `entries.delete` always advances). `evicted`/`total` only adjust when `cache.delete` returns true (`:131` — handles independent browser quota eviction). Bounded, correct. RC-1 lost-update remains best-effort by design.

### 7. Caching / revalidation — CLEAN (documented tradeoff)

`revalidate = 0` on all 9 public routes (`page.tsx`, `[topic]`, `p/[id]`, `s/[key]`, `g/[key]`, `c/[slug]`, `timeline`, `year/[year]`, `map`) is the **deliberate** freshness policy so async image processing + metadata edits are visible immediately. The SW `networkFirstHtml` offline fallback and the serve-upload ETag layer compensate for the lost HTTP caching (documented in CLAUDE.md). Not a defect.

---

## RECORD-ONLY / DEFERRED perf items — re-confirmed UNCHANGED at HEAD `0ce84b1b` (do NOT re-escalate)

All bounded or documented-intentional. Re-verified present + unchanged this cycle.

| ID | Item | Disposition |
|---|---|---|
| RC-1 | SW image-cache metadata lost-update (whole-doc overwrite, no CAS) | best-effort by design |
| RC-2 | bootstrap `inArray`/`notInArray` sweep ≤1000 IDs (`image-queue.ts`) | bounded |
| RC-3 | decode-per-format ~18/image (WI-14 fresh `sharp(inputPath,…)`, `process-image.ts:1110-1115`) | intentional anti-contamination |
| RC-4 | Atom feed filesort bounded (`getImagesForFeed`, `data.ts:771`, `limit ≤ LISTING_QUERY_LIMIT_PLUS_ONE`) | bounded |
| RC-5 | timeline non-sargable `YEAR()`/`MONTH()` | bounded |
| RC-6 | single-pool/10 single-writer topology | documented runtime topology |
| RC-7 | `getMapImages` unbounded result set (`data.ts:1565`, = PERF-R4C15-B) | deferred, documented |
| RC-8 | analytics 'all'-window temp-table (= PERF-R5C2-01) | deferred, documented |
| PERF-C7-OBS-1 | semantic-search ≤5000 512-dim vectors synchronous on event loop (stub) | bounded + default-disabled + rate-limited; single-digit-to-low-tens-ms worst case |

---

## Clean-surface highlights (accurate at HEAD `0ce84b1b`)

- Cursor/keyset pagination with `COUNT(*) OVER()` single-round-trip on every listing path.
- `getLatestImageForOg` minimal `id,title` query — heavy OG JOIN path fully removed (`e9040d17`).
- `getImage` 3-way `Promise.all` parallel navigation; dynamically-built sargable prev/next conditions.
- Sharp `cache(false)` + concurrency÷3 + same-width hard-link dedup + `clone()` reuse + streamed `.toFile()`.
- Backfill `1 + 2N <= LIMIT − RESERVED` pool-budget cap reserving ≥half the pool for live traffic.
- CSS-`columns` masonry (rAF-debounced + cancel-on-unmount resize), transferable-buffer histogram worker (terminate + AbortController), snapshot-memoized `useDisplayCapability`.
- SW LRU 50 MB cap with terminating, quota-aware eviction.
- Index coverage matches every hot query pattern, including the migration-0021 analytics breakdown indexes.

---

## Recommendation

**No new perf finding.** This is a fresh, independent re-read of all eight perf surfaces in scope (data-access queries, index coverage, Sharp pipeline, backfill concurrency, React render, SW LRU, caching/revalidation, UI responsiveness) at current HEAD — not a copy of the prior pass. The only commits since the last perf review are docs/tests with zero perf surface. Every prior RECORD-ONLY / DEFERRED item is re-confirmed bounded or intentional. The codebase remains heavily and correctly tuned; there is no code change worth making on performance grounds this cycle. **Convergence: confirmed.**
