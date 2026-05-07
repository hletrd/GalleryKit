# Aggregate Review -- Cycle 46 (2026-04-20)

## Summary

Cycle 46 deep review of the full codebase found **2 new actionable issues** (1 MEDIUM, 1 LOW) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles. The codebase continues to be well-hardened after 45 previous review cycles.

## New Findings (Deduplicated)

### C46-01: `tagsString` in `uploadImages` not sanitized before length check [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/images.ts` lines 58-60
**Description:** The `tagsString` form field (line 58) is extracted raw from `formData.get('tags')` and its length is checked on line 60 BEFORE any `stripControlChars` is applied. The individual tag names extracted from it are sanitized (line 65), but the raw `tagsString` length check (line 60) and the duplicate validation check (line 68) operate on the unsanitized string. This is the same class of issue as C45-03 (length validation before sanitization). A `tagsString` of 1001 characters where 2 are control characters would be rejected even though after stripping it would be 999 characters -- a false rejection. More importantly, the validated length and stored length can diverge, which is the core defense-in-depth concern.
**Fix:** Apply `stripControlChars` to `tagsString` before the length check on line 60. Change line 58 from `const tagsString = formData.get('tags')?.toString() ?? '';` to `const tagsString = stripControlChars(formData.get('tags')?.toString() ?? '') ?? '';`. Then update line 68 to use the already-sanitized `tagsString` for the validation comparison instead of re-splitting and re-sanitizing.

### C46-02: `searchImagesAction` length check operates on unsanitized query [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/public.ts` lines 26, 94
**Description:** The `query.length > 200` early rejection on line 26 operates on the raw unsanitized query string. The `stripControlChars` call happens later on line 94. A query with embedded control characters that is exactly 201 chars (but 199 after stripping) would be falsely rejected. This is the same class as C45-03 and C46-01. The impact is limited because it only causes false rejections, not security issues, and the `.slice(0, 200)` on line 94 provides a belt-and-suspenders truncation.
**Fix:** Apply `stripControlChars` before the length check. Move the sanitization from line 94 to before line 26, then use the sanitized value for both the length check and the search.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-45 remain deferred with no change in status.

## Recommended Priority for Implementation

1. C46-01 -- Sanitize `tagsString` before length check in `uploadImages`
2. C46-02 -- Sanitize `query` before length check in `searchImagesAction`
