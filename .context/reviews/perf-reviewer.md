# Performance / Concurrency / Memory Review — GalleryKit

**Reviewer:** perf-reviewer (code-reviewer lane)
**Date:** 2026-06-13
**HEAD:** `4c3d5924` (working tree CLEAN for source; `.context/reviews/*` tracked-dirty, untracked `plan/*` only)
**Prior perf pass base:** `1dde9b1e` (cycle 5). Cycle 6.
**Scope:** image pipeline (`process-image.ts`, `image-queue.ts`), in-app + sidecar backfill, data layer (`data.ts`, `data-timeline.ts`), DB pool + indexes (`db/schema.ts`), service worker (`sw.js` / `sw-cache.ts`), masonry/home-client/histogram/photo-viewer/`use-display-capability`, server actions + route handlers (N+1 / unbounded loops / sync I/O), OG fetch, embeddings-stub backfill.

## Verdict

**COMMENT. NET-NEW perf findings this cycle: 0. No CRITICAL/HIGH/MED/LOW perf or concurrency defects, at any confidence.**

This is a clean convergence cycle on the performance axis. I did NOT trust the prior record — I re-derived the source delta and independently re-read every hot path in scope. Conclusion stands: nothing new, nothing regressed.

---

## Source delta since base (perf-relevant = none)

The full non-test source diff `1dde9b1e..4c3d5924` under `src/lib` + `src/components` + `src/app` + `public` is **four className-only touch-target additions** (the AGG-C5-03 fix), zero behavioral/query/loop changes:

```
timeline/page.tsx:152      Link className += "inline-flex items-center min-h-11 px-2"
home-client.tsx:434        Link className += "inline-flex items-center min-h-11 px-2"
topic-empty-state.tsx:18   Link className += "inline-flex items-center min-h-11 px-2"
```
(The fourth is the timeline `year/${selectedYear}` link, same pattern.)

Everything else in `1dde9b1e..HEAD` is `.context/reviews/*`, `plan/*`, and `src/__tests__/*` (new backfill-deleted-mid-reencode test, i18n-key-parity test, image-queue delete-race wiring test, touch-target-audit `max-` self-check). **No hot path, query shape, loop, lock, or index changed.** `HEAD` advanced 5 commits past the prior base but the perf surface is byte-identical.

---

## Independently re-verified clean this cycle (read, not trusted)

### Image pipeline / concurrency
- **`image-queue.ts` per-image claim lock — CORRECT, no leak.** `acquireImageProcessingClaim` (`:193`) takes a dedicated pool connection, `GET_LOCK(?, 0)` (non-blocking), and releases the connection on BOTH failure paths (`:204`, `:208`). The processing path releases lock+connection in `finally` (`:527-528`); `releaseImageProcessingClaim` wraps `lockConnection.release()` in its own `finally` (`:217-218`). Escalating claim-retry backoff capped at 25 s (`:273`). The `retryCounts`/`claimRetryCounts`/`lastErrors` Maps are FIFO-bounded with oldest-entry eviction (`:491-493`). No connection-pool exhaustion, no lock wedge, no unbounded Map growth.
- **Sidecar `flushBatch` (`backfill-color-pipeline.ts`) + in-app runner** — the cycle-4/5 `affectedRows===0 → []`-dir-scan post-commit cleanup is intact on both paths; runs only on the delete-race branch, only after commit (cannot roll back sibling UPDATEs). Zero happy-path cost. (Now also TEST-pinned this cycle via the new `backfill-color-pipeline-deleted-mid-reencode.test.ts` — closes the prior AGG-C5-01 gap; that was a test-depth item, never a perf defect.)
- **Decode-per-format (~18/image)** — `process-image.ts` fresh `sharp()` per (format×size), `lastRendered` hard-link dedup within-format only. Unchanged WI-14 correctness tradeoff; CPU-only, background `PQueue` (default concurrency 1), libvips threads capped at `floor((cores-1)/3)`. NOT a defect.

### Data layer / queries / indexes
- **Index coverage matches CLAUDE.md exactly** (`schema.ts:114-310`): the 5 `images` composites, `image_tags(tag_id)`, the two `image_views` analytics composites, entitlements/sessions/tokens. **No new query pattern was introduced in the delta, so no missing-index risk.**
- **Server-action mutating loops are bounded, NOT N+1:**
  - `tags.ts:397-450` / `images.ts:1027-1051` (batch tag add/remove): loop is O(distinct tag NAMES), explicitly DoS-capped at 100 (`tags.ts:377`). Per name: one tag-record resolve + a SINGLE batched `imageTags` insert/delete across ALL `ids` (`ids.map(...)` at `:1035-1037`, `inArray(...)` delete at `:1048-1050`). It is O(names), never O(images×tags).
  - `images.ts:1012-1022` (apply-alt-suggested caption copy): genuinely per-row UPDATE, but deliberately so (comment `:986-988` — a bulk SET would clobber distinct suggested values) and bounded by the admin-selected image set on a manual batch action.
  - `settings.ts` / `seo.ts` per-key delete loops: bounded by the fixed `GALLERY_SETTING_KEYS` / SEO key set (single-digit count), admin-only.
- **`embeddings.ts:79-108` backfill** — STUB feature (US-P51, `embedImageStub`), correctly double-batched with bounded concurrency; `notExists` correlated subquery bounded by `SEMANTIC_SCAN_LIMIT`. Not in product surface.
- **`og-photo-fetch.ts:81-84`** — sequential `await` in a loop is CORRECT here: returns on first success (`if (buffer) return`), so happy path = one fetch; tries smallest size first. All-miss cold case bounded by ≤8 configured sizes. Not a defect.

### UI responsiveness
- **`home-client.tsx` masonry — CSS-multicolumn (`columns-{n}` at `:259`), zero JS reorder/layout cost.** `useColumnCount` rAF-debounces resize (`:49`); `estimatedCardWidth`/`topicsMap`/`displayTags`/`initialLoadMoreCursor` all `useMemo`'d; `handleLoadMore`/`saveScrollPosition` `useCallback`'d; above-fold priority gating (`:269`). Load-more append grows `allImages` but is the documented pagination-bounded, native-lazy-image posture (no virtualization by design). No re-render storm, no regression.
- **`use-display-capability.ts` — React #185-safe.** `_cachedSnapshot` returned by reference when `{colorGamut,isHdr}` unchanged (`:73-81`), so `useSyncExternalStore`'s `Object.is` is stable → no infinite loop. Subscribe cleans up all MQ + focus/visibility handlers (`:112`).
- **Zero synchronous `fs` calls** (`readFileSync`/`statSync`/`existsSync`/...) on any request path under `src/lib` or `src/app`.

---

## RECORD-ONLY documented tradeoffs (re-verified unchanged — NOT defects, NOT regressed)

Carried forward from AGG-C5-R5; all byte-identical at HEAD:

| ID | Mechanism | Why bounded / intentional |
|----|-----------|---------------------------|
| **PERF-L1** (AGG-C4-08) | SW image-cache meta `getMeta→mutate→setMeta` lost-update over one `/__meta__` doc, no CAS. Concurrent warm-paint tile writes can drift `total` LOW. | Cache-housekeeping ONLY; no served-byte/correctness/crash impact. Browser quota is the real backstop; 50 MB is a soft hint. Re-open only if a hard cap is required. |
| **PERF-L2** | Bootstrap `notInArray` inlines ≤1000 `permanentlyFailedIds` literals per pass. | Happy path (empty set) skips the clause — zero cost. FIFO-capped at 1000. Restart-safe alt (`processing_error IS NULL`) noted. |
| decode-per-format | ~18 decodes/image | WI-14 shared-state-contamination fix; CPU-only background queue. |
| Atom feed filesort | `getImagesForFeed` orders by `updated_at DESC` w/o composite | Bounded by `safeLimit ≤101` + route cache + low-traffic syndication. |
| timeline non-sargable `YEAR()/MONTH()` | `data-timeline.ts` on-this-day / timeline | LIMIT 6 / 501; self-documented re-open criterion (range predicate). |
| `getTimelineYears` distinct-year scan | `data-timeline.ts:127` no LIMIT | Pre-dates this loop; bounded by `processed` index prefix; tiny output cardinality. |
| single-pool/10 + single-writer | `db/index.ts`; backfill budget caps at 2 workers, reserves ≥5 for live | Inherent single-web-instance topology; well-defended; NaN-guard. |

---

## Summary

**No new actionable performance or concurrency findings — expected at convergence.** The source delta is className-only. Every documented-intentional tradeoff is unchanged and remains correctly classified. The one item that changed status this cycle (sidecar `flushBatch` cleanup) gained TEST coverage, not a perf change — and was never a perf defect (the mechanism was already correct). Performance posture remains unusually well-tuned.
