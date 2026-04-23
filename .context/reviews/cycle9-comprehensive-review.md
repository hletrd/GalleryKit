# Comprehensive Code Review — Cycle 9 (2026-04-19)

**Reviewer:** single multi-angle reviewer
**Scope:** Full repository — all server actions, data layer, middleware, UI components, API routes, DB schema

---

## File Inventory (All Reviewed)

### Server Actions
- `apps/web/src/app/actions.ts` (barrel re-export)
- `apps/web/src/app/actions/auth.ts`
- `apps/web/src/app/actions/images.ts`
- `apps/web/src/app/actions/topics.ts`
- `apps/web/src/app/actions/tags.ts`
- `apps/web/src/app/actions/admin-users.ts`
- `apps/web/src/app/actions/sharing.ts`
- `apps/web/src/app/actions/public.ts`

### Data & Lib Layer
- `apps/web/src/lib/data.ts`
- `apps/web/src/lib/rate-limit.ts`
- `apps/web/src/lib/auth-rate-limit.ts`
- `apps/web/src/lib/session.ts`
- `apps/web/src/lib/validation.ts`
- `apps/web/src/lib/process-image.ts`
- `apps/web/src/lib/process-topic-image.ts`
- `apps/web/src/lib/serve-upload.ts`
- `apps/web/src/lib/image-queue.ts`
- `apps/web/src/lib/queue-shutdown.ts`
- `apps/web/src/lib/audit.ts`
- `apps/web/src/lib/api-auth.ts`
- `apps/web/src/lib/revalidation.ts`
- `apps/web/src/lib/sql-restore-scan.ts`
- `apps/web/src/lib/safe-json-ld.ts`
- `apps/web/src/lib/clipboard.ts`
- `apps/web/src/lib/image-url.ts`
- `apps/web/src/lib/constants.ts`
- `apps/web/src/lib/base56.ts`
- `apps/web/src/lib/action-result.ts`
- `apps/web/src/lib/upload-limits.ts`
- `apps/web/src/lib/locale-path.ts`
- `apps/web/src/lib/image-types.ts`

### Database
- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`
- `apps/web/src/db/seed.ts`

### Middleware & Config
- `apps/web/src/proxy.ts`
- `apps/web/src/instrumentation.ts`

### UI Components
- `apps/web/src/components/image-manager.tsx`
- `apps/web/src/components/admin-user-manager.tsx`
- `apps/web/src/components/upload-dropzone.tsx`
- `apps/web/src/components/photo-viewer.tsx`
- `apps/web/src/components/image-zoom.tsx`
- `apps/web/src/components/lightbox.tsx`
- `apps/web/src/components/histogram.tsx`
- `apps/web/src/components/info-bottom-sheet.tsx`
- `apps/web/src/components/nav.tsx`
- `apps/web/src/components/nav-client.tsx`
- `apps/web/src/components/home-client.tsx`
- `apps/web/src/components/search.tsx`
- `apps/web/src/components/load-more.tsx`
- `apps/web/src/components/tag-input.tsx`
- `apps/web/src/components/tag-filter.tsx`
- `apps/web/src/components/footer.tsx`
- `apps/web/src/components/admin-header.tsx`
- `apps/web/src/components/admin-nav.tsx`
- `apps/web/src/components/i18n-provider.tsx`
- `apps/web/src/components/theme-provider.tsx`
- `apps/web/src/components/optimistic-image.tsx`
- `apps/web/src/components/lazy-focus-trap.tsx`
- `apps/web/src/components/topic-empty-state.tsx`

### Pages & Route Handlers
- `apps/web/src/app/[locale]/(public)/p/[id]/page.tsx`
- `apps/web/src/app/[locale]/(public)/[topic]/page.tsx`
- `apps/web/src/app/[locale]/(public)/page.tsx`
- `apps/web/src/app/[locale]/(public)/g/[key]/page.tsx`
- `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx`
- `apps/web/src/app/[locale]/admin/login-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/password/password-form.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx`
- `apps/web/src/app/[locale]/admin/(protected)/db/page.tsx`
- `apps/web/src/app/[locale]/admin/db-actions.ts`
- `apps/web/src/app/api/admin/db/download/route.ts`
- `apps/web/src/app/api/og/route.tsx`
- `apps/web/src/app/[locale]/(public)/uploads/[...path]/route.ts`
- `apps/web/src/app/uploads/[...path]/route.ts`

### Translations
- `apps/web/messages/en.json`
- `apps/web/messages/ko.json`

---

## Findings

### C9-01: i18n gap in auth.ts server actions (MEDIUM, High confidence)

**File:** `apps/web/src/app/actions/auth.ts`
**Lines:** 75-76, 79, 92, 99, 134, 186, 193, 253, 257, 261, 265, 279, 313, 317

All error and success messages in the `login()` and `updatePassword()` server actions are hardcoded English strings:

```typescript
// login()
return { error: 'Username is required' };
return { error: 'Password is required' };
return { error: 'Too many login attempts. Please try again later.' };
return { error: 'Invalid credentials' };
return { error: 'Authentication failed. Please try again.' };

// updatePassword()
return { error: 'All fields are required' };
return { error: 'New passwords do not match' };
return { error: 'New password must be at least 12 characters long' };
return { error: 'Password is too long (max 1024 characters)' };
return { error: 'Incorrect current password' };
return { error: 'Failed to update password' };
return { success: true, message: 'Password updated successfully.' };
```

**Why this matters:** The application supports English and Korean locales (via `next-intl`). The `topics.ts` server actions already use `getTranslations('serverActions')` for i18n (fixed in cycles 7-8). The auth actions serve the most user-facing pages — login and password change — where i18n matters most. A Korean-language user sees the login form in Korean but receives English error messages.

**Failure scenario:** A Korean user enters a wrong password and sees the English "Invalid credentials" message instead of a localized error. This breaks the multilingual UX contract.

**Fix:** Import `getTranslations` from `next-intl/server` and use `t('serverActions.xxx')` for all user-facing strings, matching the pattern already established in `topics.ts`. Add corresponding keys to `en.json` and `ko.json`.

---

### C9-02: i18n gap in admin-facing server actions (LOW, High confidence)

**Files:**
- `apps/web/src/app/actions/tags.ts` — lines 17, 34, 39, 43, 46, 49, 56, 68, 74, 78, 94, 96, 97, 100, 108, 127, 129, 165, 167, 173, 178, 181, 217, 220, 224
- `apps/web/src/app/actions/admin-users.ts` — lines 25, 30, 31, 32, 33, 34, 52, 55, 62, 69, 77, 83, 89, 91
- `apps/web/src/app/actions/images.ts` — lines 46, 47, 55, 57, 63, 67, 68, 84, 95, 103, 107, 119, 123, 232, 258, 322, 327, 332, 420, 423, 427, 444, 451
- `apps/web/src/app/actions/sharing.ts` — lines 50, 55, 58, 65, 70, 105, 111, 119, 125, 128, 129, 139, 141, 143, 179, 184, 187, 189, 191, 198, 210, 214, 216

Same pattern as C9-01 but for admin-only server actions. All error messages are hardcoded English strings shown via toast in the admin UI.

**Why lower severity:** These messages are only visible to authenticated admin users, who are more likely to be comfortable with English. However, for consistency with the `topics.ts` pattern and to support multilingual admin interfaces, these should also be localized.

**Fix:** Same approach as C9-01 — use `getTranslations('serverActions')` for all user-facing error strings.

---

### C9-03: Form inputs missing client-side maxLength (LOW, High confidence)

**Files and locations:**

1. `apps/web/src/components/admin-user-manager.tsx` line 82:
   - Username `<Input>` has `minLength={3}` but no `maxLength` attribute
   - Server validates `username.length > 64` but client doesn't enforce
   - Contrast: login form username input already has `maxLength={64}`

2. `apps/web/src/app/[locale]/admin/(protected)/categories/topic-manager.tsx` lines 140-141, 218-219:
   - Create form: `<Input name="label">` and `<Input name="slug">` — no `maxLength`
   - Edit form: `<Input name="label">` and `<Input name="slug">` — no `maxLength`
   - Server validates `label.length > 100` and `isValidSlug` (max 100)

3. `apps/web/src/app/[locale]/admin/(protected)/tags/tag-manager.tsx` line 146:
   - Edit form: `<Input name="name">` — no `maxLength`
   - Server validates `isValidTagName` (max 100)

4. `apps/web/src/components/image-manager.tsx` lines 404, 408:
   - Edit dialog: `<Input id="title">` — no `maxLength`
   - Edit dialog: `<Textarea id="description">` — no `maxLength`
   - Server validates `title.length > 255` and `description.length > 5000`

**Why this matters:** Without `maxLength`, a user can type or paste content exceeding the server limit, submit, and then receive a server-side error. Client-side `maxLength` provides immediate feedback and prevents unnecessary network requests. Previous cycles fixed `maxLength` on password inputs; the same defense-in-depth principle applies to all validated inputs.

**Fix:** Add `maxLength` attributes matching server-side validation limits:
- `admin-user-manager.tsx`: username `maxLength={64}`
- `topic-manager.tsx`: label `maxLength={100}`, slug `maxLength={100}` (both create and edit forms)
- `tag-manager.tsx`: name `maxLength={100}`
- `image-manager.tsx`: title `maxLength={255}`, description `maxLength={5000}`

---

## Previously Reviewed — No New Issues Found

The following areas were thoroughly re-examined and found to be sound, with no new issues:

- **Session management** (`auth.ts`, `session.ts`): Token generation, HMAC verification, timing-safe comparison, cookie security attributes all correct. Pre-increment rate limit pattern properly implemented.
- **Upload security** (`images.ts`, `process-image.ts`, `serve-upload.ts`): Path traversal prevention, filename sanitization via UUID, symlink rejection, containment checks, decompression bomb limits all intact.
- **Database operations** (`data.ts`, `db-actions.ts`): Parameterized queries via Drizzle, transaction usage for multi-step operations, LIKE wildcard escaping, CSV injection prevention all correct.
- **Race condition protections** (`image-queue.ts`, `sharing.ts`, `images.ts`): Queue claim check, conditional UPDATE, INSERT IGNORE for tag dedup, transactional deletes all working as designed.
- **Middleware auth guard** (`proxy.ts`): Cookie format check + server action `isAdmin()` defense in depth pattern is correct.
- **DB backup/restore** (`db-actions.ts`, `download/route.ts`): Advisory lock, SQL scan for dangerous patterns, file header validation, path containment, filename regex all correct.
- **Rate limiting** (`rate-limit.ts`, `auth-rate-limit.ts`): Pre-increment TOCTOU fix, hard cap on Maps, DB-backed accuracy check all working.
- **Privacy** (`data.ts`): GPS coordinates and `filename_original` excluded from public queries. Verified.
- **JSON-LD XSS prevention** (`safe-jsonLd.ts`): `<` character escaped to `\u003c`. Correct.

---

## No-Action Items (Confirmed Correct)

1. `login-form.tsx` useEffect with state.error dependency: `useActionState` only produces a new state when the action completes, so the toast fires once per submission. Not a duplicate-fire issue.
2. `process-topic-image.ts` temp file cleanup: Both `tempPath` and `outputPath` are cleaned up in the catch block. Correct.
3. `upload-dropzone.tsx` using plain `<img>` for blob URL previews: Intentional — Next.js Image optimization doesn't support blob URLs. ESLint disable comment present.
4. `admin-user-manager.tsx` delete action: `setDeleteTarget(null)` closes dialog immediately, preventing double-click. Correct.
5. `photo-viewer.tsx` direct `document.title` mutation: Page metadata already set by `generateMetadata`; client-side update is for smooth navigation. Correct.

---

## TOTALS

- **1 MEDIUM** finding (C9-01: auth.ts i18n gap)
- **2 LOW** findings (C9-02: admin actions i18n gap, C9-03: missing maxLength on form inputs)
- **0 CRITICAL/HIGH** findings
- **3 total** actionable findings
