# Plan 66 — Cycle 20 Fixes (C20-01 through C20-06)

**Created:** 2026-04-19 (Cycle 20)
**Status:** DONE
**Severity:** 6 LOW

---

## Problem

Six issues identified in the cycle 20 comprehensive review. All are the same class: async handler functions that have `try/finally` (or no try at all) but no `catch` block. If the server action throws (network error, infrastructure failure), the user gets no error toast notification. The `finally` blocks correctly reset loading state, but the missing `catch` means the error is silently swallowed.

---

## Implementation Steps

### Step 1: C20-01 — Add catch to handleBatchAddTag in image-manager.tsx

**File:** `apps/web/src/components/image-manager.tsx`, lines 162-177

```tsx
// Before
try {
    const res = await batchAddTags(Array.from(selectedIds), tagInput);
    // ...
} finally {
    setIsAddingTag(false);
}

// After
try {
    const res = await batchAddTags(Array.from(selectedIds), tagInput);
    // ...
} catch {
    toast.error(t('imageManager.batchAddFailed'));
} finally {
    setIsAddingTag(false);
}
```

### Step 2: C20-02 — Add try/catch to onTagsChange callback in image-manager.tsx

**File:** `apps/web/src/components/image-manager.tsx`, lines 332-355

```tsx
// Before
onTagsChange={async (newTags) => {
    // ...
    const res = await batchUpdateImageTags(image.id, added, removed);
    if (res.success) {
        // ...
    } else {
        toast.error(t('imageManager.batchAddFailed'));
    }
}}

// After
onTagsChange={async (newTags) => {
    // ...
    try {
        const res = await batchUpdateImageTags(image.id, added, removed);
        if (res.success) {
            // ...
        } else {
            toast.error(t('imageManager.batchAddFailed'));
        }
    } catch {
        toast.error(t('imageManager.batchAddFailed'));
    }
}}
```

### Step 3: C20-03 — Add loading state guard to share button in photo-viewer.tsx

**File:** `apps/web/src/components/photo-viewer.tsx`, lines 234-248

Add a `isSharingPhoto` state variable, set it to true before calling `createPhotoShareLink`, disable the button during operation, and reset in `finally`.

```tsx
// Add state
const [isSharingPhoto, setIsSharingPhoto] = useState(false);

// Updated onClick
onClick={async () => {
    if (isSharingPhoto) return;
    setIsSharingPhoto(true);
    try {
        const result = await createPhotoShareLink(image.id);
        if (result.success) {
            const url = localizeUrl(window.location.origin, locale, `/s/${result.key}`);
            await copyToClipboard(url);
            toast.success(t('viewer.linkCopied'));
        } else {
            toast.error(result.error || t('viewer.errorSharing'));
        }
    } catch {
        toast.error(t('viewer.errorSharing'));
    } finally {
        setIsSharingPhoto(false);
    }
}}

// Add disabled to button
disabled={isSharingPhoto}
```

### Step 4: C20-04 — Add catch to handleDelete in tag-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, lines 68-81

```tsx
// Before
try {
    const res = await deleteTag(id);
    // ...
} finally {
    setIsDeleting(false);
}

// After
try {
    const res = await deleteTag(id);
    // ...
} catch {
    toast.error(t('serverActions.failedToDeleteTag'));
} finally {
    setIsDeleting(false);
}
```

### Step 5: C20-05 — Add catch to handleDelete in topic-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 89-101

```tsx
// Before
try {
    const res = await deleteTopic(slug);
    // ...
} finally {
    setIsDeletingTopic(false);
}

// After
try {
    const res = await deleteTopic(slug);
    // ...
} catch {
    toast.error(t('serverActions.failedToDeleteTopic'));
} finally {
    setIsDeletingTopic(false);
}
```

### Step 6: C20-06 — Add catch to handleDeleteAlias in topic-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 121-135

```tsx
// Before
try {
    const res = await deleteTopicAlias(topicSlug, alias);
    // ...
} finally {
    setIsDeletingAlias(false);
}

// After
try {
    const res = await deleteTopicAlias(topicSlug, alias);
    // ...
} catch {
    toast.error(t('serverActions.failedToDeleteAlias'));
} finally {
    setIsDeletingAlias(false);
}
```

### Step 7: Add missing i18n key `failedToDeleteAlias`

Add `failedToDeleteAlias` key to en.json and ko.json under the `serverActions` section.

### Step 8: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/image-manager.tsx` — add catch blocks to handleBatchAddTag and onTagsChange
- `apps/web/src/components/photo-viewer.tsx` — add isSharingPhoto state and try/catch/finally to share button
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` — add catch to handleDelete
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` — add catch to handleDelete and handleDeleteAlias
- `apps/web/messages/en.json` — add `failedToDeleteAlias` key
- `apps/web/messages/ko.json` — add `failedToDeleteAlias` key

## Risk Assessment

- **Risk:** VERY LOW — All changes are small, targeted improvements. The try/catch pattern is already used extensively in the same codebase. No logic changes, only error handling additions.
