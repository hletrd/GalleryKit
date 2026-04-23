# Comprehensive Code Review — Cycle 20 (2026-04-19)

**Reviewer:** General-purpose agent (multi-angle: code quality, security, performance, UX)
**Scope:** Full repository — 129 TypeScript/TSX files across apps/web/src

---

## Review Inventory

All core files examined:
- `apps/web/src/app/actions.ts` (barrel re-export)
- `apps/web/src/app/actions/auth.ts` — login, logout, updatePassword
- `apps/web/src/app/actions/images.ts` — uploadImages, deleteImage, deleteImages, updateImageMetadata
- `apps/web/src/app/actions/admin-users.ts` — getAdminUsers, createAdminUser, deleteAdminUser
- `apps/web/src/app/actions/sharing.ts` — createPhotoShareLink, createGroupShareLink, revokePhotoShareLink, deleteGroupShareLink
- `apps/web/src/app/actions/topics.ts` — createTopic, updateTopic, deleteTopic, createTopicAlias, deleteTopicAlias
- `apps/web/src/app/actions/tags.ts` — getAdminTags, updateTag, deleteTag, addTagToImage, removeTagFromImage, batchAddTags, batchUpdateImageTags
- `apps/web/src/app/actions/public.ts` — loadMoreImages, searchImagesAction
- `apps/web/src/app/[locale]/admin/db-actions.ts` — dumpDatabase, restoreDatabase, exportImagesCsv
- `apps/web/src/lib/data.ts` — all data access queries
- `apps/web/src/lib/process-image.ts` — Sharp pipeline, EXIF extraction
- `apps/web/src/lib/session.ts` — HMAC session token generation/verification
- `apps/web/src/lib/rate-limit.ts` — in-memory + DB-backed rate limiting
- `apps/web/src/lib/auth-rate-limit.ts` — login/password change rate limiting
- `apps/web/src/lib/validation.ts` — slug/filename/tag/alias validation
- `apps/web/src/lib/image-queue.ts` — PQueue processing with MySQL advisory locks
- `apps/web/src/lib/serve-upload.ts` — secure file serving
- `apps/web/src/lib/api-auth.ts` — API route auth wrapper
- `apps/web/src/lib/sql-restore-scan.ts` — SQL restore safety scanner
- `apps/web/src/proxy.ts` — middleware (i18n + admin auth guard)
- `apps/web/src/db/schema.ts` — full Drizzle schema
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`

---

## Findings

### C20-01: `handleBatchAddTag` in image-manager.tsx has no try/catch for thrown exceptions

**File:** `apps/web/src/components/image-manager.tsx`, lines 162-177
**Severity:** LOW
**Confidence:** HIGH

The `handleBatchAddTag` function calls `batchAddTags()` and checks for `res?.error`, but if the server action throws (network error, infrastructure failure), the user gets no error feedback and `isAddingTag` is never reset because the `finally` block only runs after `setIsAddingTag(false)` which won't execute on an unhandled exception before the `finally`.

Wait — actually, looking again at lines 162-177:

```tsx
const handleBatchAddTag = async () => {
     if (!tagInput.trim()) return;
     setIsAddingTag(true);
     try {
         const res = await batchAddTags(Array.from(selectedIds), tagInput);
         if (res?.success) {
             toast.success(t('imageManager.batchAddSuccess'));
             setTagInput('');
             setSelectedIds(new Set());
         } else {
             toast.error(res?.error || t('imageManager.batchAddFailed'));
         }
     } finally {
         setIsAddingTag(false);
     }
};
```

Actually this already has `try/finally` so the state WILL be reset. But it has no `catch` block, so if `batchAddTags` throws, the user gets no toast notification about the error. The `finally` resets state but the user sees the dialog close with no feedback.

**Fix:** Add a `catch` block with `toast.error(t('imageManager.batchAddFailed'))`.

---

### C20-02: `onTagsChange` callback in image-manager.tsx has no try/catch for thrown exceptions

**File:** `apps/web/src/components/image-manager.tsx`, lines 332-355
**Severity:** LOW
**Confidence:** HIGH

The inline `onTagsChange` callback in the `TagInput` component calls `batchUpdateImageTags()` but has no try/catch. If the server action throws, the user gets no error feedback.

```tsx
onTagsChange={async (newTags) => {
    const oldTags = image.tag_names ? image.tag_names.split(',').filter(Boolean) : [];
    const added = newTags.filter(t => !oldTags.includes(t));
    const removed = oldTags.filter(t => !newTags.includes(t));

    if (added.length === 0 && removed.length === 0) return;

    const res = await batchUpdateImageTags(image.id, added, removed);
    if (res.success) {
        // ...
    } else {
        toast.error(t('imageManager.batchAddFailed'));
    }
}}
```

If `batchUpdateImageTags` throws an exception (network error), the error is unhandled and the UI stays in an inconsistent state with the old tags shown but the TagInput showing the new selection.

**Fix:** Wrap in try/catch with error toast.

---

### C20-03: `handleShare` onClick in photo-viewer.tsx has no loading state guard

**File:** `apps/web/src/components/photo-viewer.tsx`, lines 234-248
**Severity:** LOW
**Confidence:** MEDIUM

The share button's `onClick` handler in `photo-viewer.tsx` calls `createPhotoShareLink` but has no loading/disabled state. If the user clicks rapidly, multiple share links could be created in parallel (though the server-side code handles existing share_key correctly by returning the existing key, so the practical impact is minimal — just wasted requests and potential duplicate toasts).

**Fix:** Add a local `isSharing` state to disable the button during the async operation, similar to how `image-manager.tsx` handles it.

---

### C20-04: `handleDelete` in tag-manager.tsx has no try/catch for thrown errors on `deleteTag`

**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`, lines 68-81
**Severity:** LOW
**Confidence:** HIGH

The `handleDelete` function in `tag-manager.tsx` calls `deleteTag()` and checks for `res?.error`, but if the server action throws, the user gets no error feedback. The `finally` block resets `isDeleting`, but the catch-less error leaves the user with no indication of what went wrong.

```tsx
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

**Fix:** Add a `catch` block with `toast.error(t('serverActions.failedToDeleteTag'))`.

---

### C20-05: `handleDelete` in topic-manager.tsx has no try/catch for thrown errors on `deleteTopic`

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 89-101
**Severity:** LOW
**Confidence:** HIGH

Same pattern as C20-04. The `handleDelete` function calls `deleteTopic()` with a `try/finally` but no `catch`. If the server action throws, the user gets no error feedback.

```tsx
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
```

**Fix:** Add a `catch` block with `toast.error(t('serverActions.failedToDeleteTopic'))`.

---

### C20-06: `handleDeleteAlias` in topic-manager.tsx has no try/catch for thrown errors on `deleteTopicAlias`

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 121-135
**Severity:** LOW
**Confidence:** HIGH

Same pattern as C20-04 and C20-05. `handleDeleteAlias` calls `deleteTopicAlias()` with `try/finally` but no `catch`.

**Fix:** Add a `catch` block with `toast.error(t('serverActions.failedToDeleteAlias'))`.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-19 findings remain resolved. No regressions detected. The try/catch and try/finally patterns added in previous cycles are still in place.

---

## Negative Findings (Looked For, Not Found)

- No XSS vectors: `dangerouslySetInnerHTML` only used with `safeJsonLd()` sanitizer
- No `innerHTML` usage anywhere
- No unsanitized user input in SQL queries (all via Drizzle ORM parameterized queries)
- No path traversal issues (all filenames validated via `isValidFilename`, `SAFE_SEGMENT`, containment checks)
- No symlink issues (both upload routes check `isSymbolicLink()`)
- No timing-safe comparison issues (session tokens use `timingSafeEqual`)
- No missing auth checks (all server actions verify `isAdmin()`, all API routes use `withAdminAuth`)
- No secrets in code (all via env vars)
- No GPS coordinates leak (excluded from public queries per CLAUDE.md)
- No `confirm()` calls remaining (all replaced with AlertDialog)
- Session token validation is constant-time with proper HMAC
- Rate limiting has TOCTOU fixes (pre-increment before expensive Argon2)
- Upload tracker rolls back on early validation failures
- Processing queue has MySQL advisory locks for distributed safety
- DB restore uses advisory lock to prevent concurrent 250MB uploads
- SQL restore scanner validates header and content for dangerous patterns

---

## TOTALS

- **0 CRITICAL** findings
- **0 HIGH** findings
- **0 MEDIUM** findings
- **6 LOW** findings
- **6 total** findings (all LOW)
