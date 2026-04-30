# Plan 97 — Cycle 10 Fixes

**Created:** 2026-04-19 (Cycle 10)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence | Action |
|----|------------|----------|------------|--------|
| C10-F01 | `batchAddTags` returns success on silent FK failures | LOW | Medium | IMPLEMENT |
| C10-F02 | Duplicated tag-filter subquery logic in `getImageCount` vs `buildTagFilterCondition` | LOW | Low | IMPLEMENT |

---

## C10-F01: batchAddTags returns success on silent FK failures — IMPLEMENT

**File:** `apps/web/src/app/actions/tags.ts:222`

**Problem:** If any `imageId` in the batch doesn't exist in the `images` table (deleted by another admin between validation and insertion), the `INSERT IGNORE` suppresses the FK constraint error. The function returns `{ success: true }` even though some or all tag-image links were not created.

**Fix implemented:** Verify which image IDs still exist before linking the tag. Only insert links for existing images. Report missing image IDs as a warning. Added `someImagesNotFound` translation key to `en.json` and `ko.json`. Multiple warnings (slug collision + missing images) are now joined with semicolons.

**Progress:** [x] Implemented — commit 35f8789

---

## C10-F02: Duplicated tag-filter subquery logic — IMPLEMENT

**File:** `apps/web/src/lib/data.ts:206-220` vs `data.ts:230-243`

**Problem:** `getImageCount` has its own inline implementation of the tag-filter subquery, while `buildTagFilterCondition` implements the exact same logic. DRY violation.

**Fix implemented:** Replaced the inline tag filter logic in `getImageCount` with a call to `buildTagFilterCondition(tagSlugs)`.

**Progress:** [x] Implemented — commit 35f8789

---

## Verification

- [x] C10-F01: `batchAddTags` warns when some image IDs don't exist
- [x] C10-F02: `getImageCount` uses `buildTagFilterCondition` instead of inline duplicate
- [x] `npm run lint --workspace=apps/web` passes with 0 errors
- [x] `npm run build` passes
- [x] `cd apps/web && npx vitest run` passes (9 files, 66 tests)
