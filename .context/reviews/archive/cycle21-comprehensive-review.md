# Comprehensive Code Review — Cycle 21 (2026-04-19)

**Reviewer:** General-purpose agent (multi-angle: code quality, security, performance, UX)
**Scope:** Full repository — 129+ TypeScript/TSX files across apps/web/src

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
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

---

## Findings

### C21-01: `handleDelete` in image-manager.tsx has no try/catch for thrown exceptions

**File:** `apps/web/src/components/image-manager.tsx`, lines 94-112
**Severity:** LOW
**Confidence:** HIGH

The `handleDelete` function calls `deleteImage()` with `try/finally` but no `catch` block. If the server action throws (network error, infrastructure failure), the user gets no error toast notification. The `finally` block correctly resets `deletingId`, but the missing `catch` means the error is silently swallowed — the user sees the delete dialog close with no feedback.

This is the same class of issue as C20-01 through C20-06, which were fixed in cycle 20. This specific handler was overlooked in that sweep because the `try/finally` was added in a prior cycle (for state reset), but the `catch` block for error feedback was not added.

```tsx
const handleDelete = async (id: number) => {
    setDeletingId(id);
    try {
        const res = await deleteImage(id);
        if (res?.success) {
            toast.success(t('imageManager.imageDeleted'));
            // ...
        } else {
            toast.error(t('imageManager.deleteFailed'));
        }
    } finally {
        setDeletingId(null);
    }
};
```

**Fix:** Add a `catch` block with `toast.error(t('imageManager.deleteFailed'))`.

---

### C21-02: `handleCreate` in admin-user-manager.tsx has no try/catch for thrown exceptions

**File:** `apps/web/src/components/admin-user-manager.tsx`, lines 34-48
**Severity:** LOW
**Confidence:** HIGH

The `handleCreate` function calls `createAdminUser()` with `try/finally` but no `catch` block. If the server action throws (network error, infrastructure failure), the user gets no error toast notification. The `finally` block correctly resets `isCreating`, but the missing `catch` means the error is silently swallowed — the user sees the create dialog with the button re-enabled and no feedback.

This is the same class of issue as C21-01 and the cycle 20 findings.

```tsx
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

**Fix:** Add a `catch` block with `toast.error(t('serverActions.failedToCreateUser'))`.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-20 findings remain resolved. No regressions detected. The try/catch and try/finally patterns added in previous cycles are still in place.

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
- i18n keys are in sync between en.json and ko.json

---

## TOTALS

- **0 CRITICAL** findings
- **0 HIGH** findings
- **0 MEDIUM** findings
- **2 LOW** findings
- **2 total** findings (all LOW)
