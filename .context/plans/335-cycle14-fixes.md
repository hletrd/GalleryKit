# Plan 335 — Cycle 14 Fixes

**Created:** 2026-04-30 (Cycle 14)
**Status:** In Progress

## Scope

Fix actionable findings from the cycle 14 review (`_aggregate-c14-rpf.md`).

---

## C14-MED-01: `getImageByShareKey` — collapse image + tags into single query

**File**: `apps/web/src/lib/data.ts:868-908`
**Severity**: MEDIUM
**Confidence**: Medium

### Problem
`getImageByShareKey` fetches the image row first, then tags in a separate
sequential query. This means `/s/[key]` page loads take 2 DB round-trips when
1 would suffice using a LEFT JOIN + GROUP_CONCAT (matching the pattern already
used in `getImagesLite`, `getSharedGroup`).

### Plan
1. Rewrite `getImageByShareKey` to use LEFT JOIN on `imageTags` + `tags` with
   `tagNamesAgg` (already defined at line 465).
2. Add `tag_names` to the SELECT (like `getImagesLite` does).
3. Parse `tag_names` into `tags` array in the return value (split on `,`).
4. Keep `prevId: null, nextId: null` as-is (shared photo pages don't navigate).

### Exit criterion
- `getImageByShareKey` returns the same shape as before.
- Shared photo page loads use exactly 1 DB query instead of 2.
- Existing tests pass.

---

## C14-MED-02: `searchImages` GROUP BY — extract shared column list

**File**: `apps/web/src/lib/data.ts:1076-1180`
**Severity**: MEDIUM
**Confidence**: High

### Problem
The `searchFields` object and two GROUP BY clauses must list the same columns.
A developer adding a field to `searchFields` without updating BOTH GROUP BY
clauses will get a silent ONLY_FULL_GROUP_BY error in production MySQL. No
compile-time or runtime enforcement exists — only a MAINTENANCE NOTE comment.

### Plan
1. Extract the GROUP BY column list into a shared array:
   `const searchGroupByColumns = [images.id, images.title, ...]`.
2. Use `.groupBy(...searchGroupByColumns)` in both the tag and alias queries.
3. Add a fixture test that verifies the GROUP BY columns match the keys of
   `searchFields`.

### Exit criterion
- Both `.groupBy()` calls use the same shared array.
- Fixture test passes.
- Existing tests pass.

---

## Progress

- [x] C14-MED-01: getImageByShareKey single-query rewrite
- [x] C14-MED-02: searchImages GROUP BY shared columns
