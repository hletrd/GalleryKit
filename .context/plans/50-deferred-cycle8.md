# Plan 50 — Deferred Items (Cycle 8)

**Created:** 2026-04-19 (Cycle 8)
**Status:** Deferred

## Deferred Findings

### C8-04: searchImages no query length guard at data layer (LOW)
- **File:** `apps/web/src/lib/data.ts:535-536`
- **Original severity/confidence:** LOW / LOW
- **Reason for deferral:** The sole caller (`searchImagesAction` in `public.ts`) already truncates the query to 200 characters before passing it to `searchImages`. Adding a redundant guard in the data layer is defense-in-depth, but `searchImages` is a private implementation detail only called from one place. The LIKE query with a 200-char search term is not a performance concern.
- **Exit criterion:** If `searchImages` is called from additional contexts without length truncation, re-open.

### C8-05: Audit log fires on race-deleted image (LOW)
- **File:** `apps/web/src/app/actions/images.ts:309-310`
- **Original severity/confidence:** LOW / MEDIUM
- **Reason for deferral:** On closer examination, the `image` variable is already verified as non-null at line 271 (`if (!image) return { error: 'Image not found' };`). The audit log at line 309 only fires when image was found. The scenario described (audit on race-deleted image) cannot actually occur because the function returns early before reaching the audit log. The finding was based on an incorrect analysis of the control flow.
- **Exit criterion:** If the early-return guard is ever removed or restructured, re-open.

### C8-10: batchUpdateImageTags added count may be slightly inaccurate (LOW)
- **File:** `apps/web/src/app/actions/tags.ts:250`
- **Original severity/confidence:** LOW / LOW
- **Reason for deferral:** The `INSERT IGNORE` correctly prevents duplicate key errors, and the `added` counter is used only for a success response — not for any security or data integrity decision. The inaccuracy (over-counting by 1-2 on duplicates) is negligible for the UI. Adding `affectedRows` checks would add complexity for minimal benefit.
- **Exit criterion:** If the `added` count is ever used for billing, quota, or security decisions, re-open.
