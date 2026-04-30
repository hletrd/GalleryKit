# Plan 90 — Cycle 4 Fixes

**Source review:** Cycle 4 Comprehensive Review (C4-F01, C4-F04)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence |
|----|------------|----------|------------|
| C4-F01 | Unused eslint-disable directive in photo-viewer.tsx | LOW | HIGH |
| C4-F04 | Upload dropzone `<label htmlFor="upload-tags">` associated with `<div>` instead of labelable element | MEDIUM | HIGH |

### Deferred Findings (not implemented this cycle)

| ID | Description | Severity | Reason |
|----|------------|----------|--------|
| C4-F02 | Admin checkboxes use native `<input>` instead of Checkbox | LOW | No Checkbox UI component exists in project (same as C3-F02 deferral) |
| C4-F03 | `isReservedTopicRouteSegment` rarely used | LOW | Dead code, no functional impact |
| C4-F05 | `loadMoreImages` offset cap may allow expensive tag queries | LOW | Hard cap already limits damage; diminishing returns |
| C4-F06 | `processImageFormats` creates 3 sharp instances | LOW | Informational only; current approach is correct |

---

## C4-F01: Unused eslint-disable directive

**File:** `apps/web/src/components/photo-viewer.tsx:60`

**Current code:**
```tsx
// eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reading SSR-unavailable sessionStorage on mount
setShowLightbox(true);
```

**Fix:** Remove the `eslint-disable-next-line` comment. The `react-hooks/set-state-in-effect` rule no longer reports this pattern as a problem.

---

## C4-F04: Upload dropzone tag label accessibility

**File:** `apps/web/src/components/upload-dropzone.tsx:235-244`

**Current code (line 235-244):**
```tsx
<div>
    <label htmlFor="upload-tags" className="text-sm font-medium mb-1 block">{t('upload.tags')} ({t('home.allTags')})</label>
    <div id="upload-tags">
    <TagInput
        availableTags={availableTags}
        selectedTags={selectedTags}
        onTagsChange={setSelectedTags}
        placeholder={t('upload.addExistingTag')}
    />
    </div>
</div>
```

**Problem:** `<label htmlFor="upload-tags">` points to `<div id="upload-tags">`, but `div` is not a labelable element. Screen readers won't associate the label with the TagInput.

**Fix:** Replace the `htmlFor`/`id` pattern with `aria-labelledby`:
1. Change the label to use an `id` attribute instead of `htmlFor`: `<label id="upload-tags-label" className="...">...</label>`
2. Change the TagInput wrapper div to use `role="group"` and `aria-labelledby="upload-tags-label"`
3. Remove the `id="upload-tags"` from the wrapper div

---

## Implementation Order

1. Fix C4-F01 (remove unused eslint-disable) — simple, isolated
2. Fix C4-F04 (tag label aria-labelledby) — accessibility improvement

---

## Verification

- [x] `npm run lint --workspace=apps/web` passes with 0 warnings
- [x] `cd apps/web && npx vitest run` passes (66/66)
- [x] `npm run build` passes
