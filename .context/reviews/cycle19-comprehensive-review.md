# Comprehensive Code Review — Cycle 19 (2026-04-19)

**Reviewer:** single-agent multi-angle review
**Scope:** Full codebase — all server actions, data layer, auth, UI components, API routes, i18n

---

## C19-01: `handleDelete` in `admin-user-manager.tsx` has no try/finally (LOW)

**File:** `apps/web/src/components/admin-user-manager.tsx`, lines 50-59
**Severity:** LOW | **Confidence:** HIGH

```tsx
async function handleDelete(id: number) {
    setDeleteTarget(null);
    const result = await deleteAdminUser(id);
    if (result.error) {
        toast.error(result.error);
    } else {
        toast.success(t('users.deleteSuccess'));
        router.refresh();
    }
}
```

The `deleteAdminUser` call is not wrapped in try/finally. If the call throws (network error, etc.), there is no user feedback at all — no toast, no error state reset. While `setDeleteTarget(null)` runs before the await (closing the dialog), the user gets no indication of failure.

Note: Unlike other handlers (image-manager, topic-manager, tag-manager), this one does NOT use a loading state for the delete button, so the UI impact is limited to missing error feedback rather than a permanently stuck button. Still, the pattern should be consistent.

**Fix:** Wrap in try/catch with error toast.

---

## C19-02: `handleUpload` in `upload-dropzone.tsx` has no try/finally around setUploading (LOW)

**File:** `apps/web/src/components/upload-dropzone.tsx`, lines 100-192
**Severity:** LOW | **Confidence:** HIGH

```tsx
const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    // ... long upload loop ...
    setUploading(false);
    // ... more logic ...
};
```

If an unhandled exception occurs during the upload loop (e.g., an unexpected error not caught by the inner try/catch in `uploadFile`), `setUploading(false)` is never called. The upload UI stays in a permanently disabled state. The `finally` block is missing on the outer function.

**Fix:** Wrap the entire function body in try/finally, with `setUploading(false)` in the finally block.

---

## C19-03: `handleCreate` and `handleUpdate` in `topic-manager.tsx` have no error handling for throws (LOW)

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 58-79
**Severity:** LOW | **Confidence:** HIGH

```tsx
async function handleCreate(formData: FormData) {
    const res = await createTopic(formData);
    if (res?.error) {
        toast.error(res.error);
    } else {
        toast.success(t('categories.created'));
        setIsCreateOpen(false);
        router.refresh();
    }
}

async function handleUpdate(formData: FormData) {
    if (!editingTopic) return;
    const res = await updateTopic(editingTopic.slug, formData);
    if (res?.error) {
        toast.error(res.error);
    } else {
        toast.success(t('categories.updated'));
        setEditingTopic(null);
        router.refresh();
    }
}
```

Neither function has try/catch. If `createTopic` or `updateTopic` throws (as opposed to returning `{ error: ... }`), the user gets no feedback and the dialog stays open with no indication of failure. This is the same class of issue fixed in cycles 17-18 for other handlers, but these two were missed because they don't use loading states.

**Fix:** Wrap each in try/catch with error toast.

---

## C19-04: `handleUpdate` in `tag-manager.tsx` has no error handling for throws (LOW)

**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, lines 51-63
**Severity:** LOW | **Confidence:** HIGH

```tsx
async function handleUpdate(formData: FormData) {
    if (!editingTag) return;
    const name = formData.get('name') as string;
    const res = await updateTag(editingTag.id, name);
    if (res?.error) {
        toast.error(res.error);
    } else {
        toast.success(t('tags.updated'));
        setEditingTag(null);
        router.refresh();
    }
}
```

Same pattern as C19-03 — no try/catch. If `updateTag` throws, no feedback to the user.

**Fix:** Wrap in try/catch with error toast.

---

## C19-05: `handleAddAlias` in `topic-manager.tsx` has no error handling for throws (LOW)

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 96-107
**Severity:** LOW | **Confidence:** MEDIUM

```tsx
async function handleAddAlias(topicSlug: string) {
    if (!newAlias.trim()) return;
    const res = await createTopicAlias(topicSlug, newAlias.trim());
    if (res?.error) {
        toast.error(res.error);
    } else {
        toast.success(t('categories.aliasAdded'));
        setNewAlias('');
        setEditingTopic(prev => ...);
        router.refresh();
    }
}
```

Same missing try/catch pattern. Additionally, the optimistic UI update (`setEditingTopic`) will be wrong if `router.refresh()` doesn't actually refresh the data (e.g., stale cache). However, this is a minor inconsistency since the router.refresh should always trigger a server re-render.

**Fix:** Wrap in try/catch with error toast.

---

## Summary

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **5 LOW** findings — all are the same class of issue: async handlers without try/catch for thrown errors

All findings are consistently the same pattern: server action handlers that check for `{ error }` return values but don't guard against thrown exceptions. Previous cycles (17-18) fixed the try/finally pattern for handlers with loading states, but handlers without loading states were not consistently updated because the "stuck UI" symptom doesn't apply. However, the missing error feedback is still a correctness issue — users get no notification when something unexpectedly fails.

---

## Previously Fixed — Confirmed Still Resolved

All cycle 1-18 findings remain resolved. No regressions detected.

---

## Deferred Carry-Forward

All 17 previously deferred items from cycles 5-14 remain deferred with no change in status.
