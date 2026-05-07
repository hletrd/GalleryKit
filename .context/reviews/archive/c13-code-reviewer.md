# Code Review — Cycle 13 (code-reviewer)

## Review Scope
All source files under apps/web/src/, with focus on logic bugs, error handling, edge cases, and maintainability.

## Findings

### C13-CR-01: `exportImagesCsv` results reassignment uses misleading type assertion
- **File+line**: `apps/web/src/app/[locale]/admin/db-actions.ts:98`
- **Severity**: Low | **Confidence**: Low
- **Issue**: `results = [] as typeof results` — the `as typeof results` assertion is technically correct but misleading. A block-scoped variable or `results.length = 0` would be clearer. This was previously noted as C12-LOW-02 but not acted on.
- **Fix**: Consider scoping or `length = 0`.
- **Status**: Carried forward from C12-LOW-02.

### C13-CR-02: `updateImageMetadata` returns sanitized null but schema column may have default
- **File+line**: `apps/web/src/app/actions/images.ts:724-727`
- **Severity**: Low | **Confidence**: Medium
- **Issue**: When `sanitizeAdminString` rejects input (returns `value: null`), the action returns an error. However, the success path (line 772) returns `{ title: sanitizedTitle, description: sanitizedDescription }` where `sanitizedTitle` can be null (explicitly allowed — image.title defaults to null). The client must distinguish between "title was set to null" (user cleared it) and "title was null and stayed null." This is correct behavior but the return type could be more explicit.
- **Fix**: Cosmetic — consider documenting that null means "cleared" in the return type.

### C13-CR-03: `getSharedGroup` view count increment condition may skip on empty image list
- **File+line**: `apps/web/src/lib/data.ts:993`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The view count is only incremented when `imagesWithTags.length > 0`. This means a shared group with no processed images (all still processing) never gets a view count increment. Once images finish processing, the view count will undercount. This is documented as intentional (C6F-01) and correct for avoiding inflating the counter for groups with no visible content yet.
- **Fix**: No fix needed — by design.

### C13-CR-04: `buildCursorCondition` dated branch includes `isNull(capture_date)` OR clause for undated successors
- **File+line**: `apps/web/src/lib/data.ts:549-556`
- **Severity**: Low | **Confidence**: Low
- **Issue**: For a dated cursor (capture_date is not null), the `buildCursorCondition` includes `isNull(images.capture_date)` as an OR branch, meaning undated images appear as "next" after dated images. This matches the gallery sort order (DESC puts NULLs last, so in forward/ASC direction they are successors). The logic is correct but could confuse a reader unfamiliar with the NULLS LAST sort semantics.
- **Fix**: Consider adding a comment explaining why isNull is in the successor branch for dated cursors.

### C13-CR-05: Lightbox `useEffect` for auto-hide timer has `shouldAutoHideControls` in dep array but not `controlsVisible`
- **File+line**: `apps/web/src/components/lightbox.tsx:143-164`
- **Severity**: Low | **Confidence**: Low
- **Issue**: The `useEffect` that arms the initial auto-hide timer depends on `shouldAutoHideControls` but the timer callback references `controlsVisible` indirectly through `dialogRef.current?.contains(document.activeElement)`. Since `controlsVisible` is not in the dep array, the effect doesn't re-arm when controls become visible through other means. However, the `showControls` callback is the primary control path and it does re-arm the timer correctly.
- **Fix**: No fix needed — the `showControls` function handles all interactive re-arming.

## Summary
- Total findings: 5 (1 carried forward, 4 new observations)
- All LOW severity
- No new HIGH/MEDIUM issues found beyond what prior cycles identified
