# Plan -- Cycle 10 R3 Fixes

## Status: COMPLETE

## Findings to Address

### F1: C10R3-01 -- Validate `topic` parameter in OG route against `isValidSlug` [MEDIUM] [MEDIUM confidence]

**File:** `apps/web/src/app/api/og/route.tsx` lines 9, 81

**Current code (lines 9, 12):**
```
const topic = searchParams.get('topic');
...
if (!topic || topic.length > 200) {
    return new Response('Missing or invalid topic param', { status: 400 });
}
```

**Fix:** Import `isValidSlug` from `@/lib/validation` and add validation after the length check. This ensures only valid slugs (alphanumeric, hyphens, underscores) are rendered into OG images, preventing arbitrary text injection.

**Implementation plan:**
1. Add `import { isValidSlug } from '@/lib/validation';` at the top
2. After the existing `if (!topic || topic.length > 200)` check, add: `if (!isValidSlug(topic)) { return new Response('Invalid topic param', { status: 400 }); }`

### F2: C10R3-02 -- Validate `tags` parameter in OG route against `isValidTagName` [LOW] [LOW confidence]

**File:** `apps/web/src/app/api/og/route.tsx` lines 10, 16, 95-109

**Current code (line 16):**
```
const tagList = tags ? tags.split(',').filter(Boolean).slice(0, 20).map(t => t.slice(0, 100)) : [];
```

**Fix:** Import `isValidTagName` and filter out invalid tag names instead of just truncating. Invalid tags are silently dropped rather than causing a 400 error (since tags are optional decorative elements).

**Implementation plan:**
1. Add `import { isValidTagName } from '@/lib/validation';` to the import (alongside `isValidSlug`)
2. Change line 16 to: `const tagList = tags ? tags.split(',').filter(Boolean).slice(0, 20).map(t => t.trim()).filter(t => isValidTagName(t)) : [];`

### F3: C10R3-03 -- Check `affectedRows` in `deleteAdminUser` before audit log [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/admin-users.ts` lines 168-196

**Current code (lines 168-196):**
```ts
try {
    await db.transaction(async (tx) => {
        const [adminCount] = await tx.select({ count: sql<number>`count(*)` }).from(adminUsers);
        if (Number(adminCount.count) <= 1) {
            throw new Error('LAST_ADMIN');
        }
        const [target] = await tx.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.id, id));
        if (!target) {
            throw new Error('USER_NOT_FOUND');
        }
        await tx.delete(sessions).where(eq(sessions.userId, id));
        await tx.delete(adminUsers).where(eq(adminUsers.id, id));
    });
    logAuditEvent(currentUser.id, 'user_delete', 'user', String(id)).catch(console.debug);
    // ...
```

**Fix:** Check `affectedRows` from the `tx.delete(adminUsers)` result inside the transaction. If 0, throw an error to prevent the audit log from recording a phantom deletion. This matches the pattern used in `deleteImage`, `deleteTag`, and `deleteTopic`.

**Implementation plan:**
1. Change `await tx.delete(adminUsers).where(eq(adminUsers.id, id));` to capture the result: `const [delResult] = await tx.delete(adminUsers).where(eq(adminUsers.id, id));`
2. After the delete, add: `if (delResult.affectedRows === 0) { throw new Error('USER_NOT_FOUND'); }`
3. The existing `USER_NOT_FOUND` catch handler will handle this case

## Progress Tracking

- [x] F1: Validate `topic` in OG route — commit 000000068c
- [x] F2: Validate `tags` in OG route — commit 000000068c
- [x] F3: Check `affectedRows` in `deleteAdminUser` before audit log — commit 0000000399
- [x] Run gates (eslint, next build, vitest) — all pass
- [x] Deploy — per-cycle-success
