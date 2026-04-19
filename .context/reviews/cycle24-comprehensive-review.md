# Cycle 24 Comprehensive Review (2026-04-19)

**Reviewer:** multi-angle comprehensive review
**Scope:** Full codebase — server actions, data layer, image processing pipeline, rate limiting, session management, middleware, UI components, translation files, and cross-file interactions

---

## Methodology

Reviewed all server action modules (auth, images, tags, sharing, topics, admin-users, public), data layer (data.ts), image processing pipeline (process-image.ts, image-queue.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), session management (session.ts), validation (validation.ts), middleware (proxy.ts), DB schema (schema.ts), audit logging (audit.ts), and all UI components (image-manager, upload-dropzone, photo-viewer, admin-user-manager, password-form). Searched for: logic bugs, missed edge cases, race conditions, error-handling gaps, security weaknesses, performance issues, i18n gaps, and documentation-code mismatches. This is cycle 24; cycles 1-23 have already addressed most issues, so this review focuses on remaining subtle gaps.

---

## Findings

### C24-01: `handleBulkDelete` success filter uses `selectedIds` (closure) instead of locally captured `ids`

**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/components/image-manager.tsx`, line 128

The `handleBulkDelete` function captures `const ids = Array.from(selectedIds)` at line 119 and sends `ids` to the server action at line 122. However, on success at line 128, it filters images using `selectedIds` (the state variable from the closure) instead of the captured `ids`:

```tsx
setImages(prev => prev.filter(img => !selectedIds.has(img.id)));
```

If `selectedIds` were to change between function start and the success callback (after the `await` on line 122), the filter would use stale or incorrect selection state. In practice, `isBulkDeleting` prevents UI interactions that could modify `selectedIds`, making this extremely unlikely. However, using the captured `ids` would be more robust and consistent with the rest of the function.

**Concrete scenario:** A React concurrent mode update or an external state mutation could theoretically change `selectedIds` during the `await deleteImages(ids)` call. The filter would then remove the wrong set of images from the local state.

**Fix:** Replace `selectedIds` with `ids` in the filter:
```tsx
const idSet = new Set(ids);
setImages(prev => prev.filter(img => !idSet.has(img.id)));
```

---

### C24-02: Password form missing `autoComplete` attributes on password fields

**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`, lines 62-95

The password form does not set `autoComplete` attributes on its password `<Input>` elements. Without these hints, browsers may:
- Autofill the "Current Password" field with a saved username or the wrong password
- Autofill the "New Password" field with the current password instead of suggesting a new one
- Fail to offer password generation for the "New Password" field

This is a UX concern, not a security vulnerability. The HTML standard and WCAG 1.3.5 (Identify Input Purpose) recommend providing `autocomplete` attributes for password fields.

**Concrete scenario:** User navigates to the password change form. Browser autofills "New Password" with the current saved password. User submits without noticing, which fails the "current password must be different" check (enforced server-side in auth.ts).

**Fix:** Add `autoComplete` attributes:
- `currentPassword` input: `autoComplete="current-password"`
- `newPassword` input: `autoComplete="new-password"`
- `confirmPassword` input: `autoComplete="new-password"`

---

### C24-03: Admin-user-manager delete lacks loading state guard on AlertDialogAction

**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/components/admin-user-manager.tsx`, line 157

The `AlertDialogAction` for user deletion calls `handleDelete` but does not disable during the async operation. While `handleDelete` immediately closes the dialog via `setDeleteTarget(null)` (line 53), there is no `isDeleting` state to prevent the user from quickly clicking the delete icon again and confirming a second time. This could result in two concurrent `deleteAdminUser` calls for the same user.

The server handles this safely (the second call returns an error because the user no longer exists), so there is no data corruption. However, the user sees a confusing error toast.

Other delete handlers in the codebase (image-manager, topic-manager, tag-manager) all have loading state guards. This is an inconsistency.

**Concrete scenario:** Admin clicks the delete icon for user "alice", confirms in the dialog, and while the server is processing, quickly clicks the delete icon for "alice" again (the table hasn't refreshed yet) and confirms again. Two `deleteAdminUser` calls fire; the second returns an error toast.

**Fix:** Add an `isDeleting` state variable, set it to true at the start of `handleDelete`, and reset in a `finally` block. Disable the `AlertDialogAction` when `isDeleting` is true:

```tsx
const [isDeleting, setIsDeleting] = useState(false);

async function handleDelete(id: number) {
    setDeleteTarget(null);
    setIsDeleting(true);
    try {
        const result = await deleteAdminUser(id);
        // ...
    } catch {
        // ...
    } finally {
        setIsDeleting(false);
    }
}

// In AlertDialogAction:
<AlertDialogAction onClick={() => deleteTarget && handleDelete(deleteTarget.id)} disabled={isDeleting} className="...">
```

---

## NOT A BUG / LOW PRIORITY

4. **C24-04**: `handleShare` in image-manager.tsx correctly captures `ids = Array.from(selectedIds)` at line 143 and uses `selectedIds` only for the `setSelectedIds(new Set())` reset. The share handler is consistent and correct.

5. **C24-05**: `searchImagesAction` in public.ts increments the in-memory rate limit before the DB check (TOCTOU fix). If the DB check says the user is limited after the in-memory increment, the slight overcounting is intentional and acceptable — it prevents burst requests from all passing the check.

6. **C24-06**: `uploadImages` in images.ts pre-increments the upload tracker and rolls back on validation failures. The rollback paths for `topicRequired` (line 122-126) and `invalidTopicFormat` (line 129-133) are correct and symmetric.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-23 findings remain resolved. No regressions detected. Specifically confirmed:
- C23-01: `isAddingTag` guard is present on Enter key handler (image-manager.tsx line 231)
- C23-02: `disabled={isBulkDeleting}` is present on bulk delete AlertDialogAction (image-manager.tsx line 268)
- C22-03: `handleUpload` catch block is present (upload-dropzone.tsx line 191)
- C19-01 through C19-05: All try/catch blocks confirmed present in their respective handlers

---

## Deferred Carry-Forward

All 17+2+2 previously deferred items from cycles 5-23 remain deferred with no change in status.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **3 LOW** findings (actionable: C24-01, C24-02, C24-03)
- **3 LOW** findings (not-a-bug / low-priority: C24-04, C24-05, C24-06)
- **6 total** findings
