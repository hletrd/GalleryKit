# Plan 42: Auth Session Transaction Safety and Minor Fixes

**Priority:** P2 (MEDIUM + LOW severity fixes)
**Sources:** C6-07, C6-01, C6-02, C6-04, C6-05, C6-06, C6-08, C6-10
**Status:** DONE

---

## C6-07: Session fixation prevention not in explicit transaction

**File:** `apps/web/src/app/actions/auth.ts` lines 150-160
**Problem:** The session insert and the "delete other sessions" are separate DB calls without an explicit transaction. In the astronomically unlikely event of a session ID hash collision, both the old and new sessions could be deleted.

**Fix:** Wrap the insert + delete in an explicit `db.transaction()`. Check that the insert succeeded before deleting other sessions.

**Implementation:**
```typescript
await db.transaction(async (tx) => {
    await tx.insert(sessions).values({
        id: hashSessionToken(sessionToken),
        userId: user.id,
        expiresAt: expiresAt
    });

    await tx.delete(sessions).where(and(
        eq(sessions.userId, user.id),
        sql`${sessions.id} != ${hashSessionToken(sessionToken)}`
    ));
});
```

---

## C6-01: Keyboard handler contentEditable guard (future-proofing)

**File:** `apps/web/src/components/photo-viewer.tsx`, `apps/web/src/components/lightbox.tsx`
**Problem:** Keyboard handlers check `HTMLInputElement` and `HTMLTextAreaElement` but not `contentEditable` or `[role="textbox"]`.

**Fix:** Add a helper function and use it in both handlers.

```typescript
function isEditableTarget(e: KeyboardEvent): boolean {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    if (target instanceof HTMLElement && target.getAttribute('role') === 'textbox') return true;
    return false;
}
```

---

## C6-02: Raw `<input>` → `<Input>` component in image-manager batch tag dialog

**File:** `apps/web/src/components/image-manager.tsx` lines 213-221
**Fix:**
1. Replace `<input>` with `<Input>` component from `@/components/ui/input`
2. Add `e.preventDefault()` in the `onKeyDown` handler for Enter key

---

## C6-04: Delete action loading state feedback in topic/tag managers

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` lines 79-87, 196
**File:** `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` lines 64-72, 128
**Fix:** Add `isDeleting` state variable. Disable the AlertDialogAction button and show "Deleting..." text while deletion is in progress.

---

## C6-05: Move view count increment after image fetch

**File:** `apps/web/src/lib/data.ts` lines 406-431
**Fix:** Move `bufferGroupViewCount(group.id)` call from line 430 to after the groupImages query succeeds (after line 446).

---

## C6-06: Empty blur buffer guard

**File:** `apps/web/src/lib/process-image.ts` lines 255-263
**Fix:** Add `blurBuffer.length > 0` check before constructing the data URL.

```typescript
if (blurBuffer.length > 0) {
    blurDataUrl = `data:image/jpeg;base64,${blurBuffer.toString('base64')}`;
}
```

---

## C6-08: Remove hardcoded 'admin' username check

**File:** `apps/web/src/components/admin-user-manager.tsx` line 123
**Fix:** Remove the `disabled={user.username === 'admin'}` check. The server-side last-admin check is the correct guard. The client-side check is misleading for renamed default admins or secondary admins named 'admin'.

---

## C6-10: Document queue bootstrap behavior

**File:** No code change — documentation note for CLAUDE.md or operator docs.
**Fix:** Add a note that the processing queue re-enqueues all unprocessed images on server restart, processing them at the configured `QUEUE_CONCURRENCY`. This is by design but should be documented for operational awareness.

---

## Progress

- [x] C6-07: Wrap session insert + delete in transaction — commit c55e085
- [x] C6-01: Add isEditableTarget helper for keyboard handlers — commit 7840919
- [x] C6-02: Replace raw input with Input component — commit cc8a5e1
- [x] C6-04: Add delete loading state to topic/tag managers — commit 64edcce
- [x] C6-05: Move view count buffer after image fetch — commit 97b285d
- [x] C6-06: Add blur buffer size check — commit a524aeb
- [x] C6-08: Remove hardcoded admin username check — commit 60d1374
- [ ] C6-10: Document queue bootstrap behavior (deferred to Plan 43)
