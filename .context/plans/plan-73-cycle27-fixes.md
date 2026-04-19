# Plan 73 — Cycle 27 Fixes (C27-01 through C27-10)

**Created:** 2026-04-19 (Cycle 27)
**Status:** DONE
**Severity:** 1 MEDIUM, 9 LOW

---

## Problem

Ten actionable issues identified in the cycle 27 comprehensive review:

1. **C27-01 (MEDIUM)**: `updateTopic` does not revalidate `/admin/tags` — stale tag manager after topic slug rename. Fix: add `/admin/tags` to revalidation paths.

2. **C27-02 (LOW)**: `deleteTopicAlias` does not revalidate `/admin/dashboard`. Fix: add `/admin/dashboard` to revalidation call.

3. **C27-03 (LOW)**: `createTopicAlias` does not revalidate `/admin/dashboard`. Fix: add `/admin/dashboard` to revalidation call.

4. **C27-04 (LOW)**: `uploadImages` does not log audit event for successful uploads. Fix: add `logAuditEvent` call.

5. **C27-05 (LOW)**: `updateImageMetadata` does not log audit event for successful edits. Fix: add `logAuditEvent` call.

6. **C27-06 (LOW)**: `revokePhotoShareLink` does not log audit event. Fix: add `logAuditEvent` call.

7. **C27-07 (LOW)**: `createPhotoShareLink` and `createGroupShareLink` do not log audit events. Fix: add `logAuditEvent` calls in both functions.

8. **C27-08 (LOW)**: `updateTag` does not revalidate `/admin/dashboard`. Fix: add `/admin/dashboard` to revalidation paths.

9. **C27-09 (LOW)**: `deleteGroupShareLink` does not wrap deletion in a transaction. Fix: wrap in transaction with explicit sharedGroupImages deletion.

10. **C27-10 (LOW)**: `deleteGroupShareLink` does not log audit event. Fix: add `logAuditEvent` call.

---

## Implementation Steps

### Step 1: C27-01 — Add /admin/tags revalidation to updateTopic

**File:** `apps/web/src/app/actions/topics.ts`, line 167

Change:
```ts
revalidateLocalizedPaths('/admin/categories', '/', `/${slug}`, slug !== currentSlug ? `/${currentSlug}` : '');
```
To:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/tags', '/', `/${slug}`, slug !== currentSlug ? `/${currentSlug}` : '');
```

### Step 2: C27-02 — Add /admin/dashboard revalidation to deleteTopicAlias

**File:** `apps/web/src/app/actions/topics.ts`, line 279

Change:
```ts
revalidateLocalizedPaths('/admin/categories', `/${alias}`, `/${topicSlug}`);
```
To:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', `/${alias}`, `/${topicSlug}`);
```

### Step 3: C27-03 — Add /admin/dashboard revalidation to createTopicAlias

**File:** `apps/web/src/app/actions/topics.ts`, line 241

Change:
```ts
revalidateLocalizedPaths('/admin/categories', `/${alias}`, `/${topicSlug}`);
```
To:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', `/${alias}`, `/${topicSlug}`);
```

### Step 4: C27-04 — Add audit logging to uploadImages

**File:** `apps/web/src/app/actions/images.ts`, after the upload loop (after line 249)

Add before `revalidateLocalizedPaths`:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'image_upload', 'image', undefined, undefined, {
    count: successCount,
    failed: failedFiles.length,
    topic,
}).catch(console.debug);
```

Note: `getCurrentUser` is already imported from `./actions/auth` (line 10) and `logAuditEvent` is already imported from `@/lib/audit` (line 13).

### Step 5: C27-05 — Add audit logging to updateImageMetadata

**File:** `apps/web/src/app/actions/images.ts`, after the successful update (before return)

Add before `revalidateLocalizedPaths`:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'image_update', 'image', String(id)).catch(console.debug);
```

### Step 6: C27-06 — Add audit logging to revokePhotoShareLink

**File:** `apps/web/src/app/actions/sharing.ts`, after successful revocation

Add after `revalidateLocalizedPaths`:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'share_revoke', 'image', String(imageId), undefined, { key: oldShareKey }).catch(console.debug);
```

Note: Need to import `getCurrentUser` from `@/app/actions/auth` and `logAuditEvent` from `@/lib/audit` in sharing.ts.

### Step 7: C27-07 — Add audit logging to createPhotoShareLink and createGroupShareLink

**File:** `apps/web/src/app/actions/sharing.ts`

For `createPhotoShareLink`, after successful key generation (around line 85):
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'share_create', 'image', String(imageId), undefined, { key }).catch(console.debug);
```

For `createGroupShareLink`, after successful creation (around line 175):
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'group_share_create', 'shared_group', undefined, undefined, { key, imageCount: uniqueImageIds.length }).catch(console.debug);
```

### Step 8: C27-08 — Add /admin/dashboard revalidation to updateTag

**File:** `apps/web/src/app/actions/tags.ts`, line 68

Change:
```ts
revalidateLocalizedPaths('/admin/tags', '/');
```
To:
```ts
revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
```

### Step 9: C27-09 — Wrap deleteGroupShareLink in transaction with explicit sharedGroupImages deletion

**File:** `apps/web/src/app/actions/sharing.ts`, lines 223-228

Change:
```ts
// sharedGroupImages cascade-deletes via FK
const [result] = await db.delete(sharedGroups).where(eq(sharedGroups.id, groupId));

if (result.affectedRows === 0) {
    return { error: t('groupNotFound') };
}
```
To:
```ts
// Delete sharedGroupImages explicitly before group (defense in depth alongside FK cascade)
await db.transaction(async (tx) => {
    await tx.delete(sharedGroupImages).where(eq(sharedGroupImages.groupId, groupId));
    const [result] = await tx.delete(sharedGroups).where(eq(sharedGroups.id, groupId));
    if (result.affectedRows === 0) {
        throw new Error('GROUP_NOT_FOUND');
    }
});
```

And in the catch block, add handling for the GROUP_NOT_FOUND error, or restructure the function to let the transaction throw and catch it.

### Step 10: C27-10 — Add audit logging to deleteGroupShareLink

**File:** `apps/web/src/app/actions/sharing.ts`, after successful deletion

Add after `revalidateLocalizedPaths`:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'group_share_delete', 'shared_group', String(groupId), undefined, { key: group.key }).catch(console.debug);
```

### Step 11: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/app/actions/topics.ts` — add /admin/tags and /admin/dashboard revalidation paths
- `apps/web/src/app/actions/images.ts` — add audit logging to uploadImages and updateImageMetadata
- `apps/web/src/app/actions/sharing.ts` — add audit logging to share link actions, wrap deleteGroupShareLink in transaction, add sharedGroupImages import
- `apps/web/src/app/actions/tags.ts` — add /admin/dashboard revalidation to updateTag

## Risk Assessment

- **Risk:** LOW — All changes are targeted fixes. The revalidation additions ensure cache consistency. The audit logging is additive. The transaction addition for deleteGroupShareLink is defensive (matching patterns already used for deleteTag and deleteImage).
