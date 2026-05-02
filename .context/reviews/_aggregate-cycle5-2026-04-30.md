# Aggregate Review — Cycle 5 (2026-04-30)

## Review method

Direct deep review of all key source files by a single agent. Focus areas:
data.ts (getImage prev/next navigation), buildCursorCondition parity,
sort-order logic consistency, and verification of prior-cycle fixes.

## Findings (sorted by severity)

### HIGH severity

#### C5F-01: Photo navigation prev/next broken at dated/undated boundary

- **Source**: Direct code review of `apps/web/src/lib/data.ts:752-786`
- **Location**: `getImage()` function, prev/next condition builders
- **Issue**: The sort order is `capture_date DESC NULLS LAST, created_at DESC, id DESC`.
  For the **prev** query (ASC order), undated rows (NULL capture_date) sort LAST
  (they are at the "end" of the ASC list), so a dated image's predecessor CAN be
  an undated row. However, `isNull(images.capture_date)` is pushed into
  `prevConditions` at line 758 — this means it's OR'd with the other prev
  conditions, which is correct in intent but SEMANTICALLY WRONG because the
  prev query uses `orderBy(asc(images.capture_date))`. MySQL sorts NULL last in
  ASC, so `isNull(images.capture_date)` in an OR with `gt(images.capture_date, ...)`
  will match ALL undated rows regardless of created_at, returning a potentially
  wrong predecessor.

  More critically, for the **next** query (DESC order), undated rows sort FIRST
  (NULL sorts last in DESC = first in the "after" direction). A dated image's
  successor CAN be an undated row, but `isNull(images.capture_date)` is entirely
  absent from `nextConditions` for dated images (lines 763-767). This means the
  next query for a dated image will never find an undated successor, creating a
  dead-end in gallery navigation when the next photo in sort order is undated.

  Compare with `buildCursorCondition` (lines 541-559) which correctly handles
  this: for dated cursors it includes `isNull(images.capture_date)` in the OR
  condition alongside `lt(images.capture_date, ...)` (line 554), which correctly
  captures the "undated rows sort after all dated rows in DESC" semantic.

- **Fix**: Move `isNull(images.capture_date)` from `prevConditions` to `nextConditions`
  for dated images, and add proper undated-row conditions with created_at/id
  guards to both prevConditions and nextConditions to match the sort semantics.
  For undated images (else branch), add conditions that can match dated rows
  above them in the sort order.
- **Confidence**: High

### MEDIUM severity

#### C5F-02: Duplicate sort-order logic between getImage and buildCursorCondition

- **Source**: Code review of `apps/web/src/lib/data.ts:541-559` vs `752-786`
- **Location**: `buildCursorCondition()` and `getImage()` inline conditions
- **Issue**: The sort-order semantics (`capture_date DESC NULLS LAST, created_at DESC, id DESC`)
  are encoded twice: once in `buildCursorCondition` for cursor-based pagination,
  and once inline in `getImage` for prev/next navigation. These two implementations
  have already diverged (the bug above proves it). Any future sort-order change
  must be applied to both, with no compile-time guarantee they stay in sync.
- **Fix**: Extract a shared helper that builds WHERE conditions for "rows before/after
  a given cursor point" given the sort order, and use it in both places. This
  eliminates the drift risk.
- **Confidence**: Medium (refactoring risk vs. drift risk tradeoff)

### LOW severity

#### C5F-03: getImage SELECT missing LIMIT 1

- **Source**: Code review of `apps/web/src/lib/data.ts:722-734`
- **Location**: `getImage()` initial query
- **Issue**: The main image query selects by `eq(images.id, id)` (primary key) but
  does not specify `.limit(1)`. Since `id` is the primary key, the query can only
  return 0 or 1 rows. However, adding `.limit(1)` would be defense-in-depth and
  makes the intent explicit. The prev/next queries at lines 798-819 correctly
  use `.limit(1)`.
- **Fix**: Add `.limit(1)` to the main image query.
- **Confidence**: High (cosmetic, no behavioral impact)

## Previously fixed findings (confirmed still intact)

- C1-HIGH-01: Login rate-limit rollback — FIXED
- C1-HIGH-02: Image queue infinite re-enqueue — FIXED
- C2-MED-02: loadMoreImages structured error — FIXED
- C18-MED-01: searchImagesAction structured error — FIXED
- C18-LOW-01: UNICODE_FORMAT_CHARS \uXXXX escapes — FIXED
- C4 fixes: gallery adjacency and metadata bounds — FIXED
- C4 fixes: share rate limit — FIXED
- C4 fixes: variant dedup hardlink — FIXED
- C4 fixes: search ORDER BY — FIXED
- C4 fixes: getImageByShareKey blur+topic — FIXED

## Deferred items (no change from prior cycles)

All items from plan-355-deferred-cycle4.md remain valid and deferred:
- D1-MED: No CSP header on API route responses
- D1-MED: getImage parallel queries / UNION optimization
- D2-MED: data.ts approaching 1500-line threshold
- D1-MED: CSV streaming
- D2-MED: auth patterns inconsistency
- D3-MED: data.ts god module
- D4-MED: CSP unsafe-inline
- D5-MED: getClientIp "unknown" without TRUST_PROXY
- D6-MED: restore temp file predictability
- D7-LOW: process-local state
- D8-LOW: orphaned files
- D9-LOW: env var docs
- D10-LOW: oversized functions
- D11-LOW: lightbox auto-hide UX
- D12-LOW: photo viewer layout shift
- D1-LOW: BoundedMap.prune() iteration delete
