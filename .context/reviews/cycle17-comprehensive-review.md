# Comprehensive Code Review — Cycle 17 (2026-04-19)

**Reviewer:** General-purpose agent (multi-angle: code quality, security, performance, architecture, UX)
**Scope:** Full repository scan of all source files in `apps/web/src/`

---

## Findings

### C17-01 — `getImages` and `getImagesLite` data-layer limit cap still at 500 (defense in depth)

**Severity:** LOW | **Confidence:** HIGH
**File:** `apps/web/src/lib/data.ts`, lines 232, 258

The `searchImages` data-layer cap was reduced from 500 to 100 in cycle 16, but `getImages` and `getImagesLite` still cap `effectiveLimit` at 500. While the action layer (`loadMoreImages`) caps at 100 and no current caller passes limit > 100, the data-layer cap of 500 is inconsistent with the `searchImages` hardening and could be invoked by future callers.

**Fix:** Reduce the cap from 500 to 100 in both functions for consistency:
```ts
const effectiveLimit = limit > 0 ? Math.min(limit, 100) : 100;
```

---

### C17-02 — `login` function returns `{ error: t('invalidCredentials') }` from the outer catch block even on infrastructure errors

**Severity:** LOW | **Confidence:** MEDIUM
**File:** `apps/web/src/app/actions/auth.ts`, line 202

After the outer `catch` block rolls back the rate limit, it falls through to `return { error: t('invalidCredentials') }` (line 202). This means if an unexpected error occurs during the login process (e.g., DB connection failure during the SELECT query), the user sees "Invalid credentials" instead of a generic error message. The `updatePassword` function correctly returns `t('failedToUpdatePassword')` from its outer catch.

**Fix:** Move the `return { error: t('invalidCredentials') }` inside the `try` block after the `if (!user || !verified)` check, and add a specific error return in the outer catch:
```ts
} catch (e) {
    if (isRedirectError(e)) throw e;
    console.error("Login verification failed:", ...);
    // Roll back...
    return { error: t('authFailed') };  // generic error, not "invalid credentials"
}
// Remove the fall-through return at line 202
```

---

### C17-03 — `handleBatchAddTag` in `image-manager.tsx` does not disable the button during the async `isAddingTag` state properly

**Severity:** LOW | **Confidence:** HIGH
**File:** `apps/web/src/components/image-manager.tsx`, lines 159-170

The `handleBatchAddTag` function does not set `isAddingTag` to `true` before the async call and does not reset it on failure. The `AlertDialogAction` has `disabled={isAddingTag}` but the state is never actually toggled by the handler:
- `setIsAddingTag(false)` is called on success (line 164)
- But `isAddingTag` is never set to `true` at the start of the function
- On failure, `isAddingTag` stays at whatever value it was before

**Fix:** Add `setIsAddingTag(true)` at the start of `handleBatchAddTag`, and add `setIsAddingTag(false)` in the else branch and a try/finally wrapper.

---

### C17-04 — `deleteTopicAlias` does not call `isReservedTopicRouteSegment` for the alias being deleted

**Severity:** VERY LOW | **Confidence:** LOW
**File:** `apps/web/src/app/actions/topics.ts`, lines 254-281

`createTopicAlias` validates that the alias is not a reserved route segment before creating it. However, `deleteTopicAlias` only validates the format via `isValidTopicAlias` — it does not check `isReservedTopicRouteSegment`. This is not a security issue (deleting a reserved alias is fine), but it means legacy reserved aliases that somehow got created could be deleted without the same guard. This is very low priority since deleting is the desired action.

**Verdict:** No fix needed — deleting is the correct operation regardless.

---

### C17-05 — `searchImages` in `data.ts` uses `limit` parameter directly in `combined.slice(0, limit)` instead of `effectiveLimit`

**Severity:** LOW | **Confidence:** HIGH
**File:** `apps/web/src/lib/data.ts`, line 585

The function computes `effectiveLimit` to clamp the input `limit` to [1, 100], but then on line 585 it uses the raw `limit` parameter in `combined.slice(0, limit)` instead of `effectiveLimit`. If a caller passes `limit = -5`, `effectiveLimit` would be 1, but `combined.slice(0, -5)` would return an empty array. While current callers always pass valid limits, this is an inconsistency.

**Fix:** Change `combined.slice(0, limit)` to `combined.slice(0, effectiveLimit)`.

---

### C17-06 — `createGroupShareLink` validates `uniqueImageIds.length > 100` but the `sharedGroupImages` query in `getSharedGroup` is limited to 100 images

**Severity:** VERY LOW | **Confidence:** MEDIUM
**File:** `apps/web/src/lib/data.ts`, line 443; `apps/web/src/app/actions/sharing.ts`, line 127

When creating a shared group, up to 100 images can be added. However, `getSharedGroup` limits the query to 100 images (`limit(100)` on line 443). If the group was created with exactly 100 images, they all fit. But if the group was somehow created with more (future change), they'd be silently truncated. This is not a current issue since creation is capped at 100.

**Verdict:** No fix needed — consistent at current limits.

---

### C17-07 — `admin-user-manager.tsx` create user form does not validate username format client-side

**Severity:** VERY LOW | **Confidence:** MEDIUM
**File:** `apps/web/src/components/admin-user-manager.tsx`, line 82

The server-side `createAdminUser` validates username format with `/^[a-zA-Z0-9_-]+$/`, but the client-side `<Input>` only has `minLength={3} maxLength={64}` and no `pattern` attribute. This means a user could type spaces or special characters, submit, and get a server error instead of instant client-side feedback.

**Fix:** Add `pattern="[a-zA-Z0-9_-]+"` to the username Input.

---

### C17-08 — `photo-viewer.tsx` `document.title` cleanup restores previous title which may be stale on SPA navigation

**Severity:** VERY LOW | **Confidence:** LOW
**File:** `apps/web/src/components/photo-viewer.tsx`, lines 72-78

The `useEffect` that updates `document.title` captures `previousTitle` from `document.title` on mount, and restores it on cleanup. However, if the user navigates between photos (SPA-style via prev/next), each photo's cleanup will restore the previous photo's title instead of the original page title. This is a very minor cosmetic issue since the next effect immediately sets the correct title.

**Verdict:** No fix needed — cosmetic, self-correcting.

---

### C17-09 — `isValidTopicAlias` allows `&` character which could break URL encoding in some edge cases

**Severity:** VERY LOW | **Confidence:** LOW
**File:** `apps/web/src/lib/validation.ts`, line 45

The regex `^[^/\\\s?#<>"'&]+$` excludes `&` (ampersand), which is good. Actually, checking the regex more carefully, the `&` IS excluded (it's in the negated character class). This is correct. No issue.

**Verdict:** No fix needed — false alarm on my part.

---

### C17-10 — `gcInterval` timer in `image-queue.ts` is never unref'd

**Severity:** LOW | **Confidence:** HIGH
**File:** `apps/web/src/lib/image-queue.ts`, line 276

The `setInterval` for GC (session purge + rate-limit bucket purge + retry map pruning) runs every hour. Unlike the `viewCountFlushTimer` which was fixed in cycle 16 to call `.unref()`, this `setInterval` keeps the Node.js event loop alive during idle periods. In Docker containers, this means the process won't exit cleanly on SIGTERM until the next interval tick fires (up to 1 hour), though the `instrumentation.ts` shutdown handler should drain the queue first and call `process.exit(0)`.

However, if the graceful shutdown handler fails or is bypassed (e.g., SIGKILL), the interval keeps the process alive. Adding `.unref()` would be consistent with the viewCount timer fix.

**Fix:** Add `.unref()` after the `setInterval` call:
```ts
state.gcInterval = setInterval(() => { ... }, 60 * 60 * 1000);
state.gcInterval.unref?.();
```

---

## Summary

| ID | Severity | Confidence | File | Description |
|----|----------|------------|------|-------------|
| C17-01 | LOW | HIGH | data.ts:232,258 | getImages/getImagesLite limit cap at 500, inconsistent with searchImages cap of 100 |
| C17-02 | LOW | MEDIUM | auth.ts:202 | Login outer catch returns "invalid credentials" for infrastructure errors |
| C17-03 | LOW | HIGH | image-manager.tsx:159 | handleBatchAddTag never sets isAddingTag=true before async call |
| C17-05 | LOW | HIGH | data.ts:585 | searchImages uses raw `limit` instead of `effectiveLimit` in slice |
| C17-07 | VERY LOW | MEDIUM | admin-user-manager.tsx:82 | Create user form lacks client-side username pattern validation |
| C17-10 | LOW | HIGH | image-queue.ts:276 | GC interval timer never unref'd (same class as C16-01) |

**0 CRITICAL/HIGH**, **0 MEDIUM**, **4 LOW**, **2 VERY LOW** = **6 total findings**

---

## Previously Fixed — Confirmed

All cycle 1-16 findings remain resolved. No regressions detected. Key verifications:
- Empty catch blocks: all have console.debug (verified via grep)
- confirm() calls: fully eliminated (verified via grep)
- viewCount flush timer: unref'd (confirmed in data.ts line 21)
- searchImages cap: reduced to 100 (confirmed in data.ts line 539)
- BASE_URL: centralized in constants.ts (confirmed)
- Password confirmation: client-side check present (confirmed in password-form.tsx)

---

## Deferred Carry-Forward

All 17 previously deferred items from cycles 5-16 remain deferred with no change in status.
