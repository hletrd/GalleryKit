# Plan 64 — Cycle 18 Fixes (C18-01 through C18-06)

**Created:** 2026-04-19 (Cycle 18)
**Status:** DONE
**Severity:** 5 LOW + 1 VERY LOW

---

## Problem

Six issues identified in the cycle 18 comprehensive review. Five are LOW severity (missing try/finally for loading state + upload tracker rollback), one is VERY LOW (cosmetic). All are small, targeted improvements to correctness and robustness.

---

## Implementation Steps

### Step 1: C18-01 — Fix handleCreate missing try/finally in admin-user-manager.tsx

**File:** `apps/web/src/components/admin-user-manager.tsx`, lines 34-46

```tsx
// Before
async function handleCreate(formData: FormData) {
    setIsCreating(true);
    const result = await createAdminUser(formData);
    setIsCreating(false);

    if (result.error) {
        toast.error(result.error);
    } else {
        toast.success(t('users.createSuccess'));
        setOpen(false);
        router.refresh();
    }
}

// After
async function handleCreate(formData: FormData) {
    setIsCreating(true);
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
}
```

### Step 2: C18-02 — Fix handleDelete missing try/finally in image-manager.tsx

**File:** `apps/web/src/components/image-manager.tsx`, lines 94-109

```tsx
// Before
const handleDelete = async (id: number) => {
    setDeletingId(id);
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
    setDeletingId(null);
};

// After
const handleDelete = async (id: number) => {
    setDeletingId(id);
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
};
```

### Step 3: C18-03 — Fix handleDelete and handleDeleteAlias missing try/finally in topic-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 81-91, 106-117

```tsx
// handleDelete — Before
async function handleDelete(slug: string) {
    setIsDeletingTopic(true);
    const res = await deleteTopic(slug);
    setIsDeletingTopic(false);
    if (res?.error) {
        toast.error(res.error);
    } else {
        toast.success(t('categories.deleted'));
        router.refresh();
    }
}

// handleDelete — After
async function handleDelete(slug: string) {
    setIsDeletingTopic(true);
    try {
        const res = await deleteTopic(slug);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.deleted'));
            router.refresh();
        }
    } finally {
        setIsDeletingTopic(false);
    }
}

// handleDeleteAlias — same pattern
```

### Step 4: C18-04 — Fix handleDelete missing try/finally in tag-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, lines 65-75

```tsx
// Before
async function handleDelete(id: number) {
    setIsDeleting(true);
    const res = await deleteTag(id);
    setIsDeleting(false);
    if (res?.error) {
        toast.error(res.error);
    } else {
        toast.success(t('tags.deleted'));
        router.refresh();
    }
}

// After
async function handleDelete(id: number) {
    setIsDeleting(true);
    try {
        const res = await deleteTag(id);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('tags.deleted'));
            router.refresh();
        }
    } finally {
        setIsDeleting(false);
    }
}
```

### Step 5: C18-05 — Roll back upload tracker on early returns in uploadImages

**File:** `apps/web/src/app/actions/images.ts`, lines 112-126

After pre-incrementing the tracker, the function returns early if topic is missing or has invalid format, but the tracker still holds the pre-incremented values. Need to roll back before returning.

```ts
// Before (lines 121-126)
if (!topic) return { error: t('topicRequired') };

// Validate topic slug format
if (!isValidSlug(topic)) {
    return { error: t('invalidTopicFormat') };
}

// After
if (!topic) {
    tracker.bytes = originalTrackerBytes;
    tracker.count = originalTrackerCount;
    uploadTracker.set(uploadIp, tracker);
    return { error: t('topicRequired') };
}

// Validate topic slug format
if (!isValidSlug(topic)) {
    tracker.bytes = originalTrackerBytes;
    tracker.count = originalTrackerCount;
    uploadTracker.set(uploadIp, tracker);
    return { error: t('invalidTopicFormat') };
}
```

### Step 6: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/admin-user-manager.tsx` — fix handleCreate try/finally
- `apps/web/src/components/image-manager.tsx` — fix handleDelete try/finally
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` — fix handleDelete/handleDeleteAlias try/finally
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` — fix handleDelete try/finally
- `apps/web/src/app/actions/images.ts` — roll back upload tracker on early return

## Risk Assessment

- **Risk:** VERY LOW — All changes are small, targeted improvements. The try/finally pattern is already used elsewhere in the same codebase (image-manager handleBulkDelete, handleShare, handleSaveEdit). The upload tracker rollback is defensive — the early returns require the client to send invalid data, which is already validated client-side.
