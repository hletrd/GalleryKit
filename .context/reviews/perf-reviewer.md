# Performance & Concurrency Review — GalleryKit

**Reviewer:** perf-reviewer specialist
**Run/Cycle:** Run 6 / Cycle 4 (review-plan-fix loop)
**HEAD:** f8147868
**Date:** 2026-06-16
**Prior-cycle baseline:** b1e9e0da (cycle-3 perf review)
**Scope:** CPU/memory/I/O hotspots, DB query shapes, N+1, connection-pool & async-queue concurrency, Sharp pipeline throughput, UI responsiveness (re-render / layout-thrash / INP / CLS / LCP), service-worker cache, shared-state hazards, unbounded growth (Maps, caches, in-memory buffers).

## Verdict

**Honest convergence — ZERO new performance findings this cycle.**

The cycle-3 → cycle-4 delta (`b1e9e0da..f8147868`, 10 commits) is small and contains **no perf-relevant logic change to any hot path**. Every change is doc-only, a CSS geometry fix, a color-token swap, an exit-code/observability addition, test-isolation plumbing, or a bundle-positive import repoint. All previously-closed perf items remain closed; all deferred perf items remain factually accurate at HEAD and are correctly deferred. No CRITICAL/HIGH/MEDIUM/LOW new defect.

Confidence labels reflect how certain the impact scenario is, not severity.

---

## Severity Summary

| Severity | New this cycle | IDs |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 0 | — |
| LOW | 0 | — |

---

## Cycle-3 → cycle-4 delta: per-file perf assessment (b1e9e0da..f8147868)

Verified every source file in the diff. None regresses performance:

| File | Change | Perf verdict |
|---|---|---|
| `components/ui/switch.tsx` | Pure CSS restructure (a3b8c557): added a nested `aria-hidden` `<span>` visible-track wrapper; thumb travel switched from fixed `translate-x-5` to width-relative `translate-x-full`. | **Neutral.** No new React state, no new effect, no new handler. Both versions re-render identically on toggle (Radix `data-state` flip). One extra static DOM node per Switch — negligible. Re-render shape unchanged. |
| `components/histogram.tsx` | Color class swap (60c54346): `text-red-500` → `text-destructive-text` on two clip-warning spans. | **Neutral.** CSS class only; zero compute/render-path impact. |
| `lib/color-detection.ts` + `app/actions/images.ts` | Dropped the `WIDE_GAMUT_PRIMARIES`/`isWideGamutPrimary` re-export (0ef29a10); `actions/images.ts` repointed to import `isWideGamutPrimary` from the client-safe `lib/color-primaries` leaf. | **Bundle-positive.** Removes a layering path by which the fs/sharp-heavy `color-detection` module could be reached from the client-safe predicate. Reduces accidental-import surface; no runtime cost. |
| `scripts/backfill-color-pipeline.ts` | Added a `detectionFailures` integer counter + 2 log lines + exit-code condition (a033056d). | **Neutral.** Counter increments only on the detection-failure branch (already a slow/rare path); the WARN line is post-loop. No hot-loop cost. |
| `lib/process-topic-image.ts` | Added `TOPIC_RESOURCES_ROOT` env override at module-eval (06a3c5e7). | **Neutral.** One `process.env` read inside the memoized IIFE; production leaves it unset (cwd-derived path unchanged). Zero runtime cost. |
| `lib/serve-upload.ts` | Comment-only de-enumeration of the COLOR_IMPACTING_KEYS list (f603cd3f). | **Neutral.** No code change. |
| `lib/settings-hash.ts`, `CLAUDE.md`, `__tests__/*`, `plan/*`, `.context/reviews/*` | Docstring / test / plan / review-artifact edits. | **Neutral.** Non-shipping or comment surfaces. |

**Hot-path files unchanged (byte-identical to the b1e9e0da review — `git diff --stat` empty):** `lib/data.ts`, `lib/image-queue.ts`, `public/sw.js`, `lib/sw-cache.ts`, `db/schema.ts`, `lib/admin-backfill-runner.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/analytics-data.ts`, `components/home-client.tsx`, `components/photo-navigation.tsx`, `components/image-zoom.tsx`, `components/load-more.tsx`, `db/index.ts`.

---

## Closed perf items — re-confirmed still closed at HEAD f8147868

(Carried from prior cycles; no regression introduced by this cycle's delta.)

- **PERF-01 (was HIGH) — SW LRU full re-sort per cache write.** CLOSED (`7119345a`). `recordAndEvict` is delete-then-set + head-walk eviction; no `Array.from(...).sort()`. `public/sw.js` unchanged this cycle.
- **PERF-03 (was HIGH) — `getMapImages()` unbounded result.** CLOSED (`3b69c877`). `MAP_MAX_MARKERS = 10000` + deterministic `.orderBy(...).limit(...)`. `data.ts` unchanged this cycle.
- **Serve-upload FD leak on client abort** — CLOSED (`dd26e742`). `serve-upload.ts` logic unchanged (comment-only edit this cycle).
- **Analytics `*_views` retention sweep** — CLOSED (`3f6ae0f7`). Chunked bounded DELETE on the hourly GC.
- **WebP ICC 1 KB read** — CLOSED (`2784d244`).

---

## Deferred perf items — reasoning re-verified accurate at HEAD (NOT re-reported)

Per the closed/deferred ledger (`_aggregate.md` + `plan-353-run6-cycle3-deferred.md`). Each line anchor confirmed present and unchanged at HEAD; deferral reasoning remains factually correct. These are NOT new findings — listed only to document that the deferral basis still holds:

- **AGG-C3-10 / PERF-C3-01 (LOW-MED, Medium)** — `process-image.ts:1019-1022`: unconditional `sharp().metadata()` header decode whose `basePixels` result is consumed only by the `isWideGamutSource && basePixels > cap` wide-gamut downscale gate, so it is discarded for sRGB sources. **Confirmed unchanged at HEAD.** The source comment at `:1007-1013` independently documents the ~10-30 ms cost as an accepted personal-gallery-scale tradeoff (avoids a cross-caller signature refactor through `saveOriginalAndGetMetadata`). Deferral valid: pure backfill-time CPU micro-opt, zero correctness change, regression risk on the hot encode path warrants its own focused change. Exit criterion (gate the read behind `isWideGamutSource`) unchanged.
- **AGG-C3-11 / PERF-C3-03 (LOW, Medium)** — `data.ts:915-937` `getAdminImagesLite` OFFSET pagination (page-clamped 1000). **Confirmed unchanged.** Admin-only, bounded; public list already uses keyset cursors. Deferral valid.
- **AGG-C3-12 / PERF-C3-02 (LOW, Medium)** — `sw.js:233-240` synchronous per-tile HEAD ETag probe on the warm-cache path, bounded by the 300 ms `HEAD_REVALIDATE_TIMEOUT_MS` abort. **Confirmed unchanged.** Deliberate color-freshness guarantee (backfill rewrites bytes under unchanged filenames). Deferral valid; exit criterion (age-floor / `effectiveType` gate if slow-network INP regresses) unchanged.
- **AGG-C3-13 (LOW batch, Medium)** — `getImagesForFeed` `ORDER BY updated_at` filesort (`data.ts:771-794`); `getFailedImages` unindexed + unLIMITed (`data.ts:940-954`); `getTopics` correlated `MAX(updated_at)` subquery + `ORDER BY order` on unindexed column (`data.ts:452-473`); touch-swipe `setSwipeOffset` per-touchmove re-render (`photo-navigation.tsx:93`); wheel-handler `getBoundingClientRect` read-then-transform-write thrash (`image-zoom.tsx:103,110`). **All anchors confirmed present/unchanged.** Low-frequency or admin-only surfaces; deferral valid per-item.

---

## Verified correct and well-built (spot-re-checked this cycle)

- **Sharp pipeline (`process-image.ts`)** — `sharp.cache(false)`, bounded `sharp.concurrency`, file-path mmap inputs, `sequentialRead:true`, >50 MP wide-gamut downscale-to-TIFF before rgb16 fan-out (`:1022-1042`, confirmed at HEAD), 10-bit AVIF Promise-singleton libheif probe. The per-format/per-size fresh `sharp()` decode is the documented WI-14/R8-R8 correctness tradeoff. No regression from this cycle's color-token / import changes.
- **Masonry (`home-client.tsx`)** — pure CSS multi-column (no JS packer), rAF-debounced resize (`:47-60`), column-count thresholds mirror Tailwind breakpoints for LCP-correct eager-loading. Unchanged.
- **Image queue, rate-limit, analytics, React data layer, view-count buffer** — all bounded-Map / keyset-cursor / fire-and-forget hygiene as documented in the cycle-3 review; files byte-identical at HEAD.

---

## CLIP note (per review HARD GUARD)

The `image_embeddings` write hook (`image-queue.ts:434-478`) and similar/semantic linear-scan routes remain default-`disabled`. Reviewed for perf shape only. **NOT proposing activation.** The latent ≤5000-vector synchronous-decode + cosine-on-event-loop profile (no ANN index) is unchanged and out of scope to fix this cycle; it should be addressed before any future enablement.

---

## Files examined this cycle

Delta diff (full): `components/ui/switch.tsx`, `components/histogram.tsx`, `lib/color-detection.ts`, `app/actions/images.ts`, `lib/serve-upload.ts`, `lib/process-topic-image.ts`, `scripts/backfill-color-pipeline.ts`, `lib/settings-hash.ts`.
Hot-path re-confirmation (targeted): `lib/process-image.ts:1000-1059`, `components/home-client.tsx:1-75`, `lib/data.ts` deferred anchors (771/915/940/452), `public/sw.js:233-240`.
Delta verification: `git diff --stat b1e9e0da..f8147868` confirming `data.ts`/`image-queue.ts`/`sw.js`/`schema.ts`/`admin-backfill-runner.ts` unchanged.

## Top line

Zero new perf findings. Cycle-3→4 delta is perf-neutral or perf-positive (bundle import repoint). All closed perf items stay closed; all deferred perf items stay accurately deferred at HEAD f8147868.
