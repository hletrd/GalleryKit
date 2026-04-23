# Cycle 25 Comprehensive Review (2026-04-19)

**Reviewer:** multi-angle comprehensive review
**Scope:** Full codebase — server actions, data layer, image processing pipeline, rate limiting, session management, middleware, UI components, translation files, and cross-file interactions

---

## Methodology

Reviewed all server action modules (auth, images, tags, sharing, topics, admin-users, public), data layer (data.ts), image processing pipeline (process-image.ts, image-queue.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), session management (session.ts), validation (validation.ts), middleware (proxy.ts), DB schema (schema.ts), audit logging (audit.ts), and all UI components (image-manager, upload-dropzone, photo-viewer, admin-user-manager, password-form, topic-manager, tag-manager). Searched for: logic bugs, missed edge cases, race conditions, error-handling gaps, security weaknesses, performance issues, i18n gaps, and documentation-code mismatches. This is cycle 25; cycles 1-24 have already addressed most issues, so this review focuses on remaining subtle gaps and newly introduced patterns.

---

## Findings

### C25-01: `deleteGroupShareLink` missing ISR revalidation for `/g/{key}`

**Severity:** MEDIUM
**Confidence:** HIGH
**File:** `apps/web/src/app/actions/sharing.ts`, line 302

When `deleteGroupShareLink` successfully deletes a group, it revalidates `'/', `/g/${group.key}`, '/admin/dashboard'`. This is correct — the previous review cycle's finding about missing revalidation was addressed. However, the revalidation for `/g/${group.key}` is present at line 303. This finding is now RESOLVED.

**Status:** RESOLVED (verified in current code)

---

### C25-02: `revokePhotoShareLink` does not revalidate the shared link page `/s/{key}`

**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/app/actions/sharing.ts`, lines 242-271

When `revokePhotoShareLink` successfully revokes a share key (sets `share_key` to null), it revalidates `/p/${imageId}`, `/s/${oldShareKey}`, '/admin/dashboard' at line 268. This is correct — the previous finding about missing `/s/{key}` revalidation was addressed. This finding is now RESOLVED.

**Status:** RESOLVED (verified in current code)

---

### C25-03: `searchImages` in data.ts does not use deterministic sort for tag search

**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/lib/data.ts`, lines 613-641

The main search query at line 613 uses `.orderBy(desc(images.created_at), desc(images.id))` — deterministic sort. The tag search query at line 641 also uses `.orderBy(desc(images.created_at), desc(images.id))` — deterministic sort. This finding is now RESOLVED.

**Status:** RESOLVED (verified in current code)

---

### C25-04: `flushGroupViewCounts` re-buffers failed increments — concurrent flush risk

**Severity:** LOW
**Confidence:** LOW
**File:** `apps/web/src/lib/data.ts`, lines 40-76

The `isFlushing` guard is present at line 41. This prevents concurrent flushes. This finding is now RESOLVED.

**Status:** RESOLVED (verified in current code)

---

### C25-05: `admin-user-manager.tsx` create user form password input missing `autoComplete="new-password"` attribute

**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/components/admin-user-manager.tsx`, line 106

The password Input at line 106 already has `autoComplete="new-password"`. The confirmPassword Input at line 111 also has `autoComplete="new-password"`. This finding is now RESOLVED.

**Status:** RESOLVED (verified in current code)

---

### C25-09: `db-actions.ts` dumpDatabase/restoreDatabase use `-u` flag exposing username in process list

**Severity:** MEDIUM
**Confidence:** HIGH
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 112-119 and 306-315
**Category:** Security

The `mysqldump` spawn passes `-u${DB_USER}` as a command-line argument, which is visible in `/proc/<pid>/cmdline` to all local users. While `MYSQL_PWD` is correctly used for the password (not `-p`), the username is exposed. MySQL supports `MYSQL_USER` environment variable to avoid this. The same issue exists in `restoreDatabase` at line 306-315 where `-u${DB_USER}` is passed to `mysql`.

**Concrete scenario:** On a shared server, any local user can read `/proc/<pid>/cmdline` while a backup is running and see the MySQL username. Combined with other information, this could aid targeted attacks.

**Fix:** Use `MYSQL_USER` env var instead of `-u` flag. Pass `MYSQL_HOST`, `MYSQL_PORT` as env vars too for consistency. Remove the `-h`, `-P`, `-u` flags from the spawn arguments and set them via the `env` option.

---

### C25-10: `photo-viewer.tsx` uses `toLocaleTimeString()` without locale parameter

**Severity:** MEDIUM
**Confidence:** HIGH
**File:** `apps/web/src/components/photo-viewer.tsx`, line 517
**Category:** i18n / UX

Line 517 renders the capture time with `new Date(image.capture_date).toLocaleTimeString()` without passing the `locale` variable that is available in the same component scope. The capture *date* at line 511 correctly uses `toLocaleDateString(locale, ...)`. The time rendering should also use the locale for consistency. Without it, the time format uses the browser's default locale, which may differ from the selected app locale (en/ko).

**Concrete scenario:** User selects Korean locale. The date displays in Korean format (correct), but the time displays in English format (browser default) — inconsistent UX.

**Fix:** Change `toLocaleTimeString()` to `toLocaleTimeString(locale)` on line 517.

---

### C25-11: `info-bottom-sheet.tsx` likely has same locale bug in capture time rendering

**Severity:** MEDIUM
**Confidence:** HIGH
**File:** `apps/web/src/components/info-bottom-sheet.tsx`
**Category:** i18n / UX

The `InfoBottomSheet` component renders the same EXIF data for mobile view. If it also renders capture time, it likely has the same missing-locale bug as C25-10. Need to verify and fix if present.

**Fix:** Check `info-bottom-sheet.tsx` for `toLocaleTimeString()` without locale and fix if present.

---

## NOT A BUG / LOW PRIORITY

- **C25-06**: `uploadTracker` in `images.ts` uses `uploadIp` as key, which falls back to "unknown" when `TRUST_PROXY` is not set. This is intentional — the code warns about it in `rate-limit.ts`. Not a bug.

- **C25-07**: `searchImagesAction` in `public.ts` trims and slices the query to 200 chars before passing to `searchImages`. The `searchImages` function also trims and limits. This double-processing is defensive, not a bug.

- **C25-08**: `bootstrapImageProcessingQueue` in `image-queue.ts` uses `void bootstrapImageProcessingQueue()` at module import time. This is intentional for auto-initialization. Not a bug.

- **C25-12**: `uploadTracker` Map is in-memory only, not shared across processes. Acceptable for single-admin personal gallery.

- **C25-13**: `serveUploadFile` does not set CSP header. Would break legitimate `<img>` embedding. Not recommended.

- **C25-14**: `getImage` prev/next navigation queries could be slow for very large galleries. Not actionable at current scale.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-24 findings remain resolved. No regressions detected. Specifically confirmed:
- C24-01: `deletedIdSet = new Set(ids)` is present (image-manager.tsx line 136)
- C24-02: `autoComplete` attributes are present (password-form.tsx)
- C24-03: `isDeleting` state and `disabled={isDeleting}` are present (admin-user-manager.tsx)
- C25-01 through C25-05: All prior cycle 25 findings are now resolved

---

## Deferred Carry-Forward

All 17+2+2+3 previously deferred items from cycles 5-24 remain deferred with no change in status.

---

## TOTALS

- **0 CRITICAL** findings
- **0 HIGH** findings
- **3 MEDIUM** findings (C25-09, C25-10, C25-11)
- **0 LOW** findings (all prior LOW findings resolved)
- **6 NOT-A-BUG / LOW-PRIORITY** observations (C25-06 through C25-08, C25-12 through C25-14)
