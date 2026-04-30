# Code Reviewer — Cycle 4 Fresh Review (2026-04-27)

**Scope:** Full codebase, all `.ts`/`.tsx` source files under `apps/web/src/`

## Findings

### C4-F01 — `searchImages` result shape omits `tag_names` (LOW, High confidence)

**File:** `apps/web/src/lib/data.ts:779-900`

`searchImages` returns a `SearchResult` type that omits `tag_names`, while all listing queries (`getImagesLite`, `getImagesLitePage`, `getAdminImagesLite`) include `tag_names: tagNamesAgg`. The search results are rendered in compact cards that don't display tags, so this is an intentional design choice. However, if the UI ever needs to show tag pills on search results, the data would not be available without a schema change.

**Impact:** Consistency gap between search and listing query result shapes. No functional bug today.

**Suggested fix:** Document the intentional omission with a comment, or add `tag_names` to `SearchResult` proactively.

### C4-F02 — `getImages` is effectively dead code (LOW, Medium confidence)

**File:** `apps/web/src/lib/data.ts:461-481`

`getImages` has the same signature as `getImagesLite` with identical query shape, but uses `LISTING_QUERY_LIMIT` (100) instead of `LISTING_QUERY_LIMIT_PLUS_ONE` (101). No caller appears to use the has-more pattern with `getImages`. All active listing call sites use `getImagesLite`, `getImagesLitePage`, or `getAdminImagesLite`. `getImages` appears to be a dead export.

Already noted in prior cycles (AGG5R-07). Confirming still dead in this cycle.

**Impact:** Dead code increases maintenance surface.

### C4-F03 — `deleteImages` revalidates paths for stale/not-found IDs (LOW, Medium confidence)

**File:** `apps/web/src/app/actions/images.ts:647-655`

When `foundIds.length <= 20`, the code calls `revalidateLocalizedPaths` with paths derived from `foundIds`, but `foundIds` may include IDs whose DB rows were not actually deleted (the `deletedRows` may be less than `foundIds.length`). This causes unnecessary ISR revalidations for stale paths. Already noted in prior cycles (AGG5R-16). Confirming still present.

**Impact:** Minor ISR cache thrash. No user-visible impact.

## Verified Controls

All previously verified controls remain intact. No regressions found in code quality.
