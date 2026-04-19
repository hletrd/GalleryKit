# Cycle 23 Comprehensive Review (2026-04-19)

**Reviewer:** multi-angle comprehensive review
**Scope:** Full codebase — server actions, data layer, UI components, security, performance, i18n

---

## Methodology

Reviewed all server action modules, data layer, image processing pipeline, rate limiting, session management, middleware, UI components, translation files, and cross-file interactions. Searched for: logic bugs, missed edge cases, race conditions, error-handling gaps, security weaknesses, performance issues, i18n gaps, and documentation-code mismatches. This is cycle 23; cycles 1-22 have already addressed most issues, so this review focuses on remaining gaps and regressions.

---

## Findings

### C23-01: `handleBatchAddTag` in image-manager.tsx allows Enter key submission while `isAddingTag` is true
**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/components/image-manager.tsx`, lines 228-231

The `onKeyDown` handler for the batch-tag input fires `handleBatchAddTag()` on Enter press without checking `isAddingTag`. While `handleBatchAddTag()` itself checks `if (!tagInput.trim()) return;`, it does NOT check `isAddingTag` before setting it. This means rapid Enter presses could fire multiple `batchAddTags` server actions concurrently.

**Concrete scenario:** User types a tag name and presses Enter twice quickly. Two `batchAddTags` calls fire, potentially adding duplicate tag associations (though `INSERT IGNORE` prevents actual DB duplication, the user sees duplicate success toasts).

**Fix:** Add `isAddingTag` guard to the `onKeyDown` handler:
```tsx
onKeyDown={(e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        if (!isAddingTag) handleBatchAddTag();
    }
}}
```

---

### C23-02: `handleBulkDelete` in image-manager.tsx lacks loading state guard on `AlertDialogAction`
**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/components/image-manager.tsx`, line 268

The bulk delete `AlertDialogAction` calls `handleBulkDelete` but does not disable the button during the operation. If `isBulkDeleting` is true, the button is not disabled (unlike the single-delete case on line 389 which checks `deletingId === image.id`). The user could click the "Delete" button in the confirmation dialog multiple times.

**Concrete scenario:** User clicks "Delete" in the bulk-delete confirmation dialog, and the server action takes a few seconds. User clicks "Delete" again. Two `handleBulkDelete` calls fire, both reading `selectedIds` and calling `deleteImages` twice.

**Fix:** Add `disabled={isBulkDeleting}` to the bulk-delete `AlertDialogAction`:
```tsx
<AlertDialogAction onClick={handleBulkDelete} disabled={isBulkDeleting}>
    {isBulkDeleting ? t('imageManager.deleting') : t('imageManager.delete')}
</AlertDialogAction>
```

---

### C23-03: `processTopicImage` temp file not cleaned on Sharp processing error if `pipeline` succeeds but Sharp fails
**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/lib/process-topic-image.ts`, lines 64-80

When `pipeline` (streaming the uploaded file to disk) succeeds but `sharp(tempPath).resize().toFile(outputPath)` throws, the catch block correctly unlinks both `tempPath` and `outputPath`. However, if Sharp succeeds but the function throws BEFORE `await fs.unlink(tempPath)` on line 75 (which currently cannot happen because the only statement between Sharp and unlink is the unlink itself), the temp file would leak. The current code is actually correct — this is just a note that the ordering is safe as-is.

**Verdict:** Not a bug — the catch block handles both cleanup paths correctly.

---

### C23-04: `db/page.tsx` restore dialog Cancel button uses `t('cancel')` instead of `t('imageManager.cancel')`
**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, line 191

The restore confirmation dialog Cancel button uses `t('cancel')` from the `db` namespace, while every other Cancel button in the admin area uses `t('imageManager.cancel')`. This is consistent within the `db` namespace (the `db.cancel` key exists and equals "Cancel"), but it creates an inconsistency across the admin UI. Other admin pages (image-manager, topic-manager, tag-manager, admin-user-manager) all reference `imageManager.cancel`.

**Concrete scenario:** If a developer removes the `db.cancel` key thinking all Cancel buttons use `imageManager.cancel`, the restore dialog would show the raw key instead of "Cancel".

**Fix:** Change to `t('imageManager.cancel')` for consistency with the rest of the admin UI, or keep as-is if the `db` namespace is intentionally self-contained. Low priority — both keys resolve to "Cancel".

---

### C23-05: `search.tsx` search overlay has no `role="dialog"` on mobile full-screen mode
**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/components/search.tsx`, line 121

The search overlay uses `role="dialog"` and `aria-modal="true"` on the same element for both mobile (full-screen) and desktop (centered dropdown) layouts. On mobile, the dialog covers the entire viewport, which is correct. However, the search results list uses `role="listbox"` with `id="search-results"` and the input uses `aria-controls="search-results"`, which is correct. The accessibility structure looks sound.

**Verdict:** Not a bug — the ARIA structure is correct.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-22 findings remain resolved. No regressions detected. Specifically confirmed:
- C22-03: `handleUpload` catch block is present (upload-dropzone.tsx line 191)
- C22-05: Restore dialog Cancel button uses `t('cancel')` (db/page.tsx line 191) — note C23-04 above about namespace inconsistency
- C22-02: `handleAddAlias` loading state is present (topic-manager.tsx line 57, 108, 281, 286)

---

## Deferred Carry-Forward

All 17+2 previously deferred items from cycles 5-22 remain deferred with no change in status.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **2 LOW** findings (actionable: C23-01, C23-02)
- **3 LOW** findings (not-a-bug / low-priority: C23-03, C23-04, C23-05)
- **5 total** findings
