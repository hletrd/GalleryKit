# Plan 39: Confirm Dialog Consistency and InsertId Guard

**Priority:** P1 (MEDIUM)
**Estimated effort:** 1 hour
**Sources:** C5-01, C5-02, C5-03, C5-06
**Status:** COMPLETE

---

## 1. Replace `confirm()` with AlertDialog in `topic-manager.tsx` [C5-01] ✅

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` line 68
**Severity:** MEDIUM, Confidence: HIGH

Replace `if (!confirm(t('categories.deleteConfirm'))) return;` in `handleDelete` with an AlertDialog component pattern matching `image-manager.tsx` and `db/page.tsx`:

- Add `useState<boolean>` for `showDeleteConfirm` and `deletingSlug` state
- Replace the `confirm()` call with setting state to show AlertDialog
- Add AlertDialog component to the JSX (same pattern as image-manager delete)
- The AlertDialogAction triggers the actual delete

---

## 2. Replace `confirm()` with AlertDialog in `tag-manager.tsx` [C5-01] ✅

**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` line 55
**Severity:** MEDIUM, Confidence: HIGH

Same pattern as #1 — replace `if (!confirm(t('tags.deleteConfirm'))) return;` in `handleDelete` with AlertDialog.

---

## 3. Add `Number.isFinite` guard for `insertId` in `images.ts` [C5-02] ✅

**File:** `apps/web/src/app/actions/images.ts` line 160
**Severity:** MEDIUM, Confidence: HIGH

```ts
// Before:
const insertedImage = { id: Number(result.insertId), ...insertValues };

// After:
const insertedId = Number(result.insertId);
if (!Number.isFinite(insertedId) || insertedId <= 0) {
    console.error(`Invalid insertId for file: ${file.name}`);
    failedFiles.push(file.name);
    continue;
}
const insertedImage = { id: insertedId, ...insertValues };
```

This matches the pattern already in `admin-users.ts:44-45` and `sharing.ts:149-150`.

---

## 4. Use `bufferGroupViewCount` in flush error handler to enforce cap [C5-03] ✅

**File:** `apps/web/src/lib/data.ts` lines 33-36
**Severity:** LOW, Confidence: MEDIUM

```ts
// Before:
.catch(() => {
    // Re-buffer failed increment for next flush
    viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count);
})

// After:
.catch(() => {
    // Re-buffer failed increment for next flush (respects hard cap)
    bufferGroupViewCount(groupId);
})
```

Note: `bufferGroupViewCount` adds 1 at a time, but the re-buffered `count` could be >1. To preserve the exact count while respecting the cap, we need to adjust the approach:

```ts
.catch(() => {
    // Re-buffer failed increment for next flush, respecting hard cap
    if (viewCountBuffer.size < MAX_VIEW_COUNT_BUFFER_SIZE || viewCountBuffer.has(groupId)) {
        viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count);
    } else {
        console.warn(`[viewCount] Buffer at capacity during re-buffer, dropping ${count} views for group ${groupId}`);
    }
})
```

This preserves the exact count while enforcing the hard cap.

---

## 5. Add confirmation for alias deletion in `topic-manager.tsx` [C5-06] ✅

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` lines 205-210
**Severity:** LOW, Confidence: MEDIUM

Add a simple confirmation step (toast with undo, or AlertDialog) before deleting a topic alias. Since alias deletion is less destructive than topic deletion, a simpler approach is acceptable — but some confirmation is warranted because shared links referencing the alias would break.

Since we're already adding AlertDialog infrastructure for topic deletion (#1), we can reuse it with a simpler "Are you sure?" pattern for alias deletion.

---

## Verification

After implementation:
- No `confirm()` calls should remain in the codebase (`grep -r 'confirm(' apps/web/src/`)
- All `Number(result.insertId)` usages should have `Number.isFinite` guards
- The `viewCountBuffer` re-buffer path should respect the hard cap
