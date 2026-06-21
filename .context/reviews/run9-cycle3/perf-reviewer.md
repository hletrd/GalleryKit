# perf-reviewer — run-9 cycle-3

**HEAD:** c2d3857a
**Scope:** Performance review of the GalleryKit codebase. Converged repeatedly; since run-8 convergence (f63af3b9) the only production-source change is the cicp-recheck drain fix (e1acaff1, CR-R9C2-01); the other two run-9 changes are test-only (e67a52b7, f4a02815).

## Verdict: ZERO new actionable performance findings.

Held a HIGH bar per the anti-padding directive. Every hot path remains clean and the one production change since convergence is a correctness fix with no perf downside.

---

## 1. cicp-recheck drain change (CR-R9C2-01) — verified clean, NOT a regression

`apps/web/scripts/backfill-cicp-recheck.ts:136` changed `await queue.onEmpty()` → `await queue.onIdle()`.

- **Correct.** Per p-queue 9.1.2, `onEmpty()` resolves when `queue.size === 0` (nothing waiting) but does NOT wait for in-flight tasks (`pending` may be > 0). The per-row counters (`checked`/`flips`/`missing`/`errors`) are mutated inside the queued task body (lines 109-122), so `onEmpty()` let the final ≤`concurrency` tasks race the summary print — corrupting the diagnostic's only output.
- **No perf downside.** The added wait is bounded by the trailing ≤`concurrency` (default 2) in-flight tasks settling — negligible. This is a one-shot, manually-invoked, read-only diagnostic (lines 1-21, 19: "never writes to the DB or filesystem"), not a request hot path. Matches every sibling drain site (backfill-color-pipeline.ts:500, image-queue.ts:595/759, queue-shutdown.ts:33, admin-backfill-runner.ts:764).

## 2. Test-only run-9 changes — no production surface

`upload-tracker-state.test.ts` and `upload-processing-contract-lock.test.ts` import only vitest + the units under test. No new production query, allocation, or loop introduced.

---

## Hot-path re-sweep (all clean, fresh skeptical pass)

| Surface | File:line | Finding |
|---|---|---|
| Analytics fan-out | `app/[locale]/admin/(protected)/analytics/page.tsx:20` | All 5 queries via `Promise.all`, all `LIMIT`-bounded (20/30/25), all admin-only. Clean. |
| Analytics index utilization | `lib/analytics-data.ts:93-111,188-191` | Windowed case = covering range scan on `(bot, viewed_at, country_code/referrer_host)`; 'all' case = covering-index temp-table aggregation, bounded by view-retention GC. Tradeoff documented (PERF-R5C2-01), index-reorder deliberately EXPLAIN-deferred (plan-322 entry 3). Acceptable. |
| Timeline queries | `lib/data-timeline.ts:184-212` | `YEAR()/MONTH()` non-sargability acknowledged in-comment; only `processed=true` index prefix narrows; capped at `TIMELINE_PAGE_LIMIT` (500) + limit+1 truncation lookahead. "Acceptable at personal-gallery scale" with concrete future fix (range predicate). Clean. |
| Year-in-review grouping | `lib/data-timeline.ts:233-257` | `byMonth` Map build is O(n) over ≤500 capped rows. No O(n²). |
| Shared-group images | `lib/data.ts:1204-1249` | Capped at 100 (matches SHARE_MAX_IMAGES); tags fetched via single batched `inArray` (explicit N+1 avoidance, comment line 1223); one O(n) grouping pass. Clean. |
| Topic-by-slug | `lib/data.ts:1274-1309` | Two LIMIT-1 indexed lookups. Clean. |
| Search over-fetch | `lib/data.ts:1485-1519` | `notInArray(images.id, mainIds)` — `mainIds` bounded by `effectiveLimit` (page size). Worst-case 2×effectiveLimit rows, documented (C3-PR-01), tag+alias run in parallel. Clean. |
| Bootstrap scan | `lib/image-queue.ts:622-631` | Cursor-paginated (`gt(images.id, bootstrapCursorId)`) + per-pass cap + `notInArray(permanentlyFailedIds)`. Same family as already-deferred R7C1-CR-02; startup-only, bounded. No regression. |
| Binary parsers | `lib/gain-map-detection.ts:206,257-288`, `lib/icc-extractor.ts:62-91`, `lib/icc-chromaticity.ts:135,243` | All loops bounded: ISOBMFF walker caps (refCount `&& i < 1024`, capped tagCount/string-length), nested auxl×toItemIds loop over small sets. No unbounded allocation/growth. |
| Blocking sync I/O | (grep `*Sync` over lib/actions/api) | None outside scripts/tests. All request paths async. |

## Already-adjudicated items (NOT re-reported, confirmed still clean)

- R7C1-CR-02 [LOW] — 1000-literal NOT IN in image-queue.ts bootstrap — startup-only, no measured regression.
- masonry `tagNamesAgg` GROUP_CONCAT, `getImage` Promise.all, OG LIMIT-1, Sharp per-format fresh decode, SW 300 ms HEAD revalidate, view-retention chunked DELETE — all confirmed clean again.

---

**A truthful ZERO is the success condition here, and that is the honest result.** No micro-optimizations manufactured; no speculative findings. The codebase remains converged on the performance axis.
