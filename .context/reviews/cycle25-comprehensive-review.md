# Cycle 25 Comprehensive Review (2026-04-19)

**Reviewer:** multi-angle comprehensive review
**Scope:** Full codebase — server actions, data layer, image processing pipeline, rate limiting, session management, middleware, UI components, translation files, and cross-file interactions

---

## Methodology

Reviewed all server action modules (auth, images, tags, sharing, topics, admin-users, public), data layer (data.ts), image processing pipeline (process-image.ts, image-queue.ts), rate limiting (rate-limit.ts, auth-rate-limit.ts), session management (session.ts), validation (validation.ts), middleware (proxy.ts), DB schema (schema.ts), audit logging (audit.ts), and all UI components (image-manager, upload-dropzone, photo-viewer, admin-user-manager, password-form, topic-manager, tag-manager). Searched for: logic bugs, missed edge cases, race conditions, error-handling gaps, security weaknesses, performance issues, i18n gaps, and documentation-code mismatches. This is cycle 25; cycles 1-24 have already addressed most issues, so this review focuses on remaining subtle gaps and newly introduced patterns.

---

## Findings

### C25-01: `deleteGroupShareLink` missing admin auth check — inconsistent with all other sharing actions

**Severity:** MEDIUM
**Confidence:** HIGH
**File:** `apps/web/src/app/actions/sharing.ts`, lines 209-226

The `deleteGroupShareLink` function calls `isAdmin()` at line 211, which is correct. However, upon closer inspection, the function does NOT check whether the group actually exists before deletion. It relies on `affectedRows === 0` to return an error, but this is a post-hoc check. All other delete operations (deleteImage, deleteImages, deleteTopic, deleteAdminUser) first fetch the record and then delete it, providing a more consistent pattern and allowing for better error messages.

More importantly, `deleteGroupShareLink` does NOT call `revalidateLocalizedPaths` for any shared group page paths. When a group share link is deleted, any cached pages for `/g/{key}` would still serve stale content until ISR revalidation occurs naturally. Compare with `createGroupShareLink` which does call `revalidateLocalizedPaths('/')`.

**Concrete scenario:** Admin deletes a shared group link. The cached version of `/g/{key}` continues to serve the old group content until the ISR cache expires, potentially exposing deleted shared content.

**Fix:** Add `revalidateLocalizedPaths` with appropriate paths, or at minimum revalidate `/` and any known group paths. Also consider pre-checking the group exists for better error reporting consistency.

---

### C25-02: `revokePhotoShareLink` does not revalidate the shared link page `/s/{key}`

**Severity:** LOW
**Confidence:** MEDIUM
**File:** `apps/web/src/app/actions/sharing.ts`, lines 185-207

When `revokePhotoShareLink` successfully revokes a share key (sets `share_key` to null), it only revalidates `/p/${imageId}`. It does NOT revalidate the shared link page `/s/{key}`. If the shared page was cached by ISR, it would continue to serve the old cached page showing the photo even after the share link was revoked.

**Concrete scenario:** Admin shares a photo, the shared page `/s/abc123` gets ISR cached. Admin then revokes the share link. The cached `/s/abc123` page still shows the photo until ISR revalidation naturally expires.

**Fix:** Before clearing the share_key, save the old key value, then after the update, revalidate `/s/${oldKey}` as well.

---

### C25-03: `searchImages` in data.ts does not enforce a result limit at the SQL level for tag search

**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/lib/data.ts`, lines 568-574

The tag search query (line 568) uses `.limit(remainingLimit)` which correctly limits results. However, the `remainingLimit` is calculated as `effectiveLimit - results.length`. Since `results` could have up to `effectiveLimit` items, `remainingLimit` would be 0, and the ternary `remainingLimit <= 0 ? [] :` correctly short-circuits. This is correct but the tag search query uses `ORDER BY created_at DESC` without also ordering by `id DESC`, which could produce inconsistent ordering when multiple images have the same `created_at` timestamp. The main query at line 563 also only orders by `created_at`, not by the full `(capture_date, created_at, id)` tuple used by the gallery grid and `getImages`/`getImagesLite`.

**Concrete scenario:** Two images uploaded in the same second with different IDs could appear in different orders across page loads due to non-deterministic MySQL sorting for equal `created_at` values.

**Fix:** Add `desc(images.id)` as a secondary sort to both the main search query and the tag search query for deterministic ordering: `.orderBy(desc(images.created_at), desc(images.id))`.

---

### C25-04: `flushGroupViewCounts` re-buffers failed increments but the re-buffered count could be lost if the flush timer fires during re-buffering

**Severity:** LOW
**Confidence:** LOW
**File:** `apps/web/src/lib/data.ts`, lines 25-43

The `flushGroupViewCounts` function copies `viewCountBuffer` to a local `batch` Map, clears the global buffer, then processes each entry with `.catch()` re-buffering back into `viewCountBuffer`. If the flush timer fires again during the `Promise.all` (which is possible since the timer is cleared at the start), the re-buffered entries from failed flushes could be included in a second concurrent flush, leading to double-counting.

In practice, this is extremely unlikely because: (1) the timer is cleared at the start of `flushGroupViewCounts`, (2) `Promise.all` runs concurrently but JavaScript is single-threaded for the microtask queue, and (3) `setTimeout` with 5000ms is unlikely to fire during a DB update cycle.

However, there is no guard against concurrent flush calls (e.g., from `flushBufferedSharedGroupViewCounts` being called during an active flush).

**Concrete scenario:** Admin manually triggers `flushBufferedSharedGroupViewCounts` while the automatic flush is in progress. Failed increments from the first flush get re-buffered, and the second flush picks them up, potentially double-counting some views.

**Fix:** Add an `isFlushing` boolean guard to prevent concurrent flushes.

---

### C25-05: `admin-user-manager.tsx` create user form password input missing `autoComplete="new-password"` attribute

**Severity:** LOW
**Confidence:** HIGH
**File:** `apps/web/src/components/admin-user-manager.tsx`, line 98

The "Add Admin User" dialog has a password input at line 98 that lacks an `autoComplete` attribute. Without `autoComplete="new-password"`, the browser may autofill the admin password field with the user's own saved password for the site, or fail to offer password generation. This is the same class of issue as C24-02 which was fixed for the password change form.

**Concrete scenario:** Admin clicks "Add" to create a new admin user. Browser autofills the password field with the admin's own password. Admin submits, creating a new user with a weak/reused password.

**Fix:** Add `autoComplete="new-password"` to the password Input in the create user dialog.

---

## NOT A BUG / LOW PRIORITY

6. **C25-06**: `uploadTracker` in `images.ts` uses `uploadIp` as key, which falls back to "unknown" when `TRUST_PROXY` is not set. This means all unproxied uploads share the same rate limit bucket. This is intentional — the code even warns about it in `rate-limit.ts`. Not a bug.

7. **C25-07**: `searchImagesAction` in `public.ts` trims and slices the query to 200 chars before passing to `searchImages`. The `searchImages` function also trims and limits. This double-processing is defensive, not a bug.

8. **C25-08**: `bootstrapImageProcessingQueue` in `image-queue.ts` uses `void bootstrapImageProcessingQueue()` at module import time. This is intentional for auto-initialization. The `bootstrapped` flag prevents double initialization. Not a bug.

---

## Previously Fixed — Confirmed Resolved

All cycle 1-24 findings remain resolved. No regressions detected. Specifically confirmed:
- C24-01: `deletedIdSet = new Set(ids)` is present (image-manager.tsx line 128)
- C24-02: `autoComplete="current-password"` and `autoComplete="new-password"` are present (password-form.tsx lines 68, 82, 98)
- C24-03: `isDeleting` state and `disabled={isDeleting}` are present (admin-user-manager.tsx lines 31, 161)
- C23-01: `isAddingTag` guard is present on Enter key handler (image-manager.tsx line 232)
- C22-03: `handleUpload` catch block is present (upload-dropzone.tsx line 191)
- C19-01 through C19-05: All try/catch blocks confirmed present in their respective handlers

---

## Deferred Carry-Forward

All 17+2+2+3 previously deferred items from cycles 5-24 remain deferred with no change in status.

---

## TOTALS

- **0 CRITICAL** findings
- **0 HIGH** findings
- **1 MEDIUM** finding (C25-01)
- **4 LOW** findings (actionable: C25-02, C25-03, C25-04, C25-05)
- **3 LOW** findings (not-a-bug / low-priority: C25-06, C25-07, C25-08)
- **8 total** findings
