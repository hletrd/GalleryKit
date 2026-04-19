# Plan 72 — Cycle 26 Fixes (C26-01, C26-02, C26-03, C26-04, C26-06, C26-07, C26-08)

**Created:** 2026-04-19 (Cycle 26)
**Status:** DONE
**Severity:** 1 MEDIUM, 6 LOW (C26-05 deferred — see 72-deferred)

---

## Problem

Seven actionable issues identified in the cycle 26 comprehensive review:

1. **C26-01 (MEDIUM)**: `deleteTag` does not explicitly delete `imageTags` rows before deleting the tag and is not wrapped in a transaction — relies solely on FK cascade which may not be enforced. Fix: wrap in transaction with explicit imageTags deletion, matching `deleteImage` pattern.

2. **C26-02 (LOW)**: `deleteGroupShareLink` does not revalidate `/admin/dashboard` — stale admin view after group deletion. Fix: add `/admin/dashboard` to revalidation call.

3. **C26-03 (LOW)**: `exportImagesCsv` has no audit logging — bulk data export leaves no trace in audit trail. Fix: add `logAuditEvent` call after export.

4. **C26-04 (LOW)**: `batchUpdateImageTags` does not revalidate topic page — stale topic gallery after tag changes. Fix: fetch image topic and add to revalidation paths, matching `addTagToImage`/`removeTagFromImage` pattern.

5. **C26-06 (LOW)**: `handleAddAlias` in topic-manager uses `newAlias` from closure rather than captured value — theoretical stale closure issue. Fix: capture `aliasValue` at function start.

6. **C26-07 (LOW)**: `photoId` query param in shared group page parsed without regex validation — inconsistent with defense-in-depth pattern in photo page. Fix: add `/^\d+$/` regex check.

7. **C26-08 (LOW)**: CLAUDE.md says "8 connections" but `db/index.ts` uses `connectionLimit: 10` — documentation mismatch. Fix: update CLAUDE.md.

---

## Implementation Steps

### Step 1: C26-01 — Wrap deleteTag in transaction with explicit imageTags cleanup

**File:** `apps/web/src/app/actions/tags.ts`, lines 76-93

```ts
export async function deleteTag(id: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidTagId') };
    }

    try {
        // Delete imageTags explicitly before tag (defense in depth alongside FK cascade)
        await db.transaction(async (tx) => {
            await tx.delete(imageTags).where(eq(imageTags.tagId, id));
            await tx.delete(tags).where(eq(tags.id, id));
        });
        revalidateLocalizedPaths('/admin/tags', '/');
        return { success: true };
    } catch {
        console.error("Failed to delete tag");
        return { error: t('failedToDeleteTag') };
    }
}
```

### Step 2: C26-02 — Add /admin/dashboard revalidation to deleteGroupShareLink

**File:** `apps/web/src/app/actions/sharing.ts`, line 230

Change:
```ts
revalidateLocalizedPaths('/', `/g/${group.key}`);
```
To:
```ts
revalidateLocalizedPaths('/', `/g/${group.key}`, '/admin/dashboard');
```

### Step 3: C26-03 — Add audit logging to exportImagesCsv

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, after line 80

Add before the return statement:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'csv_export', 'images', undefined, undefined, { rowCount }).catch(console.debug);
```

### Step 4: C26-04 — Add topic page revalidation to batchUpdateImageTags

**File:** `apps/web/src/app/actions/tags.ts`, line 279

Change:
```ts
revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/dashboard');
```
To:
```ts
const [img] = await db.select({ topic: images.topic }).from(images).where(eq(images.id, imageId));
revalidateLocalizedPaths(`/p/${imageId}`, '/', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
```

### Step 5: C26-06 — Capture aliasValue at function start in handleAddAlias

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, line 107

Change:
```ts
async function handleAddAlias(topicSlug: string) {
    if (!newAlias.trim() || isAddingAlias) return;
    setIsAddingAlias(true);
    try {
        const res = await createTopicAlias(topicSlug, newAlias.trim());
```
To:
```ts
async function handleAddAlias(topicSlug: string) {
    const aliasValue = newAlias.trim();
    if (!aliasValue || isAddingAlias) return;
    setIsAddingAlias(true);
    try {
        const res = await createTopicAlias(topicSlug, aliasValue);
```

And line 117:
```ts
setEditingTopic(prev => prev ? ({ ...prev, aliases: [...prev.aliases, newAlias.trim()] }) : null);
```
To:
```ts
setEditingTopic(prev => prev ? ({ ...prev, aliases: [...prev.aliases, aliasValue] }) : null);
```

And line 116:
```ts
setNewAlias('');
```
(This stays as-is — clearing the input state is still correct.)

### Step 6: C26-07 — Add regex validation for photoId query param

**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, lines 71-75

Change:
```ts
if (photoIdParam) {
    const parsed = parseInt(photoIdParam, 10);
    if (!isNaN(parsed) && parsed > 0 && Number.isInteger(parsed)) {
        photoId = parsed;
    }
}
```
To:
```ts
if (photoIdParam && /^\d+$/.test(photoIdParam)) {
    const parsed = parseInt(photoIdParam, 10);
    if (parsed > 0) {
        photoId = parsed;
    }
}
```

### Step 7: C26-08 — Update CLAUDE.md connection pool documentation

**File:** `CLAUDE.md`

Change:
```
Connection pool: 8 connections, queue limit 20, keepalive enabled.
```
To:
```
Connection pool: 10 connections, queue limit 20, keepalive enabled.
```

### Step 8: Verify build

Run `npm run build --workspace=apps/web`.

---

## Files Modified

- `apps/web/src/app/actions/tags.ts` — wrap deleteTag in transaction, add topic revalidation to batchUpdateImageTags
- `apps/web/src/app/actions/sharing.ts` — add /admin/dashboard revalidation to deleteGroupShareLink
- `apps/web/src/app/[locale]/admin/db-actions.ts` — add audit logging to exportImagesCsv
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` — capture aliasValue in handleAddAlias
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx` — add regex validation for photoId param
- `CLAUDE.md` — fix connection pool documentation

## Risk Assessment

- **Risk:** LOW — All changes are targeted fixes. The transaction addition is defensive. The revalidation additions ensure cache consistency. The audit logging is additive. The closure capture and regex validation are defensive improvements. The doc fix is purely documentation.
