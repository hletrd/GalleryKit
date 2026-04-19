# Plan 69 — Cycle 23 Fixes (C23-01, C23-02)

**Created:** 2026-04-19 (Cycle 23)
**Status:** DONE
**Severity:** 2 LOW

---

## Problem

Two LOW-severity issues identified in the cycle 23 comprehensive review:

1. **C23-01**: `handleBatchAddTag` Enter key handler in `image-manager.tsx` lacks `isAddingTag` guard — rapid Enter presses could fire duplicate `batchAddTags` server actions.

2. **C23-02**: Bulk delete `AlertDialogAction` in `image-manager.tsx` lacks `disabled={isBulkDeleting}` — user could click the confirm button multiple times during an in-progress deletion.

---

## Implementation Steps

### Step 1: C23-01 — Add isAddingTag guard to batch-tag Enter key handler

**File:** `apps/web/src/components/image-manager.tsx`, lines 228-231

Add `isAddingTag` check to the `onKeyDown` handler:

```tsx
// Before
onKeyDown={(e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleBatchAddTag();
    }
}}

// After
onKeyDown={(e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (!isAddingTag) handleBatchAddTag();
    }
}}
```

### Step 2: C23-02 — Add disabled prop and loading text to bulk-delete AlertDialogAction

**File:** `apps/web/src/components/image-manager.tsx`, line 268

Add `disabled={isBulkDeleting}` and conditional loading text:

```tsx
// Before
<AlertDialogAction onClick={handleBulkDelete}>{t('imageManager.delete')}</AlertDialogAction>

// After
<AlertDialogAction onClick={handleBulkDelete} disabled={isBulkDeleting}>
    {isBulkDeleting ? t('imageManager.deleting') : t('imageManager.delete')}
</AlertDialogAction>
```

### Step 3: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/image-manager.tsx` — add isAddingTag guard to Enter handler; add disabled prop to bulk delete button

## Risk Assessment

- **Risk:** VERY LOW — Both changes are small, targeted UX guards. No logic changes, only double-click/double-submit protection.
