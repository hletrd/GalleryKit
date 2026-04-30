# Plan 67 — Cycle 21 Fixes (C21-01 and C21-02)

**Created:** 2026-04-19 (Cycle 21)
**Status:** DONE
**Severity:** 2 LOW

---

## Problem

Two issues identified in the cycle 21 comprehensive review. Both are the same class: async handler functions that have `try/finally` but no `catch` block. If the server action throws (network error, infrastructure failure), the user gets no error toast notification. The `finally` blocks correctly reset loading state, but the missing `catch` means the error is silently swallowed.

This is the same pattern fixed in cycles 19-20 for other handlers.

---

## Implementation Steps

### Step 1: C21-01 — Add catch to handleDelete in image-manager.tsx

**File:** `apps/web/src/components/image-manager.tsx`, lines 94-112

```tsx
// Before
try {
    const res = await deleteImage(id);
    if (res?.success) {
        toast.success(t('imageManager.imageDeleted'));
        setImages(prev => prev.filter(img => img.id !== id));
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
        });
    } else {
        toast.error(t('imageManager.deleteFailed'));
    }
} finally {
    setDeletingId(null);
}

// After
try {
    const res = await deleteImage(id);
    if (res?.success) {
        toast.success(t('imageManager.imageDeleted'));
        setImages(prev => prev.filter(img => img.id !== id));
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(id);
            return newSet;
        });
    } else {
        toast.error(t('imageManager.deleteFailed'));
    }
} catch {
    toast.error(t('imageManager.deleteFailed'));
} finally {
    setDeletingId(null);
}
```

### Step 2: C21-02 — Add catch to handleCreate in admin-user-manager.tsx

**File:** `apps/web/src/components/admin-user-manager.tsx`, lines 34-48

```tsx
// Before
try {
    const result = await createAdminUser(formData);
    if (result.error) {
        toast.error(result.error);
    } else {
        toast.success(t('users.createSuccess'));
        setOpen(false);
        router.refresh();
    }
} finally {
    setIsCreating(false);
}

// After
try {
    const result = await createAdminUser(formData);
    if (result.error) {
        toast.error(result.error);
    } else {
        toast.success(t('users.createSuccess'));
        setOpen(false);
        router.refresh();
    }
} catch {
    toast.error(t('serverActions.failedToCreateUser'));
} finally {
    setIsCreating(false);
}
```

### Step 3: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/image-manager.tsx` — add catch block to handleDelete
- `apps/web/src/components/admin-user-manager.tsx` — add catch block to handleCreate

## Risk Assessment

- **Risk:** VERY LOW — All changes are small, targeted improvements. The try/catch pattern is already used extensively in the same codebase. No logic changes, only error handling additions.
