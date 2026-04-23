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

### C24-04: `deleteTopic` logs audit event unconditionally when 0 rows deleted [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/topics.ts`, lines 200-213
- **Description**: Same pattern as C22-02 (fixed for `deleteTag`) and C23-03 (fixed for `deleteTopicAlias`). The `deleteTopic` function calls `tx.delete(topics)` at line 207 inside a transaction but does not capture `affectedRows`. If two admins delete the same topic concurrently, both transactions succeed (one deletes 1 row, the other 0) and both log `topic_delete` audit events, creating a misleading duplicate entry.
- **Concrete failure scenario**: Two admins delete the same topic simultaneously. Both pass the HAS_IMAGES check. Both `tx.delete()` calls succeed. Both log audit events. One is a phantom log for a no-op delete.
- **Fix**: Capture `affectedRows` from the `tx.delete()` result. Only log the audit event when `affectedRows > 0`, matching the pattern used in `deleteTag` (tags.ts line 99), `deleteImage` (images.ts line 362), and `deleteTopicAlias` (topics.ts line 294).

### C24-05: `updateTag` does not apply `stripControlChars` to name input [LOW] [MEDIUM confidence]
- **File**: `apps/web/src/app/actions/tags.ts`, lines 41-78
- **Description**: The `name` parameter in `updateTag` is user-facing input stored in the database. It goes through `isValidTagName()` validation and `trim()`, but is not sanitized with `stripControlChars()`. This is the same class of issue as C17-02/C17-03 (fixed for SEO and gallery settings) and C23-04 (fixed for topic labels). A tag name containing control characters in the 0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F range could bypass `isValidTagName()` (which only rejects `\x00`, `<`, `>`, `"`, `'`, `&`) and cause MySQL truncation or display issues.
- **Concrete failure scenario**: Admin edits a tag name with embedded control characters via API or malformed form submission. The `isValidTagName()` regex allows these characters. The name is stored as-is, potentially causing truncation or garbled display.
- **Fix**: Import `stripControlChars` from `@/lib/sanitize` and apply it to the `name` value before trimming and validation. Same pattern as `updateTopic` (topics.ts line 107).

---

## PREVIOUSLY FIXED -- Confirmed Resolved This Cycle

All cycle 1-23 findings remain resolved. No regressions detected. Additionally, the initial C24-01 through C24-03 findings from this cycle have already been resolved:

- C24-01 (`handleBulkDelete` uses `selectedIds` in filter): **RESOLVED** -- `const deletedIdSet = new Set(ids)` at image-manager.tsx line 136.
- C24-02 (Password form autoComplete): **RESOLVED** -- `autoComplete="current-password"` and `autoComplete="new-password"` present at password-form.tsx lines 68, 82, 98.
- C24-03 (Admin-user-manager delete loading state): **RESOLVED** -- `isDeleting` state with `disabled={isDeleting}` at admin-user-manager.tsx line 173.

---

## NOT A BUG / LOW PRIORITY

- `handleShare` in image-manager.tsx correctly captures `ids = Array.from(selectedIds)` and uses `selectedIds` only for the `setSelectedIds(new Set())` reset. The share handler is consistent and correct.
- `searchImagesAction` in public.ts increments the in-memory rate limit before the DB check (TOCTOU fix). The slight overcounting is intentional and acceptable.
- `uploadImages` in images.ts pre-increments the upload tracker and rolls back on validation failures. The rollback paths are correct and symmetric.

---

## DEFERRED CARRY-FORWARD

All previously deferred items remain unchanged and are carried forward:

- C21-03: `x-forwarded-proto` spoofing risk (deployment-dependent)
- C22-03: `deleteGroupShareLink` stale key fetch (negligible impact)
- C32-03: Insertion-order eviction in Maps (also CRI-38-01 DRY concern)
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- StorageBackend integration items (C6R2-F01 through C6R2-F14)
- C15-02: `createPhotoShareLink` does not validate image ownership
- C4-F02 / C6-F04: Admin checkboxes use native `<input>`
- C4-F03: `isReservedTopicRouteSegment` rarely used
- C4-F05: `loadMoreImages` offset cap may allow expensive tag queries
- C4-F06: `processImageFormats` creates 3 sharp instances (informational)
- C6-F03: Missing E2E tests for upload pipeline

---

## TOTALS

- **0 CRITICAL** findings
- **0 MEDIUM** findings
- **2 LOW** findings (actionable: C24-04, C24-05)
- **2 total** new findings
