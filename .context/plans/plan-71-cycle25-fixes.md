# Plan 71 — Cycle 25 Fixes (C25-01, C25-02, C25-03, C25-04, C25-05)

**Created:** 2026-04-19 (Cycle 25)
**Status:** DONE
**Severity:** 1 MEDIUM, 4 LOW

---

## Problem

Five issues identified in the cycle 25 comprehensive review:

1. **C25-01 (MEDIUM)**: `deleteGroupShareLink` does not revalidate shared group page paths — cached `/g/{key}` pages serve stale content after group deletion.

2. **C25-02 (LOW)**: `revokePhotoShareLink` does not revalidate the shared link page `/s/{key}` — cached shared page could continue showing photo after share revocation.

3. **C25-03 (LOW)**: `searchImages` uses non-deterministic sort (only `created_at DESC`, missing `id DESC` tiebreaker) — inconsistent result ordering for equal timestamps.

4. **C25-04 (LOW)**: `flushGroupViewCounts` has no guard against concurrent flush calls — re-buffered entries from a failed flush could be double-counted if a second flush runs concurrently.

5. **C25-05 (LOW)**: `admin-user-manager.tsx` create user password input missing `autoComplete="new-password"` — same class of issue as C24-02.

---

## Implementation Steps

### Step 1: C25-01 — Add revalidation to deleteGroupShareLink

**File:** `apps/web/src/app/actions/sharing.ts`, lines 209-226

Before deletion, fetch the group's key so we can revalidate the shared group page. After deletion, revalidate the group page path:

```ts
export async function deleteGroupShareLink(groupId: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return { error: t('invalidGroupId') };
    }

    // Fetch group key before deletion for cache revalidation
    const [group] = await db.select({ key: sharedGroups.key }).from(sharedGroups).where(eq(sharedGroups.id, groupId));
    if (!group) return { error: t('groupNotFound') };

    // sharedGroupImages cascade-deletes via FK
    const [result] = await db.delete(sharedGroups).where(eq(sharedGroups.id, groupId));

    if (result.affectedRows === 0) {
        return { error: t('groupNotFound') };
    }

    revalidateLocalizedPaths('/', `/g/${group.key}`);
    return { success: true };
}
```

### Step 2: C25-02 — Revalidate shared link page when revoking photo share

**File:** `apps/web/src/app/actions/sharing.ts`, lines 185-207

Save the old share key before clearing it, then revalidate `/s/{oldKey}`:

```ts
export async function revokePhotoShareLink(imageId: number) {
    // ... existing validation ...

    const [image] = await db.select({ id: images.id, share_key: images.share_key }).from(images).where(eq(images.id, imageId));
    if (!image) return { error: t('imageNotFound') };
    if (!image.share_key) return { error: t('noActiveShareLink') };

    const oldShareKey = image.share_key; // Save before clearing

    const [result] = await db.update(images)
        .set({ share_key: null })
        .where(eq(images.id, imageId));

    if (result.affectedRows === 0) {
        return { error: t('failedToRevokeShareLink') };
    }

    revalidateLocalizedPaths(`/p/${imageId}`, `/s/${oldShareKey}`);
    return { success: true };
}
```

### Step 3: C25-03 — Add deterministic sort to searchImages

**File:** `apps/web/src/lib/data.ts`, lines 553-574

Add `desc(images.id)` as secondary sort to both the main search query and the tag search query:

```ts
// Main query (line 563):
.orderBy(desc(images.created_at), desc(images.id))

// Tag search query (line 573):
.orderBy(desc(images.created_at), desc(images.id))
```

### Step 4: C25-04 — Add isFlushing guard to flushGroupViewCounts

**File:** `apps/web/src/lib/data.ts`, lines 25-43

Add a module-level `isFlushing` flag to prevent concurrent flushes:

```ts
let isFlushing = false;

async function flushGroupViewCounts() {
    if (isFlushing) return; // Prevent concurrent flush
    isFlushing = true;
    viewCountFlushTimer = null;
    const batch = new Map(viewCountBuffer);
    viewCountBuffer.clear();
    try {
        await Promise.all(
            [...batch].map(([groupId, count]) =>
                db.update(sharedGroups)
                    .set({ view_count: sql`${sharedGroups.view_count} + ${count}` })
                    .where(eq(sharedGroups.id, groupId))
                    .catch(() => {
                        // Re-buffer failed increment for next flush, respecting hard cap
                        if (viewCountBuffer.size < MAX_VIEW_COUNT_BUFFER_SIZE || viewCountBuffer.has(groupId)) {
                            viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count);
                        } else {
                            console.warn(`[viewCount] Buffer at capacity during re-buffer, dropping ${count} views for group ${groupId}`);
                        }
                    })
            )
        );
    } finally {
        isFlushing = false;
    }
}
```

### Step 5: C25-05 — Add autoComplete="new-password" to admin user create form

**File:** `apps/web/src/components/admin-user-manager.tsx`, line 98

Add `autoComplete="new-password"` to the password Input:

```tsx
<Input name="password" type="password" placeholder={t('users.password')} required minLength={12} maxLength={1024} autoComplete="new-password" />
```

### Step 6: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/app/actions/sharing.ts` — add revalidation to deleteGroupShareLink and revokePhotoShareLink
- `apps/web/src/lib/data.ts` — add deterministic sort to searchImages, add isFlushing guard to flushGroupViewCounts
- `apps/web/src/components/admin-user-manager.tsx` — add autoComplete="new-password" to create user password input

## Risk Assessment

- **Risk:** LOW — All changes are targeted fixes. The revalidation additions ensure cache consistency. The sort fix is deterministic. The flush guard prevents a rare race. The autoComplete is a UX improvement.
