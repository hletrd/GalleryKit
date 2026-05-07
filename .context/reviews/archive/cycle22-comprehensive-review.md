# Cycle 22 Comprehensive Review (2026-04-19)

**Reviewer:** multi-angle comprehensive review
**Scope:** Full codebase — server actions, data layer, UI components, security, performance

---

## Methodology

Reviewed all server action modules, data layer, image processing pipeline, rate limiting, session management, middleware, UI components, and cross-file interactions. Searched for: logic bugs, missed edge cases, race conditions, error-handling gaps, security weaknesses, performance issues, and documentation-code mismatches.

---

## Findings

### C22-01: `handleCreate` and `handleUpdate` in topic-manager.tsx lack `finally` block to reset loading state
**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 58-71 and 73-86

`handleCreate` and `handleUpdate` use `try/catch` but have no `finally` block. While they don't explicitly set a loading boolean before the async call, `handleDelete` (line 89) and `handleDeleteAlias` (line 123) both use `isDeletingTopic`/`isDeletingAlias` state with `finally` to reset. `handleCreate` and `handleUpdate` use `isCreateOpen`/`setEditingTopic` for their UI state, which is set before the try block in `handleCreate` (via the Dialog `open` prop) and in `handleUpdate` the dialog stays open until success. If the server action throws or the network fails, the user sees no feedback that something went wrong — the toast fires in the catch, but the dialog remains in whatever state it was. This is consistent with how the other handlers work (they also close the dialog on success only), so the behavior is acceptable, but noting for completeness.

**Verdict:** Not a bug — the behavior is intentional (dialog closes on success, stays open on error so user can retry). The catch blocks show error toasts. Consistent with the rest of the codebase.

---

### C22-02: `handleAddAlias` in topic-manager.tsx lacks loading state protection
**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, lines 106-121

`handleAddAlias` has no loading state guard. If the user double-clicks the "Add" button or presses Enter rapidly, multiple `createTopicAlias` calls could fire concurrently, potentially causing duplicate alias insertion attempts. The server-side `INSERT` with `ER_DUP_ENTRY` catch prevents actual duplication, but it could result in confusing error toasts ("alias already exists") to the user.

**Concrete scenario:** User types an alias and double-clicks the Add button quickly. Two server actions fire, one succeeds and one returns "alias already exists" error toast.

**Fix:** Add an `isAddingAlias` state variable, set it to true before the async call, disable the button during operation, and reset in `finally`.

---

### C22-03: `upload-dropzone.tsx` `handleUpload` missing catch block on outer try/finally
**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/components/upload-dropzone.tsx`, lines 106-193

The `handleUpload` function has a `try { ... } finally { setUploading(false) }` pattern but no `catch` block on the outer try. If an unexpected error is thrown from the upload loop (not from individual `uploadFile` calls, which have their own try/catch), the error would propagate unhandled. The `finally` correctly resets `uploading`, but the user gets no error toast.

**Concrete scenario:** If `Promise.race(inFlight)` or `Promise.all(inFlight)` throws an unexpected error (e.g., a non-Error rejection from the concurrency queue), the error is silently swallowed.

**Fix:** Add a `catch` block with a generic error toast:
```tsx
} catch {
    toast.error(t('upload.failed'));
} finally {
    setUploading(false);
}
```

---

### C22-04: `searchImagesAction` in-memory counter can exceed `SEARCH_MAX_REQUESTS` by one
**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/app/actions/public.ts`, lines 24-88

The search rate limiter increments the in-memory counter *before* checking the DB-backed limit (line 55-59). The DB check at line 62-69 runs after the increment. If the in-memory counter is at `SEARCH_MAX_REQUESTS - 1` and two concurrent requests arrive simultaneously, both could pass the in-memory check (since neither has incremented yet at the point of the check on line 48), both increment (reaching `SEARCH_MAX_REQUESTS + 1`), and both proceed. This is a minor TOCTOU in the in-memory fast-path.

**Concrete scenario:** Two search requests from the same IP arrive simultaneously when the in-memory counter is at 29 (limit is 30). Both see `count < 30`, both increment, counter reaches 31. One extra request is allowed through.

**Impact:** Very low — the DB-backed check provides the authoritative count, and the overage is at most 1 request per concurrent burst.

**Fix:** Not worth the complexity for a 1-request overage on a non-critical rate limit. The DB check is the source of truth.

---

### C22-05: `db/page.tsx` confirmRestore `AlertDialogAction` and `AlertDialogCancel` share the same label
**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`, lines 191-193

Both the Cancel and Action buttons in the restore confirmation dialog display `t('restoreButton')` as their text. The cancel button should display a "Cancel" label, not "Restore". This is confusing for the user — both buttons say "Restore".

**Concrete scenario:** User clicks "Restore" and sees a confirmation dialog with two buttons, both labeled "Restore". They have to guess which one cancels and which one confirms.

**Fix:** Change the AlertDialogCancel label to `t('common.cancel')` or add a dedicated translation key.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-21 findings remain resolved. No regressions detected.

---

## Deferred Carry-Forward

All 17 previously deferred items from cycles 5-16 remain deferred with no change in status.

---

## TOTALS

- **0 CRITICAL/HIGH** findings
- **0 MEDIUM** findings
- **5 LOW** findings (2 new actionable: C22-03, C22-05; 1 minor: C22-02; 1 not-a-bug: C22-01; 1 not-worth-fixing: C22-04)
