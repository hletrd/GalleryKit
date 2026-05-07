# Performance review — Cycle 3 review-plan-fix loop

## Run context
- HEAD: `67655cc`
- Scope: cycle 2 fix wave (humanize chip labels, hreflang via builder, fixture seatbelt test).

## Inventory examined
- `apps/web/src/lib/photo-title.ts` — `humanizeTagLabel` is `name.replace(/_/g, ' ')`. O(n) on tag-name length, executes once per tag chip render. Tag names are short (≤ 100 chars per schema). Negligible cost.
- `apps/web/src/lib/locale-path.ts` — `buildHreflangAlternates` runs once per `generateMetadata` call; iterates `LOCALES` (length 2). Two `new URL()` constructions plus an `x-default` entry. Sub-microsecond cost vs. data-fetch latency.
- `apps/web/src/components/photo-viewer.tsx` — chip render path: `image.tags?.map((tag) => <Badge>#{humanizeTagLabel(tag.name)}</Badge>)`. Loop is O(tags), helper is O(name length). No re-render storm.
- `apps/web/src/components/info-bottom-sheet.tsx` — same pattern, only inside the expanded sheet which is conditionally rendered.
- `apps/web/src/__tests__/tag-label-consolidation.test.ts` — runs in test environment only, reads 6 small TSX/TS files via sync I/O. Doesn't affect production runtime.

## Findings

**No new MEDIUM or HIGH performance findings.**

The fix wave introduces:
- One additional function call per chip render (`humanizeTagLabel`). Negligible (≤ 1 µs per call).
- One additional helper call per page-metadata generation (`buildHreflangAlternates`). Negligible relative to DB calls / disk I/O.

No allocation churn, no extra render passes, no extra Promise.all branches.

### Existing performance characteristics verified intact

- React `cache()` wrappers for `getImage`, `getTopicBySlug`, `getTopicsWithAliases` unchanged.
- `Promise.all` parallelization in `getImage()` (tags + prev + next) unchanged.
- Image processing pipeline (Sharp parallel AVIF/WebP/JPEG, parallel size variants) untouched.
- Masonry grid's `useMemo` reorder + `requestAnimationFrame` debounced resize untouched.
- `useColumnCount` thresholds (cycle-1 fix mirroring `2xl:columns-5`) intact.

## LOW / informational

| ID | Description | Severity | Confidence |
|---|---|---|---|
| **P3L-INFO-01** | `humanizeTagLabel` allocates a new string on every chip render. For a typical photo card (≤ 5 tags), that's ≤ 5 allocations per render. A `useMemo` per `image.tags` array could collapse those allocations across re-renders, but the savings are sub-µs per render and the cleanup cost is real (memo cache, dep-array correctness). Defer indefinitely; the helper is a hot path only in pathological cases (1000s of chips on one screen). | LOW (tracking) | High |

## Quality gates

Build gate ran in background (see `_aggregate-cycle3-loop.md` for evidence). Test gate passed: 61 files / 411 tests in 7.81 s.

## Verdict

Cycle 3 fresh perf review: zero MEDIUM/HIGH, one informational tracking note. No regressions. Convergence indicated.
