# Cycle 18 — Comprehensive Deep Review (2026-04-19)

Reviewer: single-agent multi-angle review (code quality, security, performance, UX, correctness)

---

## C18-01: `admin-user-manager.tsx` handleCreate missing try/finally for setIsCreating

**Severity:** LOW | **Confidence:** HIGH

**File:** `apps/web/src/components/admin-user-manager.tsx`, lines 34-46

The `handleCreate` function sets `setIsCreating(true)` on line 35 and `setIsCreating(false)` on line 37, but if `createAdminUser(formData)` throws an unhandled exception (e.g., network failure), `setIsCreating(false)` is never called. The button stays permanently disabled. The same pattern is already fixed in `handleBatchAddTag` (try/finally) and `handleBulkDelete` (try/finally) in `image-manager.tsx`.

```tsx
// Current
async function handleCreate(formData: FormData) {
    setIsCreating(true);
    const result = await createAdminUser(formData);
    setIsCreating(false);
    ...
}

// Fix
async function handleCreate(formData: FormData) {
    setIsCreating(true);
    try {
        const result = await createAdminUser(formData);
        ...
    } finally {
        setIsCreating(false);
    }
}
```

---

## C18-02: `image-manager.tsx` handleDelete missing try/finally for setDeletingId

**Severity:** LOW | **Confidence:** HIGH

**File:** `apps/web/src/components/image-manager.tsx`, lines 94-109

The `handleDelete` function sets `setDeletingId(id)` on line 95 and `setDeletingId(null)` on line 108, but `setDeletingId(null)` is outside any finally block. If `deleteImage(id)` throws an exception (the function itself has no try/catch at the server-action level for unexpected errors), `deletingId` stays set, leaving the button permanently disabled. The same class of bug as C18-01.

```tsx
// Current
const handleDelete = async (id: number) => {
    setDeletingId(id);
    const res = await deleteImage(id);
    if (res?.success) { ... } else { ... }
    setDeletingId(null);
};

// Fix
const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
        const res = await deleteImage(id);
        if (res?.success) { ... } else { ... }
    } finally {
        setDeletingId(null);
    }
};
```

---

## C18-03: `topic-manager.tsx` handleDelete and handleDeleteAlias missing try/finally for state reset

**Severity:** LOW | **Confidence:** HIGH

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 81-91, 106-117

Both `handleDelete` and `handleDeleteAlias` follow the same unprotected pattern as C18-01/C18-02: `setIsDeletingTopic(true)` / `setIsDeletingAlias(true)` before the async call, `setIsDeletingTopic(false)` / `setIsDeletingAlias(false)` after, but no try/finally. If the server action throws, the delete button stays permanently disabled.

---

## C18-04: `tag-manager.tsx` handleDelete missing try/finally for setIsDeleting

**Severity:** LOW | **Confidence:** HIGH

**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, lines 65-75

Same pattern as C18-01/02/03: `setIsDeleting(true)` on line 66, `setIsDeleting(false)` on line 68, no try/finally. Server action exception leaves the button permanently disabled.

---

## C18-05: `uploadImages` early return after pre-incrementing upload tracker

**Severity:** LOW | **Confidence:** MEDIUM

**File:** `apps/web/src/app/actions/images.ts`, lines 112-126

After pre-incrementing the upload tracker on lines 115-119, the function returns early with errors on lines 122-126 if the topic is missing or invalid format. But the tracker has already been incremented with the file bytes/count. The post-processing adjustment on lines 239-241 only runs when `successCount > 0`, so on early return, the tracker retains the pre-incremented values even though no bytes were actually uploaded. This could cause subsequent uploads from the same IP to be incorrectly rejected for exceeding the cumulative limit.

The early returns on lines 122 (`topicRequired`) and 125 (`invalidTopicFormat`) need to roll back the tracker before returning.

```ts
// Fix: roll back tracker before early returns
if (!topic) {
    tracker.bytes = originalTrackerBytes;
    tracker.count = originalTrackerCount;
    uploadTracker.set(uploadIp, tracker);
    return { error: t('topicRequired') };
}
if (!isValidSlug(topic)) {
    tracker.bytes = originalTrackerBytes;
    tracker.count = originalTrackerCount;
    uploadTracker.set(uploadIp, tracker);
    return { error: t('invalidTopicFormat') };
}
```

---

## C18-06: `photo-viewer.tsx` document.title leaks previous page title on unmount

**Severity:** VERY LOW | **Confidence:** MEDIUM

**File:** `apps/web/src/components/photo-viewer.tsx`, lines 72-78

The cleanup function on line 77 restores `previousTitle` (the title captured when the effect ran). However, if the user navigates from photo A to photo B (both within PhotoViewer), the cleanup of photo A's effect sets `document.title` to whatever it was before photo A, then photo B's effect immediately sets it again. This causes a brief visual flash of the wrong title. This is a minor UX issue and arguably by design for proper cleanup semantics. The current approach is acceptable but could be improved by tracking the "expected" title and only restoring if it hasn't been changed by a subsequent effect.

---

## Summary

| ID | Severity | Confidence | File | Issue |
|----|----------|------------|------|-------|
| C18-01 | LOW | HIGH | admin-user-manager.tsx | handleCreate missing try/finally for setIsCreating |
| C18-02 | LOW | HIGH | image-manager.tsx | handleDelete missing try/finally for setDeletingId |
| C18-03 | LOW | HIGH | topic-manager.tsx | handleDelete/handleDeleteAlias missing try/finally |
| C18-04 | LOW | HIGH | tag-manager.tsx | handleDelete missing try/finally for setIsDeleting |
| C18-05 | LOW | MEDIUM | images.ts (actions) | upload tracker not rolled back on early return |
| C18-06 | VERY LOW | MEDIUM | photo-viewer.tsx | document.title cleanup flash (cosmetic) |

**Total: 5 LOW + 1 VERY LOW = 6 findings**

No CRITICAL, HIGH, or MEDIUM findings. The codebase is well-hardened after 17 prior cycles.
