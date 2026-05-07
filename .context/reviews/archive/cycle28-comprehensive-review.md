# Cycle 28 Comprehensive Review — Deep Multi-Angle Audit

**Date:** 2026-04-19
**Reviewer:** single agent, multi-angle (code quality, security, performance, correctness, UX, architecture)
**Scope:** Full codebase re-review focusing on issues missed by 27 prior cycles

---

## FINDINGS

### C28-01: `createTopic`, `updateTopic`, `deleteTopic` lack audit logging — no accountability for topic mutations (MEDIUM / HIGH)

**File:** `apps/web/src/app/actions/topics.ts`, lines 31-214
**Category:** Audit / Security

All three core topic CRUD operations (`createTopic`, `updateTopic`, `deleteTopic`) perform database mutations but do not call `logAuditEvent`. This is inconsistent with the pattern established across all other mutating server actions:

- `createAdminUser` / `deleteAdminUser` — audit logged
- `deleteImage` / `deleteImages` / `uploadImages` / `updateImageMetadata` — audit logged (fixed in cycle 27)
- `createPhotoShareLink` / `createGroupShareLink` / `revokePhotoShareLink` / `deleteGroupShareLink` — audit logged (fixed in cycle 27)
- `dumpDatabase` / `restoreDatabase` / `exportImagesCsv` — audit logged

Topics control the primary navigation structure of the gallery. A rogue admin could silently create, rename, or delete categories without any audit trail.

**Failure scenario:** An admin with access deletes a topic containing images (blocked by the HAS_IMAGES check, but topic metadata/image associations could be altered via `updateTopic` slug rename). Without audit logging, there is no forensic record of who made the change and when.

**Fix:** Add `logAuditEvent` calls to all three functions:

```ts
// createTopic — after successful insert:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_create', 'topic', slug).catch(console.debug);

// updateTopic — after successful update:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_update', 'topic', slug).catch(console.debug);

// deleteTopic — after successful delete:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_delete', 'topic', slug).catch(console.debug);
```

Note: `getCurrentUser` is already imported from `./auth` (line 9) and `logAuditEvent` needs to be imported from `@/lib/audit`.

---

### C28-02: `updateTag`, `deleteTag`, `addTagToImage`, `removeTagFromImage`, `batchAddTags`, `batchUpdateImageTags` lack audit logging — no accountability for tag mutations (MEDIUM / MEDIUM)

**File:** `apps/web/src/app/actions/tags.ts`, lines 40-287
**Category:** Audit / Security

All six tag mutating operations perform database mutations without calling `logAuditEvent`. Tags affect image visibility, search results, and gallery organization. A rogue admin could silently add or remove tags from images, alter tag names, or delete tags entirely without any audit trail.

**Failure scenario:** An admin silently removes all tags from a competitor's images, making them unfindable via tag search. No audit trail exists to detect the tampering.

**Fix:** Add `logAuditEvent` calls to all six functions. Import `getCurrentUser` from `@/app/actions/auth` and `logAuditEvent` from `@/lib/audit`.

```ts
// updateTag — after successful update:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_update', 'tag', String(id), undefined, { name: trimmedName, slug }).catch(console.debug);

// deleteTag — after successful deletion:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_delete', 'tag', String(id)).catch(console.debug);

// addTagToImage — after successful add:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_add', 'image', String(imageId), undefined, { tag: tagRecord.name }).catch(console.debug);

// removeTagFromImage — after successful remove:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tag_remove', 'image', String(imageId), undefined, { tag: tagName }).catch(console.debug);

// batchAddTags — after successful batch add:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tags_batch_add', 'image', undefined, undefined, { count: imageIds.length, tag: cleanName }).catch(console.debug);

// batchUpdateImageTags — after successful batch update:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'tags_batch_update', 'image', String(imageId), undefined, { added, removed }).catch(console.debug);
```

---

### C28-03: `deleteTopic` does not revalidate `/admin/dashboard` — stale dashboard after topic deletion (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/topics.ts`, line 204
**Category:** Cache consistency

When `deleteTopic` removes a topic, it revalidates `/admin/categories` and `/`, but not `/admin/dashboard`. The admin dashboard displays image counts grouped by topic. After a topic is deleted, the dashboard page cache still contains the old topic reference until another action triggers dashboard revalidation.

The dashboard page uses `force-dynamic`, but revalidation is still needed for Next.js ISR cache invalidation that may have been set by prior navigations.

**Failure scenario:** Admin deletes topic "nature". The categories page updates, but the admin dashboard still shows "nature" in the topic column for affected images (which now have an orphaned topic reference since the FK is RESTRICT — actually, the HAS_IMAGES check prevents this). However, the dashboard may still display stale topic count statistics.

**Fix:** Add `/admin/dashboard` to the revalidation call:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', '/', `/${slug}`);
```

---

### C28-04: `createTopic` does not revalidate `/admin/dashboard` — stale dashboard after topic creation (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/topics.ts`, line 80
**Category:** Cache consistency

Same pattern as C28-03. When `createTopic` adds a new topic, it revalidates `/admin/categories` and `/`, but not `/admin/dashboard`. The admin dashboard may display topic count statistics that don't include the newly created topic.

**Fix:** Add `/admin/dashboard` to the revalidation call:
```ts
revalidateLocalizedPaths('/admin/categories', '/admin/dashboard', '/');
```

---

### C28-05: `deleteTag` does not revalidate `/admin/dashboard` — stale dashboard after tag deletion (LOW / LOW)

**File:** `apps/web/src/app/actions/tags.ts`, line 91
**Category:** Cache consistency

When `deleteTag` removes a tag, it revalidates `/admin/tags` and `/`, but not `/admin/dashboard`. The admin dashboard displays tag names via GROUP_CONCAT. After a tag is deleted, the cached dashboard would still show the deleted tag name in the tag column for affected images.

Note: `updateTag` already revalidates `/admin/dashboard` (fixed in cycle 27), but `deleteTag` was missed.

**Fix:** Add `/admin/dashboard` to the revalidation call:
```ts
revalidateLocalizedPaths('/admin/tags', '/admin/dashboard', '/');
```

---

### C28-06: `createTopicAlias` and `deleteTopicAlias` lack audit logging — no accountability for alias mutations (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/topics.ts`, lines 216-281
**Category:** Audit / Security

Both `createTopicAlias` and `deleteTopicAlias` perform database mutations without calling `logAuditEvent`. Aliases create alternative URL paths that expose gallery content. Creating or deleting aliases affects the site's URL structure and content accessibility. Without audit logging, there is no forensic record of alias changes.

**Failure scenario:** An admin creates a topic alias that points to a private category, making it accessible via an alternative URL. Without audit logging, the alias creation cannot be traced.

**Fix:** Add `logAuditEvent` calls to both functions:

```ts
// createTopicAlias — after successful insert:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_alias_create', 'topic', topicSlug, undefined, { alias }).catch(console.debug);

// deleteTopicAlias — after successful deletion:
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'topic_alias_delete', 'topic', topicSlug, undefined, { alias }).catch(console.debug);
```

---

### C28-07: `updatePassword` does not log audit event — no accountability for password changes (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/auth.ts`, lines 218-335
**Category:** Audit / Security

The `updatePassword` server action performs a critical security mutation (changing the admin password hash and invalidating sessions) but does not call `logAuditEvent`. While `login_success` and `login_failure` are audited, password changes are not. This is important for detecting unauthorized password changes.

**Failure scenario:** A compromised admin session is used to change the password. Without audit logging, there is no record of the password change event, making it harder to reconstruct the timeline of a security incident.

**Fix:** Add audit logging after successful password change:
```ts
const currentUser = await getCurrentUser(); // already fetched at top of function
logAuditEvent(currentUser.id, 'password_change', 'user', String(currentUser.id)).catch(console.debug);
```

---

### C28-08: `logout` does not log audit event — no accountability for session termination (LOW / LOW)

**File:** `apps/web/src/app/actions/auth.ts`, lines 204-216
**Category:** Audit / Security

The `logout` server action deletes the session and cookie but does not call `logAuditEvent`. While `login_success` and `login_failure` are audited, logout events are not. This creates an incomplete session audit trail — you can see when sessions start but not when they end.

**Failure scenario:** After a security incident, the audit log shows login events but cannot correlate logout events, making it harder to determine the window of access for a compromised session.

**Fix:** Add audit logging before session deletion:
```ts
if (token) {
    const session = await verifySessionToken(token);
    if (session) {
        logAuditEvent(session.userId, 'logout', 'user', String(session.userId)).catch(console.debug);
    }
    await db.delete(sessions).where(eq(sessions.id, hashSessionToken(token))).catch(() => {});
}
```

---

### C28-09: `addTagToImage` and `removeTagFromImage` do not revalidate `/admin/tags` — stale tag counts after individual tag changes (LOW / LOW)

**File:** `apps/web/src/app/actions/tags.ts`, lines 99-170
**Category:** Cache consistency

When `addTagToImage` adds a tag, it revalidates the image page, homepage, topic page, and admin dashboard, but not `/admin/tags`. The tags page displays tag counts (number of images per tag). After adding a tag to an image, the cached tags page would still show the old count for that tag.

Similarly, `removeTagFromImage` does not revalidate `/admin/tags`.

Note: `batchAddTags` also does not revalidate `/admin/tags` (line 213), while `updateTag` and `deleteTag` do.

**Failure scenario:** Admin adds the tag "sunset" to 5 images via the image manager. The image pages update, but the tags page still shows "sunset" with count=0 until another action triggers tags page revalidation.

**Fix:** Add `/admin/tags` to the revalidation calls in `addTagToImage`, `removeTagFromImage`, and `batchAddTags`:
```ts
revalidateLocalizedPaths(`/p/${imageId}`, '/', '/admin/tags', img?.topic ? `/${img.topic}` : '', '/admin/dashboard');
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
7. **Input validation** — regex validation on photoId, isValidSlug, isValidTagName, isValidFilename, isValidTopicAlias all robust. No new issues.
8. **DB backup/restore** — Advisory lock, dangerous SQL scanning, header validation, --one-database flag, MYSQL_PWD env var. No new issues.
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
19. **deleteGroupShareLink transaction** — Fixed in cycle 27. No regression.
20. **Share link audit logging** — Fixed in cycle 27. No regression.
21. **updateTopic /admin/tags revalidation** — Fixed in cycle 27. No regression.
22. **updateTag /admin/dashboard revalidation** — Fixed in cycle 27. No regression.
23. **createTopicAlias / deleteTopicAlias /admin/dashboard revalidation** — Fixed in cycle 27. No regression.
24. **uploadImages and updateImageMetadata audit logging** — Fixed in cycle 27. No regression.

---

## TOTALS

- **0 CRITICAL** findings
- **2 MEDIUM** findings (C28-01: topic CRUD audit logging; C28-02: tag CRUD audit logging)
- **7 LOW** findings (C28-03 through C28-09)
- **9 total** findings
