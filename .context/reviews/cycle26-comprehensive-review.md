# Cycle 26 Comprehensive Review — Deep Multi-Angle Audit

**Date:** 2026-04-19
**Reviewer:** single agent, multi-angle (code quality, security, performance, correctness, UX, architecture)
**Scope:** Full codebase re-review focusing on issues missed by 25 prior cycles

---

## FINDINGS

### C26-01: `deleteTag` does not delete orphaned `imageTags` rows before deleting the tag — FK cascade may silently fail or leave orphans (MEDIUM / HIGH)

**File:** `apps/web/src/app/actions/tags.ts`, lines 86-93
**Category:** Correctness / Data integrity

The `deleteTag` function deletes a tag directly without first deleting its associated `imageTags` rows. While the schema defines `imageTags.tagId` with `onDelete: 'cascade'`, this relies on the database engine enforcing the FK constraint. However, if the FK constraint was not applied (e.g., created before the migration, or if the table was created without `CONSTRAINT` enforcement in MySQL), the delete would succeed for the tag but leave orphaned `imageTags` rows pointing to a non-existent tag. This is the same pattern that was fixed for `deleteImage` (which explicitly deletes `imageTags` before `images` in a transaction for safety).

More critically, the `deleteTag` function is not wrapped in a transaction. If something fails between operations, there is no rollback. Compare with `deleteImage` which uses a transaction.

**Failure scenario:** Admin deletes a tag. The tag row is deleted but imageTags rows remain, causing `getTags()` to produce incorrect counts (LEFT JOIN with orphaned imageTags returns images with broken tag references), or `addTagToImage` to fail when it finds the tag slug matches but the tag record is gone.

**Fix:** Wrap tag deletion in a transaction that explicitly deletes imageTags first, matching the defense-in-depth pattern used in `deleteImage`:

```ts
export async function deleteTag(id: number) {
    // ...validation...
    try {
        await db.transaction(async (tx) => {
            await tx.delete(imageTags).where(eq(imageTags.tagId, id));
            await tx.delete(tags).where(eq(tags.id, id));
        });
        revalidateLocalizedPaths('/admin/tags', '/');
        return { success: true };
    } catch { ... }
}
```

---

### C26-02: `deleteGroupShareLink` does not revalidate `/admin/dashboard` — stale admin view after group deletion (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/sharing.ts`, lines 211-232
**Category:** Cache consistency

When `deleteGroupShareLink` runs, it revalidates `/` and `/g/${group.key}` but does not revalidate `/admin/dashboard`. The admin dashboard shows shared groups, and after deleting one, the cached admin dashboard page would still show the deleted group until its ISR cache expires or another action triggers revalidation.

**Failure scenario:** Admin deletes a shared group from the dashboard. The public pages update, but the admin dashboard still shows the deleted group until the next unrelated action triggers a dashboard revalidation.

**Fix:** Add `/admin/dashboard` to the revalidation call:
```ts
revalidateLocalizedPaths('/', `/g/${group.key}`, '/admin/dashboard');
```

---

### C26-03: `exportImagesCsv` does not revalidate or have any audit logging — no traceability for bulk data export (LOW / MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 31-82
**Category:** Security / Audit

The `exportImagesCsv` function exports up to 50,000 image records including filenames, titles, and tags, but there is no audit log entry recorded for this operation. Every other admin action that modifies or accesses sensitive data (login, delete, upload, password change, DB backup/restore) logs to the audit trail. A bulk CSV export of all gallery metadata is a significant data access event that should be auditable.

**Failure scenario:** An attacker who gains admin access could silently export all gallery metadata without leaving any trace in the audit log.

**Fix:** Add audit logging after the export:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'csv_export', 'images', undefined, undefined, { rowCount }).catch(console.debug);
```

---

### C26-04: `batchUpdateImageTags` does not revalidate topic page — stale topic gallery after tag changes (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/tags.ts`, line 279
**Category:** Cache consistency

The `batchUpdateImageTags` function revalidates `/p/${imageId}`, `/`, and `/admin/dashboard`, but does not revalidate the topic page for the image's topic. Both `addTagToImage` and `removeTagFromImage` (lines 128 and 160) do revalidate the topic page. The tag filter on topic pages depends on the tag data being up to date.

**Failure scenario:** Admin adds/removes tags on an image in the "Nature" topic. The photo page updates, but the topic page still shows the old tag filter state until ISR expires.

**Fix:** Fetch the image's topic and revalidate it, matching the pattern in `addTagToImage`/`removeTagFromImage`:
```ts
const [img] = await db.select({ topic: images.topic }).from(images).where(eq(images.id, imageId));
revalidateLocalizedPaths(`/p/${imageId}`, '/', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
```

---

### C26-05: `sharedGroupImages` position values may be non-unique when creating groups with duplicate imageIds — deduped but position gaps (LOW / LOW)

**File:** `apps/web/src/app/actions/sharing.ts`, lines 125-169
**Category:** Data integrity

When `createGroupShareLink` is called with duplicate `imageIds` (e.g., `[1, 1, 2]`), `Array.from(new Set(imageIds))` dedupes them to `[1, 2]`, but the `.map()` still uses the array index as position, so positions become `[0, 1]` rather than the potentially intended `[0, 2]`. This is a minor inconsistency — the deduplication happens before the position assignment, so positions are always contiguous, but the original intent (positions matching the caller's ordering) may be lost.

This is very low severity since the deduplication is correct and positions are still valid. Flagging only for completeness.

---

### C26-06: `topic-manager.tsx` — `handleAddAlias` uses stale `newAlias` state in optimistic update (LOW / MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`, line 117
**Category:** React state / UI correctness

In `handleAddAlias`, after a successful `createTopicAlias` call, the code does:
```ts
setEditingTopic(prev => prev ? ({ ...prev, aliases: [...prev.aliases, newAlias.trim()] }) : null);
```

However, `newAlias` is captured from the closure at the time the function was defined, not at the time it was called. Since `handleAddAlias` is defined inside the component body, the `newAlias` value is the one from the current render. If `newAlias` changed between the render and the async call completing, the optimistic update would use the wrong value. In practice, the function is called immediately on user action, so the stale closure issue is unlikely. But the correct pattern would be to capture the alias value at the start of the function and use that.

**Fix:** Capture the alias at the start:
```ts
async function handleAddAlias(topicSlug: string) {
    const aliasValue = newAlias.trim();
    if (!aliasValue || isAddingAlias) return;
    // ... use aliasValue throughout ...
    setEditingTopic(prev => prev ? ({ ...prev, aliases: [...prev.aliases, aliasValue] }) : null);
}
```

---

### C26-07: `photoId` query param in shared group page parsed without regex validation — allows arbitrary string (LOW / LOW)

**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`, lines 71-75
**Category:** Input validation

The `photoId` query parameter is parsed with `parseInt(photoIdParam, 10)` but not validated with a regex first (unlike the photo page route which validates `id` with `/^\d+$/`). Since `parseInt("123abc", 10)` returns `123` without error, this could pass through malformed input. The `findIndex` check on the group images prevents any actual harm, but it's inconsistent with the defense-in-depth pattern used in `p/[id]/page.tsx`.

**Fix:** Add regex validation before parseInt:
```ts
if (photoIdParam && /^\d+$/.test(photoIdParam)) {
    photoId = parseInt(photoIdParam, 10);
}
```

---

### C26-08: `db/index.ts` connection pool `connectionLimit: 10` but CLAUDE.md says "8 connections" — documentation mismatch (LOW / LOW)

**File:** `apps/web/src/db/index.ts`, line 19
**Category:** Documentation / Configuration

The CLAUDE.md states "Connection pool: 8 connections, queue limit 20" but the actual code uses `connectionLimit: 10`. This is a minor doc-code mismatch but could mislead operators tuning database connections.

**Fix:** Update CLAUDE.md to match the actual pool configuration, or update the pool config to match the documented value.

---

## SWEPT — No Issues Found

The following areas were specifically checked and found to be clean:

1. **Session management** — token verification uses `timingSafeEqual`, HMAC-SHA256 signing, proper expiry checks. No issues.
2. **Path traversal** — all upload serving routes properly validate path segments with `SAFE_SEGMENT`, containment checks, and symlink rejection. No issues.
3. **Rate limiting** — TOCTOU fixed with pre-increment pattern, DB+in-memory dual check, proper rollback on success/error. No issues.
4. **SQL injection** — all queries use Drizzle ORM parameterized queries, LIKE wildcards escaped. No issues.
5. **Race conditions in upload queue** — claim-based locking, conditional updates, orphaned file cleanup. No issues.
6. **Admin auth guard** — middleware + server action defense-in-depth. No issues.
7. **Password handling** — Argon2id, timing-safe dummy hash, proper autoComplete attributes. No issues.
8. **DB backup/restore** — advisory lock, dangerous SQL scanning, header validation, --one-database flag. No issues.
9. **Image processing pipeline** — shutdown draining, retry maps pruning, claim mechanism. No issues.
10. **View count buffering** — isFlushing guard, MAX_VIEW_COUNT_BUFFER_SIZE cap, unref timer. No issues.
11. **searchImages** — deterministic sort with id tiebreaker (fixed in cycle 25). No regression.

---

## TOTALS

- **0 CRITICAL** findings
- **1 MEDIUM** finding (C26-01: deleteTag missing transaction and explicit imageTags cleanup)
- **7 LOW** findings (C26-02 through C26-08)
- **8 total** findings
