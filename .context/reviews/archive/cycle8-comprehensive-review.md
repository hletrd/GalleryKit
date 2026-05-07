# Comprehensive Code Review — Cycle 8 (2026-04-19)

**Reviewer:** Multi-angle comprehensive review (code quality, security, performance, architecture, UX, test coverage, correctness)

**Scope:** Full codebase — all server actions, data layer, middleware, UI components, auth, sharing, DB schema, queue processing, static file serving

---

## C8-01: `createGroupShareLink` insertId BigInt precision loss (MEDIUM / HIGH)

**File:** `apps/web/src/app/actions/sharing.ts:154`

```ts
const groupId = Number(result.insertId);
if (!Number.isFinite(groupId) || groupId <= 0) {
    throw new Error('Invalid insert ID from shared group creation');
}
```

**Problem:** `Number(result.insertId)` can silently lose precision for BigInt auto-increment IDs > 2^53. The same pattern was fixed for `uploadImages` and `createAdminUser` in prior cycles but `createGroupShareLink` was missed.

**Failure scenario:** If `shared_groups` table has > 9 million rows (unlikely but possible), `Number()` conversion of a BigInt `insertId` could produce an incorrect value, causing the subsequent `sharedGroupImages` insert to reference the wrong group.

**Fix:** Add `Number.isFinite(Number(result.insertId))` guard before the conversion, same pattern as `images.ts:165`. While the practical risk is low (would require millions of groups), the pattern should be consistent across all insert operations.

**Confidence:** HIGH — same bug class already fixed in other files.

---

## C8-02: `login-form.tsx` missing `maxLength` on username and password inputs (LOW / MEDIUM)

**File:** `apps/web/src/app/[locale]/admin/login-form.tsx:40-42`

```tsx
<Input id="login-username" type="text" name="username" placeholder={t('username')} required autoFocus autoComplete="username" />
<Input id="login-password" type="password" name="password" placeholder={t('password')} required autoComplete="current-password" />
```

**Problem:** Neither the username nor password input has a `maxLength` attribute. The password form already has `maxLength={1024}` added in cycle 7, but the login form was not updated.

**Failure scenario:** A malicious client could send multi-megabyte username/password strings to the login form. While Argon2 has its own length limits and the server validates in `updatePassword`, the `login` function does not explicitly cap password length before passing to `argon2.verify()`. A very long password (e.g., 1MB) would cause Argon2 to allocate excessive memory during verification.

**Fix:** Add `maxLength={64}` to the username input and `maxLength={1024}` to the password input on the login form, matching the constraints in `admin-users.ts` and `password-form.tsx`.

**Confidence:** HIGH — defense in depth, consistent with other form patterns.

---

## C8-03: `admin-user-manager.tsx` missing `maxLength` on create-user password input (LOW / MEDIUM)

**File:** `apps/web/src/components/admin-user-manager.tsx:86`

```tsx
<Input name="password" type="password" placeholder={t('users.password')} required minLength={12} />
```

**Problem:** The create-user password input has `minLength={12}` but no `maxLength`. The server-side validation in `admin-users.ts:34` caps at 1024 chars, but without the HTML attribute, the browser will accept unlimited input.

**Fix:** Add `maxLength={1024}` to match server-side validation.

**Confidence:** HIGH — consistent with password-form.tsx pattern.

---

## C8-04: `searchImages` does not enforce a maximum query length at the data layer (LOW / LOW)

**File:** `apps/web/src/lib/data.ts:535-536`

```ts
export async function searchImages(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
```

**Problem:** `searchImages` in `data.ts` does not validate query length. The caller `searchImagesAction` in `public.ts` does `query.trim().slice(0, 200)`, but `searchImages` itself is exported and could be called directly without this guard. Defense in depth would add a length check.

**Fix:** Add `if (query.length > 200) return [];` to `searchImages` for defense in depth.

**Confidence:** LOW — currently called only through the action which truncates. Low risk of direct misuse but good practice.

---

## C8-05: `deleteImage` audit log fires even when image not found (LOW / LOW)

**File:** `apps/web/src/app/actions/images.ts:309-310`

```ts
const currentUser = await getCurrentUser();
logAuditEvent(currentUser?.id ?? null, 'image_delete', 'image', String(id), undefined, {}).catch(console.debug);
```

**Problem:** The audit log call is placed after the DB delete but before checking if the DB actually deleted anything. If `id` is valid but the image was already deleted by another admin, the audit still fires `image_delete` for that ID, creating a misleading log entry.

**Fix:** Move the audit log inside a conditional that checks the delete was actually effective, or at least check `image` was found first (the image variable is already checked on line 271).

**Confidence:** MEDIUM — the image existence is checked earlier, so this only occurs on race conditions. But the audit log placement is still misleading.

---

## C8-06: `sharedGroup` page uses raw `←` character instead of i18n (LOW / MEDIUM)

**File:** `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx:119`

```tsx
← {siteConfig.nav_title || siteConfig.title || 'GalleryKit'}
```

**Problem:** The shared group page uses a raw `←` character while the shared photo page (`s/[key]/page.tsx:74`) uses the ArrowLeft icon with a translated string (`t('viewGallery')`). This is inconsistent — the group page should use the same i18n pattern.

**Fix:** Replace with `<ArrowLeft className="h-4 w-4" /> {t('viewGallery')}` and import `ArrowLeft` (already imported in the same file) and `getTranslations`.

**Confidence:** HIGH — visible inconsistency between two similar pages.

---

## C8-07: `exportImagesCsv` uses `user_filename` as "Filename" but includes title fallback (LOW / LOW)

**File:** `apps/web/src/app/[locale]/admin/db-actions.ts:38-39`

```ts
filename: images.user_filename,
title: images.title,
```

**Problem:** The CSV export includes both `user_filename` (as "Filename") and `title` as separate columns. This is correct — it was fixed in a prior cycle to use `user_filename` instead of `filename_original` for privacy. No issue here; noting for completeness that the current design is correct.

**Confidence:** N/A — informational, no action needed.

---

## C8-08: `getSharedGroup` view count increment happens even for expired groups returned in metadata (LOW / LOW)

**File:** `apps/web/src/lib/data.ts:474`

```ts
if (options?.incrementViewCount !== false) {
    bufferGroupViewCount(group.id);
}
```

**Problem:** When `getSharedGroupCached` is called from `generateMetadata` with `incrementViewCount: false` (line 20 of `g/[key]/page.tsx`), the view count is correctly not incremented. But when called from the page component (line 62) without the option, the view count IS incremented. This means each page load increments the view count once, which is the intended behavior. No issue found.

**Confidence:** N/A — confirmed correct behavior.

---

## C8-09: `admin-user-manager.tsx` delete confirmation uses `db.dangerZoneDesc` translation key instead of user-specific message (LOW / MEDIUM)

**File:** `apps/web/src/components/admin-user-manager.tsx:145`

```tsx
<AlertDialogDescription>{t('db.dangerZoneDesc')}</AlertDialogDescription>
```

**Problem:** The delete-user confirmation dialog reuses the DB restore's `dangerZoneDesc` message, which says something like "This will overwrite all data" — a message that doesn't make sense for deleting a user. This was likely a copy-paste error.

**Fix:** Use a user-specific translation key like `users.deleteConfirmDesc` that says something like "This action cannot be undone. All sessions for this user will be terminated."

**Confidence:** HIGH — the translation key is clearly wrong for the context.

---

## C8-10: `batchUpdateImageTags` count increment happens even when tag insert fails silently (LOW / LOW)

**File:** `apps/web/src/app/actions/tags.ts:250`

```ts
await tx.insert(imageTags).ignore().values({ imageId, tagId: tagRecord.id });
added++;
```

**Problem:** The `added` counter increments even if the `INSERT IGNORE` was ignored (duplicate key). This means the returned `added` count may be slightly higher than the actual number of new tag associations. Not a data integrity issue (the DB is correct), but the return value is misleading.

**Fix:** Check `result.affectedRows` after the insert to determine if it was actually added vs. ignored.

**Confidence:** LOW — minor UX inaccuracy, no data corruption.

---

## C8-11: `createTopic` has inconsistent i18n — some error strings still hardcoded English (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/topics.ts:40,47,54,87`

```ts
if (!label || !slug) return { error: 'Label and Slug are required' };          // line 40 — hardcoded
if (!isValidSlug(slug)) { return { error: 'Invalid slug format. Use only...' }; } // line 47 — hardcoded
if (label.length > 100) { return { error: 'Label is too long (max 100 characters)' }; } // line 53 — hardcoded
return { error: 'Topic slug or alias already exists' };                         // line 87 — hardcoded
```

**Problem:** Cycle 7 (Plan 45) only replaced 3 strings with `t()` calls (`reservedRouteSegment`, `slugConflictsWithRoute`, and one more). But several other user-facing error strings in `createTopic` remain hardcoded English, while `updateTopic`, `deleteTopic`, and `createTopicAlias` use `t()` consistently.

**Fix:** Add missing translation keys for these remaining hardcoded strings and use `t()` calls.

**Confidence:** HIGH — partial i18n is a clear inconsistency.

---

## C8-12: `updateTopic` hardcoded error strings remain (LOW / MEDIUM)

**File:** `apps/web/src/app/actions/topics.ts:174`

```ts
return { error: 'Topic slug already exists' };
```

**Problem:** The `ER_DUP_ENTRY` catch in `updateTopic` still has a hardcoded English string, while the `createTopic` equivalent at line 87 is also hardcoded. Both should use i18n.

**Fix:** Add `t('slugAlreadyExists')` translation key and use it.

**Confidence:** HIGH — same issue as C8-11, consistent pattern.

---

## C8-13: Login form `useEffect` with `state` dependency triggers toast on every render if error persists (LOW / LOW)

**File:** `apps/web/src/app/[locale]/admin/login-form.tsx:23-26`

```ts
useEffect(() => {
    if (state?.error) {
        toast.error(state.error);
    }
}, [state]);
```

**Problem:** The `useEffect` depends on `state`, which is a new object on every `useActionState` dispatch. If the server returns the same error (e.g., "Invalid credentials"), `state` is still a new object reference, so the toast fires again. This is actually the correct behavior — a new submission should show the error again. No issue.

**Confidence:** N/A — confirmed correct behavior.

---

## SUMMARY TABLE

| ID | Severity | Confidence | File | Issue |
|----|----------|------------|------|-------|
| C8-01 | MEDIUM | HIGH | sharing.ts:154 | createGroupShareLink insertId BigInt precision (same class as prior fixes) |
| C8-02 | LOW | HIGH | login-form.tsx:40-42 | Missing maxLength on username/password inputs |
| C8-03 | LOW | HIGH | admin-user-manager.tsx:86 | Missing maxLength on create-user password input |
| C8-04 | LOW | LOW | data.ts:535 | searchImages no query length guard (defense in depth) |
| C8-05 | LOW | MEDIUM | images.ts:309 | Audit log fires even on race-deleted image |
| C8-06 | LOW | MEDIUM | g/[key]/page.tsx:119 | Raw arrow character instead of i18n icon + string |
| C8-07 | — | — | db-actions.ts | Informational: CSV export is correct (no action) |
| C8-08 | — | — | data.ts | Informational: view count behavior is correct (no action) |
| C8-09 | LOW | HIGH | admin-user-manager.tsx:145 | Delete-user dialog uses wrong translation key (db.dangerZoneDesc) |
| C8-10 | LOW | LOW | tags.ts:250 | batchUpdateImageTags added count may be slightly inaccurate |
| C8-11 | LOW | HIGH | topics.ts:40,47,53,87 | createTopic has remaining hardcoded English strings |
| C8-12 | LOW | HIGH | topics.ts:174 | updateTopic hardcoded error string |
| C8-13 | — | — | login-form.tsx | Informational: useEffect behavior is correct (no action) |

**Actionable findings:** 10 (1 MEDIUM, 9 LOW)
**No-action (informational):** 3 (C8-07, C8-08, C8-13)
**CRITICAL/HIGH findings:** 0
