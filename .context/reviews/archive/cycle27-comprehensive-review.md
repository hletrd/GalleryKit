# Cycle 27 Comprehensive Review — Deep Multi-Angle Audit

**Date:** 2026-04-19
**Reviewer:** single agent, multi-angle (code quality, security, performance, correctness, UX, architecture)
**Scope:** Full codebase re-review focusing on issues missed by 26 prior cycles

---

## FINDINGS

### C27-01: `updateTopic` does not revalidate `/admin/tags` — stale tag manager after topic slug rename (MEDIUM / HIGH)

**File:** `apps/web/src/app/actions/topics.ts`, line 167
**Category:** Cache consistency

When `updateTopic` renames a topic slug, it revalidates `/admin/categories`, `/`, and the old/new topic paths. However, it does not revalidate `/admin/tags`. The tag manager page (`/admin/tags`) displays tag counts grouped by topic via JOIN queries. After a topic slug rename, the `images.topic` column is updated in the transaction, but the `/admin/tags` ISR cache still contains the old topic slug reference until it expires or another action triggers revalidation.

Furthermore, the tag filter dropdown on the homepage and other pages may serve stale data referencing the old topic slug if they rely on cached tag-to-topic associations.

**Failure scenario:** Admin renames topic "nature" to "wildlife". The categories page updates, but the tags page still shows "nature" in tag contexts. Any tag filter clicks referencing "nature" on the homepage would fail to find images since the DB now has "wildlife" as the topic.

**Fix:** Add `/admin/tags` to the revalidation paths in `updateTopic`:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/tags', '/', `/${slug}`, slug !== currentSlug ? `/${currentSlug}` : '');
```

---

### C27-02: `deleteTopicAlias` does not revalidate `/admin/dashboard` — stale dashboard after alias deletion (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/topics.ts`, line 279
**Category:** Cache consistency

When `deleteTopicAlias` removes an alias, it revalidates `/admin/categories` and the alias/topic paths, but not `/admin/dashboard`. The admin dashboard may display topic aliases in its data, and after deletion the cached dashboard page would still show the removed alias until another action triggers dashboard revalidation.

**Failure scenario:** Admin deletes a topic alias from the categories page. The categories page updates, but the admin dashboard still shows the old alias reference.

**Fix:** Add `/admin/dashboard` to the revalidation call:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', `/${alias}`, `/${topicSlug}`);
```

---

### C27-03: `createTopicAlias` does not revalidate `/admin/dashboard` — stale dashboard after alias creation (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/topics.ts`, line 241
**Category:** Cache consistency

Same pattern as C27-02. When `createTopicAlias` adds a new alias, it does not revalidate `/admin/dashboard`.

**Fix:** Add `/admin/dashboard` to the revalidation call:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', `/${alias}`, `/${topicSlug}`);
```

---

### C27-04: `uploadImages` does not log audit event for successful uploads (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/images.ts`, lines 46-260
**Category:** Audit / Security

The `uploadImages` server action handles one of the most sensitive operations — writing files to disk and inserting records into the database — yet it does not log an audit event on success. Compare with `deleteImage` (line 321), `deleteImages` (line 406), `createAdminUser` (line 48), `deleteAdminUser` (line 87), `dumpDatabase`, and `restoreDatabase`, all of which log audit events. Even `exportImagesCsv` was recently fixed (cycle 26) to add audit logging.

The only audit-like trace for uploads is the file creation timestamp, which is not an explicit audit log entry.

**Failure scenario:** An attacker with admin access uploads hundreds of images silently. There is no audit trail entry to detect the bulk upload after the fact.

**Fix:** Add audit logging after successful upload:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'image_upload', 'image', undefined, undefined, {
    count: successCount,
    failed: failedFiles.length,
    topic,
}).catch(console.debug);
```

---

### C27-05: `updateImageMetadata` does not log audit event for successful edits (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/images.ts`, lines 425-466
**Category:** Audit / Security

The `updateImageMetadata` server action modifies image title and description but does not log an audit event. This is inconsistent with `deleteImage`, `deleteImages`, and other mutating actions that log to the audit trail.

**Failure scenario:** An attacker with admin access silently modifies image titles/descriptions across the gallery. No audit trail entry exists to detect the tampering.

**Fix:** Add audit logging after successful update:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'image_update', 'image', String(id)).catch(console.debug);
```

---

### C27-06: `revokePhotoShareLink` does not log audit event (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/sharing.ts`, lines 185-209
**Category:** Audit / Security

The `revokePhotoShareLink` server action removes public access to a shared photo but does not log an audit event. While revocation is a security-positive action, it should still be auditable for accountability (e.g., if an admin inadvertently revokes a link that was actively being used, the audit log would show who did it and when).

**Fix:** Add audit logging after successful revocation:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'share_revoke', 'image', String(imageId), undefined, { key: oldShareKey }).catch(console.debug);
```

---

### C27-07: `createPhotoShareLink` and `createGroupShareLink` do not log audit events (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/sharing.ts`, lines 50-109 and 111-183
**Category:** Audit / Security

Both share link creation actions create public-facing URLs that expose gallery content, yet neither logs an audit event. If an attacker gains admin access and creates share links to exfiltrate content, there would be no audit trail.

**Fix:** Add audit logging after successful creation in both functions:
```ts
// createPhotoShareLink:
logAuditEvent(currentUser?.id ?? null, 'share_create', 'image', String(imageId), undefined, { key }).catch(console.debug);

// createGroupShareLink:
logAuditEvent(currentUser?.id ?? null, 'group_share_create', 'shared_group', undefined, undefined, { key, imageCount: uniqueImageIds.length }).catch(console.debug);
```

---

### C27-08: `updateTag` does not revalidate `/admin/dashboard` — stale dashboard after tag name change (LOW / LOW)

**File:** `apps/web/src/app/actions/tags.ts`, lines 40-73
**Category:** Cache consistency

When `updateTag` changes a tag name, it revalidates `/admin/tags` and `/`, but not `/admin/dashboard`. The admin dashboard displays image tag names via GROUP_CONCAT, so after a tag rename the cached dashboard would show the old tag name.

**Failure scenario:** Admin renames tag "sunset" to "golden hour". The tags page updates, but the admin dashboard still shows "sunset" in the tag column for affected images until the next dashboard revalidation.

**Fix:** Add `/admin/dashboard` to the revalidation call:
```ts
revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
```

---

### C27-09: `deleteGroupShareLink` does not wrap deletion in a transaction (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/sharing.ts`, lines 211-232
**Category:** Data integrity

The `deleteGroupShareLink` function deletes the `sharedGroups` row directly, relying on FK cascade to delete `sharedGroupImages` rows. While the schema defines `onDelete: 'cascade'`, this is the same pattern that was flagged and fixed for `deleteTag` (C26-01) and `deleteImage` — both now use explicit deletion in a transaction for defense in depth. The `deleteAdminUser` function also explicitly deletes sessions before the user in a transaction.

If FK cascade is not enforced (e.g., constraints were not applied, or the table was created without CONSTRAINT enforcement), deleting the group would leave orphaned `sharedGroupImages` rows.

**Failure scenario:** Admin deletes a shared group. The group row is deleted but sharedGroupImages rows remain, causing queries that JOIN on sharedGroups to fail or return inconsistent data.

**Fix:** Wrap in a transaction with explicit sharedGroupImages deletion:
```ts
await db.transaction(async (tx) => {
    await tx.delete(sharedGroupImages).where(eq(sharedGroupImages.groupId, groupId));
    await tx.delete(sharedGroups).where(eq(sharedGroups.id, groupId));
});
```

---

### C27-10: `deleteGroupShareLink` does not log audit event (LOW / LOW)

**File:** `apps/web/src/app/actions/sharing.ts`, lines 211-232
**Category:** Audit / Security

The `deleteGroupShareLink` server action removes a shared group (which is a public-facing URL), but does not log an audit event. This is inconsistent with the pattern of logging all admin mutating actions.

**Fix:** Add audit logging after successful deletion:
```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'group_share_delete', 'shared_group', String(groupId), undefined, { key: group.key }).catch(console.debug);
```

---

## SWEPT — No Issues Found

The following areas were specifically checked and found to be clean:

1. **Session management** — HMAC-SHA256 signing, timingSafeEqual, proper expiry, transaction-wrapped session creation. No new issues.
2. **Path traversal** — SAFE_SEGMENT regex, containment checks, symlink rejection, directory whitelist. No new issues.
3. **Rate limiting** — TOCTOU fixed with pre-increment, DB+in-memory dual check, rollback on success/error. No new issues.
4. **SQL injection** — All queries use Drizzle ORM parameterized queries, LIKE wildcards escaped. No new issues.
5. **Upload pipeline** — Queue claim mechanism, conditional update, orphan cleanup, statfs disk check, upload tracker with pre-increment. No new issues.
6. **Password handling** — Argon2id, dummy hash timing, proper maxLength and autoComplete. No new issues.
7. **Input validation** — regex validation on photoId (fixed in cycle 26), isValidSlug, isValidTagName, isValidFilename, isValidTopicAlias all robust. No new issues.
8. **DB backup/restore** — Advisory lock, dangerous SQL scanning, header validation, --one-database flag, MySQL_PWD env var. No new issues.
9. **ICC profile parsing** — tagCount capped at 100, string lengths capped at 1024, bounds checks on all offsets. No new issues.
10. **View count buffering** — isFlushing guard, MAX_VIEW_COUNT_BUFFER_SIZE cap, unref timer. No new issues.
11. **searchImages** — Deterministic sort with id tiebreaker. No regression.
12. **topic-manager closure** — Fixed in cycle 26 (aliasValue capture). No regression.
13. **deleteTag transaction** — Fixed in cycle 26. No regression.
14. **Middleware auth guard** — Cookie format check, protected route detection, API route exclusion. No new issues.
15. **serve-upload security** — SAFE_SEGMENT, containment check, symlink rejection, content-type whitelist. No new issues.
16. **DB download route** — SAFE_FILENAME regex, containment check, symlink rejection, withAdminAuth wrapper. No new issues.
17. **SQL restore scanning** — containsDangerousSql, chunked scan with overlap, header validation. No new issues.
18. **Shared group page photoId validation** — Fixed in cycle 26 (regex check). No regression.

---

## TOTALS

- **0 CRITICAL** findings
- **1 MEDIUM** finding (C27-01: updateTopic missing /admin/tags revalidation)
- **9 LOW** findings (C27-02 through C27-10)
- **10 total** findings
