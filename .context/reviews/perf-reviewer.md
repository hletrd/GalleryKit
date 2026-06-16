# Performance & Concurrency Review — GalleryKit

**Headline:** Honest convergence — ZERO new performance findings; cycle-4→5 delta is the 5 scheduled cycle-4 fixes (perf-neutral) + doc/plan churn; all hot-path files byte-identical to the cycle-4 baseline, independently re-verified at HEAD.

**Reviewer:** perf-reviewer specialist
**Run/Cycle:** Run 6 / Cycle 5 (review-plan-fix loop)
**HEAD:** 2f603716 (branch master, working tree CLEAN)
**Prior-cycle baseline:** f8147868 (cycle-4 perf review)
**Scope:** CPU/memory/I/O hotspots, DB query shapes, N+1, connection-pool & async-queue concurrency, Sharp pipeline throughput, UI responsiveness (re-render / layout-thrash / INP / CLS / LCP), service-worker LRU cache, shared-state hazards, unbounded growth (Maps, caches, in-memory buffers), lock contention, floating promises affecting throughput.

## Verdict

**Honest convergence — ZERO new performance findings this cycle.**

The cycle-4 → cycle-5 delta (`f8147868..2f603716`, 6 commits) contains **no perf-relevant logic change to any hot path**. The only shipping source changes are (a) two new *pure exported helpers* in the backfill sidecar (a slow, serialized, operator-triggered path — not a request path) added purely for unit-testability, plus a 2-line accounting subtraction in the already-batched flush, and (b) a comment-only edit in `switch.tsx`. Everything else is test files, plan docs, and review artifacts. All previously-closed perf items remain closed; all deferred perf items remain factually accurate at HEAD and are correctly deferred. No CRITICAL/HIGH/MEDIUM/LOW new defect.

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

## Cycle-4 → cycle-5 delta: per-file perf assessment (f8147868..2f603716)

6 commits. Verified every **shipping source** file in the diff. None regresses performance:

| File | Change | Perf verdict |
|---|---|---|
| `scripts/backfill-color-pipeline.ts` | 1fd350be: added two pure exported helpers — `countDeletedMidReencodeDetectionFailures(derivativeResults)` (O(batch) filter counting 0-affected-row UPDATEs, `:159`) and `computeBackfillExitCode({errors, detectionFailures})` (constant-time boolean, `:174`). Added a 2-line `detectionFailures -= …` accounting subtraction inside the existing `flushBatch` deleted-mid-reencode branch (`:454-455`). Repointed the `process.exit(...)` expression through the helper (`:527`). | **Neutral.** Both helpers are called exactly once per batch flush (`BATCH_SIZE = 100`, `:271`/`:455`) and once at process exit (`:527`), over already-materialized batch arrays (≤100 elements). `updateResults.slice(items.length)` is a bounded slice over a batch already in memory. This is the backfill sidecar — a deliberately concurrency-1-serialized, advisory-locked, operator-triggered path, NOT a request hot path. The added subtraction is a correctness fix (AGG-C4-04 exit-code accounting), zero throughput cost. |
| `src/components/ui/switch.tsx` | 24159f36: header docblock comment now cites `translate-x-full` instead of the never-shipped `translate-x-[calc(100%-2px)]` (AGG-C4-05 comment-vs-code drift fix). | **Neutral.** Comment-only. The 1-byte `cn()` arg list is unchanged; render shape, React state, effects, and handlers are all identical. Zero compute/render-path impact. |
| `src/__tests__/switch-geometry-contract.test.ts` (new), `src/__tests__/backfill-color-pipeline-deleted-mid-reencode.test.ts` (new), `src/__tests__/image-queue-bootstrap.test.ts` (waitFor timeout hardening, 6ab40644) | Test-only. | **Neutral.** Non-shipping. The image-queue-bootstrap change is the AGG-C4-01 flaky-wait fix (explicit `{ timeout, interval }` on `vi.waitFor`); it changes test determinism, not product code. |
| `plan/plan-354-*.md`, `plan/plan-355-*.md`, `.context/reviews/*` | Plan + review-artifact docs. | **Neutral.** Non-shipping. |

**Hot-path files confirmed byte-identical to the f8147868 review (`git diff --stat f8147868..HEAD -- <files>` empty):** `lib/data.ts`, `lib/process-image.ts`, `lib/color-detection.ts`, `lib/image-queue.ts`, `public/sw.js`, `public/sw.template.js`, `lib/sw-cache.ts`, `db/schema.ts`, `db/index.ts`, `lib/admin-backfill-runner.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/analytics-data.ts`, `lib/serve-upload.ts`, `components/home-client.tsx`, `components/photo-viewer.tsx`, `components/photo-navigation.tsx`, `components/image-zoom.tsx`, `components/histogram.tsx`, `components/load-more.tsx`.

---

## Independent HEAD re-verification (not inherited from prior cycle)

Because the hot-path surface is provably unchanged, I re-derived the three heaviest perf surfaces from current-HEAD source rather than trusting prior conclusions:

- **SW LRU (`lib/sw-cache.ts:95-149`, re-read in full at HEAD).** `recordAndEvict` is delete-then-set (`:111-112`) so the Map's insertion order tracks recency, and eviction is a single head-walk (`:129-145`) with NO `Array.from(...).sort()` — the O(n log n)-per-write cost PERF-01 flagged is gone. The `if (deleted)` guard (`:139-142`) correctly avoids overcounting `evicted`/`total` when the browser quota evicted an entry independently. The single O(n) `total` sum (`:119-122`) is inherent to the whole-blob JSON metastore model and is correctly documented as out-of-scope. **Correct.**
- **DB tag aggregation (`lib/data.ts:605` + 6 call sites).** `tagNamesAgg` is a single shared `GROUP_CONCAT(DISTINCT tags.name ORDER BY tags.name)` constant referenced by every masonry/list query (`:734, :783, :833, :899, :923, :1359`) — the JOIN-based aggregation that replaced the NULL-returning correlated-subquery shape (cycle-1 NF-3). No per-row N+1; one grouped scan per list query. **Correct.**
- **Sharp parallel fan-out (`lib/process-image.ts:1263-1319`, re-read at HEAD).** Three formats encode under one `Promise.all` (`:1265-1269`); base-file non-empty checks run under a second `Promise.all` of `fs.stat` (`:1272-1276`); the catch-path cleanup deletes only the paths written *this* invocation (`:1306-1310`, tracked in `writtenSizedPaths`); the `finally` unlinks the downscaled intermediate only when one was created (`:1313-1316`). The per-format fresh `sharp()` decode is the documented WI-14 cross-format-state-isolation correctness tradeoff, not a regression. **Correct.**

---

## Closed perf items — re-confirmed still closed at HEAD 2f603716

(Carried from prior cycles; no regression introduced by this cycle's delta.)

- **PERF-01 (was HIGH) — SW LRU full re-sort per cache write.** CLOSED (`7119345a`). Re-verified in full above. `sw-cache.ts` / `public/sw.js` byte-identical this cycle.
- **PERF-03 (was HIGH) — `getMapImages()` unbounded result.** CLOSED (`3b69c877`). `MAP_MAX_MARKERS = 10000` + deterministic `.orderBy(...).limit(...)`. `data.ts` byte-identical this cycle.
- **Serve-upload FD leak on client abort** — CLOSED (`dd26e742`). `serve-upload.ts` byte-identical this cycle.
- **Analytics `*_views` retention sweep** — CLOSED (`3f6ae0f7`). Chunked bounded DELETE on the hourly GC. `analytics-data.ts` byte-identical this cycle.
- **WebP ICC 1 KB read** — CLOSED (`2784d244`).

---

## Deferred perf items — reasoning re-verified accurate at HEAD (NOT re-reported)

Per the closed/deferred ledger (`_aggregate.md` + `plan-355-run6-cycle4-deferred.md`). Every anchor confirmed present and unchanged at HEAD (all named files byte-identical since f8147868); deferral reasoning remains factually correct. These are NOT new findings — listed only to document that the deferral basis still holds:

- **AGG-C3-10 / PERF-C3-01 (LOW-MED, Medium)** — `process-image.ts:1019-1022`: unconditional `sharp().metadata()` header decode whose `basePixels` result is consumed only by the `isWideGamutSource && basePixels > cap` wide-gamut downscale gate, so it is discarded for sRGB sources. Source comment at `:1007-1013` documents the ~10-30 ms cost as an accepted personal-gallery-scale tradeoff (avoids a cross-caller signature refactor through `saveOriginalAndGetMetadata`). Backfill-time CPU micro-opt only; deferral valid. Exit criterion (gate the read behind `isWideGamutSource`) unchanged.
- **AGG-C3-11 / PERF-C3-03 (LOW, Medium)** — `data.ts:915-937` `getAdminImagesLite` OFFSET pagination (page-clamped 1000). Admin-only, bounded; public list already uses keyset cursors. Deferral valid.
- **AGG-C3-12 / PERF-C3-02 (LOW, Medium)** — `sw.js:233-240` synchronous per-tile HEAD ETag probe on the warm-cache path, bounded by the 300 ms `HEAD_REVALIDATE_TIMEOUT_MS` abort. Deliberate color-freshness guarantee (backfill rewrites bytes under unchanged filenames). Deferral valid; exit criterion (age-floor / `effectiveType` gate if slow-network INP regresses) unchanged.
- **AGG-C3-13 (LOW batch, Medium)** — `getImagesForFeed` `ORDER BY updated_at` filesort (`data.ts:771-794`); `getFailedImages` unindexed + unLIMITed (`data.ts:940-954`); `getTopics` correlated `MAX(updated_at)` subquery + `ORDER BY order` on unindexed column (`data.ts:452-473`); touch-swipe `setSwipeOffset` per-touchmove re-render (`photo-navigation.tsx:93`); wheel-handler `getBoundingClientRect` read-then-transform-write thrash (`image-zoom.tsx:103,110`). All anchors confirmed present/unchanged (files byte-identical). Low-frequency or admin-only surfaces; deferral valid per-item.

---

## Verified correct and well-built (spot-re-checked this cycle)

- **Sharp pipeline (`process-image.ts`)** — `sharp.cache(false)`, bounded `sharp.concurrency`, file-path mmap inputs, `sequentialRead:true`, >50 MP wide-gamut downscale before rgb16 fan-out, 10-bit AVIF Promise-singleton libheif probe, per-format/per-size fresh `sharp()` (WI-14), invocation-scoped error-path + intermediate cleanup. No regression from this cycle's helper additions (those live in the sidecar `scripts/`, not the encoder).
- **Backfill sidecar (`scripts/backfill-color-pipeline.ts`)** — batched DB writes (`BATCH_SIZE = 100`), advisory-locked single-run serialization, the new exit-code/accounting helpers operate on ≤100-element in-memory batch arrays at most once per flush. Concurrency bounded by `BACKFILL_CONCURRENCY`. No hot-loop cost.
- **Masonry (`home-client.tsx`)** — pure CSS multi-column (no JS packer), rAF-debounced resize, column-count thresholds mirror Tailwind breakpoints for LCP-correct eager-loading. Byte-identical.
- **Image queue, rate-limit Maps (bounded oldest-entry eviction), analytics, React `cache()` data layer, view-count buffer** — all bounded-Map / keyset-cursor / fire-and-forget hygiene as documented; files byte-identical at HEAD.

---

## CLIP note (per review HARD GUARD)

The `image_embeddings` write hook (`image-queue.ts:434-478`) and similar/semantic linear-scan routes remain default-`disabled`. Reviewed for perf shape only. **NOT proposing activation.** The latent ≤5000-vector synchronous-decode + cosine-on-event-loop profile (no ANN index) is unchanged and out of scope to fix this cycle; it should be addressed before any future enablement.

---

## Files examined this cycle

Delta diff (full shipping source): `scripts/backfill-color-pipeline.ts` (re-read `:145-180`, `:391-527`), `src/components/ui/switch.tsx`.
Independent hot-path re-derivation at HEAD: `lib/sw-cache.ts` (full), `lib/data.ts:605` + 6 `tagNamesAgg` call sites, `lib/process-image.ts:1255-1320` (fan-out + cleanup).
Delta verification: `git diff --stat f8147868..HEAD` (confirmed `data.ts`/`process-image.ts`/`color-detection.ts`/`image-queue.ts`/`sw.js`/`sw.template.js`/`sw-cache.ts`/`schema.ts`/`db/index.ts`/`serve-upload.ts`/`analytics-data.ts`/`admin-backfill-runner.ts`/`rate-limit.ts`/`auth-rate-limit.ts`/`home-client.tsx`/`photo-*.tsx`/`image-zoom.tsx`/`histogram.tsx`/`load-more.tsx` all unchanged). New-helper call-site grep (called once-per-batch / once-at-exit, bounded).

## Top line

Zero new perf findings. Cycle-4→5 delta is perf-neutral: two pure unit-test helpers in the serialized backfill sidecar slow-path (bounded O(batch) over ≤100 in-memory elements), one comment fix, and test/doc churn. All closed perf items stay closed (SW LRU re-verified in full); all deferred perf items stay accurately deferred at HEAD 2f603716. Hot-path surface is byte-identical to the cycle-4 baseline.
