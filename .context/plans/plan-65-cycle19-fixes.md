# Plan 65 — Cycle 19 Fixes (C19-01 through C19-05)

**Created:** 2026-04-19 (Cycle 19)
**Status:** DONE
**Severity:** 5 LOW

---

## Problem

Five issues identified in the cycle 19 comprehensive review. All are the same class: async handler functions that check for `{ error }` return values from server actions but don't guard against thrown exceptions. If the server action throws (network error, infrastructure failure), the user gets no error feedback. Two of the five also have missing `try/finally` for state reset.

---

## Implementation Steps

### Step 1: C19-01 — Add try/catch to handleDelete in admin-user-manager.tsx

**File:** `apps/web/src/components/admin-user-manager.tsx`, lines 50-59

```tsx
// Before
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

// After
async function handleDelete(id: number) {
    setDeleteTarget(null);
    try {
        const result = await deleteAdminUser(id);
        if (result.error) {
            toast.error(result.error);
        } else {
            toast.success(t('users.deleteSuccess'));
            router.refresh();
        }
    } catch {
        toast.error(t('users.deleteFailed'));
    }
}
```

Note: Need to add `deleteFailed` key to en.json and ko.json, or reuse an existing key.

### Step 2: C19-02 — Add try/finally to handleUpload in upload-dropzone.tsx

**File:** `apps/web/src/components/upload-dropzone.tsx`, lines 100-192

```tsx
// Before
const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    // ... upload logic ...
    setUploading(false);
    // ... toast logic ...
};

// After
const handleUpload = async () => {
    if (!files.length) return;
    setUploading(true);
    try {
        // ... upload logic ...
        // ... toast logic ...
    } finally {
        setUploading(false);
    }
};
```

The `setUploading(false)` that was at line 166 must move into the `finally` block. The toast logic that follows (lines 168-191) should stay inside the `try` block.

### Step 3: C19-03 — Add try/catch to handleCreate and handleUpdate in topic-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 58-79

```tsx
// handleCreate — After
async function handleCreate(formData: FormData) {
    try {
        const res = await createTopic(formData);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.created'));
            setIsCreateOpen(false);
            router.refresh();
        }
    } catch {
        toast.error(t('failedToCreateTopic'));
    }
}

// handleUpdate — After
async function handleUpdate(formData: FormData) {
    if (!editingTopic) return;
    try {
        const res = await updateTopic(editingTopic.slug, formData);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.updated'));
            setEditingTopic(null);
            router.refresh();
        }
    } catch {
        toast.error(t('serverActions.failedToUpdateTopic'));
    }
}
```

### Step 4: C19-04 — Add try/catch to handleUpdate in tag-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, lines 51-63

```tsx
// After
async function handleUpdate(formData: FormData) {
    if (!editingTag) return;
    const name = formData.get('name') as string;
    try {
        const res = await updateTag(editingTag.id, name);
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('tags.updated'));
            setEditingTag(null);
            router.refresh();
        }
    } catch {
        toast.error(t('serverActions.failedToUpdateTag'));
    }
}
```

### Step 5: C19-05 — Add try/catch to handleAddAlias in topic-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 96-107

```tsx
// After
async function handleAddAlias(topicSlug: string) {
    if (!newAlias.trim()) return;
    try {
        const res = await createTopicAlias(topicSlug, newAlias.trim());
        if (res?.error) {
            toast.error(res.error);
        } else {
            toast.success(t('categories.aliasAdded'));
            setNewAlias('');
            setEditingTopic(prev => prev ? ({ ...prev, aliases: [...prev.aliases, newAlias.trim()] }) : null);
            router.refresh();
        }
    } catch {
        toast.error(t('serverActions.invalidAliasFormat'));
    }
}
```

### Step 6: Add missing i18n key for admin-user-manager deleteFailed

Add `deleteFailed` key to en.json and ko.json under the `users` section if not already present. Check if there's an existing suitable key.

### Step 7: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/admin-user-manager.tsx` — add try/catch to handleDelete
- `apps/web/src/components/upload-dropzone.tsx` — add try/finally to handleUpload
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` — add try/catch to handleCreate, handleUpdate, handleAddAlias
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` — add try/catch to handleUpdate
- `apps/web/messages/en.json` — add any missing i18n keys
- `apps/web/messages/ko.json` — add any missing i18n keys

## Risk Assessment

- **Risk:** VERY LOW — All changes are small, targeted improvements. The try/catch and try/finally patterns are already used extensively in the same codebase. No logic changes, only error handling additions.
