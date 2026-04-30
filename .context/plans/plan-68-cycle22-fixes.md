# Plan 68 — Cycle 22 Fixes (C22-03, C22-05, C22-02)

**Created:** 2026-04-19 (Cycle 22)
**Status:** DONE
**Severity:** 3 LOW

---

## Problem

Three LOW-severity issues identified in the cycle 22 comprehensive review:

1. **C22-03**: `handleUpload` in `upload-dropzone.tsx` has `try/finally` but no `catch` — if the outer upload loop throws unexpectedly, the user gets no error toast.

2. **C22-05**: Restore confirmation dialog in `db/page.tsx` has both Cancel and Action buttons labeled "Restore". The Cancel button should say "Cancel".

3. **C22-02**: `handleAddAlias` in `topic-manager.tsx` lacks loading state protection — rapid double-clicks could fire duplicate `createTopicAlias` requests.

---

## Implementation Steps

### Step 1: C22-03 — Add catch block to handleUpload in upload-dropzone.tsx

**File:** `apps/web/src/components/upload-dropzone.tsx`, lines 106-193

Add a `catch` block with a generic error toast to the outer `try/finally`:

```tsx
// Before
try {
    // ... upload logic ...
} finally {
    setUploading(false);
}

// After
try {
    // ... upload logic ...
} catch {
    toast.error(t('upload.failed'));
} finally {
    setUploading(false);
}
```

Also add `"failed": "Upload failed."` to the `upload` section in `en.json` and `ko.json`.

### Step 2: C22-05 — Fix restore dialog Cancel button label in db/page.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, line 191

Change the AlertDialogCancel label from `t('restoreButton')` to `t('imageManager.cancel')` (which maps to "Cancel" and is already used by other cancel buttons in the codebase):

```tsx
// Before
<AlertDialogCancel>{t('restoreButton')}</AlertDialogCancel>

// After
<AlertDialogCancel>{t('imageManager.cancel')}</AlertDialogCancel>
```

Note: `imageManager.cancel` = "Cancel" is already available in the translation files. Alternatively, add a `db.cancel` key, but reusing the existing one is simpler and consistent.

### Step 3: C22-02 — Add loading state to handleAddAlias in topic-manager.tsx

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`

Add `isAddingAlias` state variable:

```tsx
const [isAddingAlias, setIsAddingAlias] = useState(false);
```

Wrap `handleAddAlias` with loading state:

```tsx
async function handleAddAlias(topicSlug: string) {
    if (!newAlias.trim() || isAddingAlias) return;
    setIsAddingAlias(true);
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
    } finally {
        setIsAddingAlias(false);
    }
}
```

Disable the Add button during operation:

```tsx
<Button type="button" variant="secondary" onClick={() => handleAddAlias(editingTopic.slug)} disabled={isAddingAlias}>
    {isAddingAlias ? t('imageManager.adding') : t('categories.add')}
</Button>
```

Also disable Enter key handler when already adding:

```tsx
onKeyDown={(e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (!isAddingAlias) handleAddAlias(editingTopic.slug);
    }
}}
```

Note: `imageManager.adding` is already in the translation files.

### Step 4: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/components/upload-dropzone.tsx` — add catch block to handleUpload
- `apps/web/messages/en.json` — add `upload.failed` key
- `apps/web/messages/ko.json` — add `upload.failed` key
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx` — fix Cancel button label
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` — add isAddingAlias loading state

## Risk Assessment

- **Risk:** VERY LOW — All changes are small, targeted improvements. No logic changes, only error handling and UX fixes.
