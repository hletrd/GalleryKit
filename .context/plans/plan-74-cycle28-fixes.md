# Plan 74 — Cycle 28 Fixes (C28-01 through C28-09)

**Created:** 2026-04-19 (Cycle 28)
**Status:** DONE
**Severity:** 2 MEDIUM, 7 LOW

---

## Problem

Nine actionable issues identified in the cycle 28 comprehensive review, centered on two themes:
1. **Audit logging gaps** — topic and tag CRUD operations, alias mutations, password changes, and logout events lack audit logging (6 findings)
2. **Cache consistency gaps** — missing `/admin/dashboard` and `/admin/tags` revalidation paths (3 findings)

---

## Implementation Steps

### Step 1: C28-01 — Add audit logging to topic CRUD operations

**File:** `apps/web/src/app/actions/topics.ts`

Add `import { logAuditEvent } from '@/lib/audit';` to imports.
Add `getCurrentUser` is already imported from `@/app/actions/auth`.

1. `createTopic` — after successful insert (line ~80):
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_create', 'topic', slug).catch(console.debug);
```

2. `updateTopic` — after successful update (line ~167):
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_update', 'topic', slug).catch(console.debug);
```

3. `deleteTopic` — after successful delete (line ~204):
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_delete', 'topic', slug).catch(console.debug);
```

### Step 2: C28-02 — Add audit logging to all tag mutating actions

**File:** `apps/web/src/app/actions/tags.ts`

Add imports:
```ts
import { getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
```

1. `updateTag` — after successful update:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_update', 'tag', String(id), undefined, { name: trimmedName, slug }).catch(console.debug);
```

2. `deleteTag` — after successful deletion:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_delete', 'tag', String(id)).catch(console.debug);
```

3. `addTagToImage` — after successful add:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_add', 'image', String(imageId), undefined, { tag: tagRecord.name }).catch(console.debug);
```

4. `removeTagFromImage` — after successful remove:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_remove', 'image', String(imageId), undefined, { tag: tagName }).catch(console.debug);
```

5. `batchAddTags` — after successful batch add:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tags_batch_add', 'image', undefined, undefined, { count: imageIds.length, tag: cleanName }).catch(console.debug);
```

6. `batchUpdateImageTags` — after successful batch update:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tags_batch_update', 'image', String(imageId), undefined, { added, removed }).catch(console.debug);
```

### Step 3: C28-03 — Add /admin/dashboard revalidation to deleteTopic

**File:** `apps/web/src/app/actions/topics.ts`, line 204

Change:
```ts
revalidateLocalizedPaths('/admin/categories', '/', `/${slug}`);
```
To:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', '/', `/${slug}`);
```

### Step 4: C28-04 — Add /admin/dashboard revalidation to createTopic

**File:** `apps/web/src/app/actions/topics.ts`, line 80

Change:
```ts
revalidateLocalizedPaths('/admin/categories', '/');
```
To:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', '/');
```

### Step 5: C28-05 — Add /admin/dashboard revalidation to deleteTag

**File:** `apps/web/src/app/actions/tags.ts`, line 91

Change:
```ts
revalidateLocalizedPaths('/admin/tags', '/');
```
To:
```ts
revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
```

### Step 6: C28-06 — Add audit logging to createTopicAlias and deleteTopicAlias

**File:** `apps/web/src/app/actions/topics.ts`

1. `createTopicAlias` — after successful insert:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_alias_create', 'topic', topicSlug, undefined, { alias }).catch(console.debug);
```

2. `deleteTopicAlias` — after successful deletion:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_alias_delete', 'topic', topicSlug, undefined, { alias }).catch(console.debug);
```

### Step 7: C28-07 — Add audit logging to updatePassword

**File:** `apps/web/src/app/actions/auth.ts`, after successful password change (before return success)

Add before `return { success: true, message: t('passwordUpdated') };`:
```ts
logAuditEvent(currentUser.id, 'password_change', 'user', String(currentUser.id)).catch(console.debug);
```

Note: `currentUser` is already fetched at the top of the function. `logAuditEvent` is already imported.

### Step 8: C28-08 — Add audit logging to logout

**File:** `apps/web/src/app/actions/auth.ts`, in the `logout` function

Add before `await db.delete(sessions)...`:
```ts
if (token) {
    const session = await verifySessionToken(token);
    if (session) {
        logAuditEvent(session.userId, 'logout', 'user', String(session.userId)).catch(console.debug);
    }
    await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
}
```

Note: `verifySessionToken`, `logAuditEvent`, and `hashSessionToken` are all already imported in auth.ts.

### Step 9: C28-09 — Add /admin/tags revalidation to addTagToImage, removeTagFromImage, and batchAddTags

**File:** `apps/web/src/app/actions/tags.ts`

1. `addTagToImage` (line ~132):
```ts
revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
```

2. `removeTagFromImage` (line ~164):
```ts
revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
```

3. `batchAddTags` (line ~213):
```ts
revalidateLocalizedPaths('/admin/dashboard', '/', '/admin/tags');
```

### Step 10: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/app/actions/topics.ts` — add audit logging to CRUD + alias operations, add /admin/dashboard revalidation to createTopic and deleteTopic
- `apps/web/src/app/actions/tags.ts` — add audit logging to all 6 mutating actions, add /admin/dashboard to deleteTag, add /admin/tags to addTagToImage, removeTagFromImage, batchAddTags
- `apps/web/src/app/actions/auth.ts` — add audit logging to updatePassword and logout

## Risk Assessment

- **Risk:** LOW — All changes are targeted fixes. The audit logging is additive (fire-and-forget with `.catch(console.debug)`). The revalidation additions ensure cache consistency. No behavioral changes to existing logic.
