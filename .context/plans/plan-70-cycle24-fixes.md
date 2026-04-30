# Plan 70 — Cycle 24 Fixes (C24-01, C24-02, C24-03)

**Created:** 2026-04-19 (Cycle 24)
**Status:** DONE
**Severity:** 3 LOW

---

## Problem

Three LOW-severity issues identified in the cycle 24 comprehensive review:

1. **C24-01**: `handleBulkDelete` success filter uses `selectedIds` (closure) instead of locally captured `ids` — stale state could theoretically cause wrong images removed from local UI after `await`.

2. **C24-02**: Password form missing `autoComplete` attributes on password fields — browsers may autofill wrong fields, fail to suggest password generation. WCAG 1.3.5 recommends `autocomplete` attributes.

3. **C24-03**: Admin-user-manager delete `AlertDialogAction` lacks loading state guard — user could click confirm twice quickly, causing a confusing error toast. Other delete handlers have loading guards.

---

## Implementation Steps

### Step 1: C24-01 — Use captured `ids` instead of `selectedIds` in handleBulkDelete success filter

**File:** `apps/web/src/components/image-manager.tsx`, line 128

Capture `ids` into a Set before the async call and use it for filtering:

```tsx
// Before
setImages(prev => prev.filter(img => !selectedIds.has(img.id)));

// After
const deletedIdSet = new Set(ids);
setImages(prev => prev.filter(img => !deletedIdSet.has(img.id)));
```

### Step 2: C24-02 — Add autoComplete attributes to password form fields

**File:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`, lines 62-95

Add `autoComplete` attributes:
- `currentPassword` input: `autoComplete="current-password"`
- `newPassword` input: `autoComplete="new-password"`
- `confirmPassword` input: `autoComplete="new-password"`

### Step 3: C24-03 — Add isDeleting state to admin-user-manager delete handler

**File:** `apps/web/src/components/admin-user-manager.tsx`, line 157

Add `isDeleting` state variable, wrap `handleDelete` in try/finally with the state, and disable `AlertDialogAction` when `isDeleting` is true.

### Step 4: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/image-manager.tsx` — use captured `ids` instead of `selectedIds` in bulk delete filter
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx` — add `autoComplete` attributes
- `apps/web/src/components/admin-user-manager.tsx` — add `isDeleting` state and disable delete button during operation

## Risk Assessment

- **Risk:** VERY LOW — All three changes are small, targeted UX/accessibility improvements. No logic changes that affect data integrity.
