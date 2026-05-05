# Cycle 18 — Code Reviewer Findings

Date: 2026-05-06
Scope: Full repository, post-cycle-17 fixes (commits 38077b9, 4d1f323, 80a1956, 0d243db)
Focus: Code quality, logic correctness, edge cases, maintainability

## Verified Prior Fixes

- C17-MED-01 (missing EXIF hints in upload): FIXED in 38077b9 — `camera_model` and `capture_date` now passed to `enqueueImageProcessing`.
- C17-MED-02 (missing iccProfileName in upload): FIXED in 38077b9 — `iccProfileName` now passed.
- C17-MED-03 (icc_profile_name schema column): FIXED in 4d1f323 — column added with migration 0014.
- C17-LOW-01 (SW NaN age check): FIXED in 0d243db — `!Number.isNaN(age)` validated before comparison.

---

## New Findings

### HIGH SEVERITY

**C18-HIGH-01: Stripe checkout idempotency key includes randomUUID, defeating deduplication**
- **File:** `apps/web/src/app/api/checkout/[imageId]/route.ts:150-151`
- **Confidence:** HIGH
- **Cross-file:** Introduced by fix for C17-SEC-01 (commit 80a1956)
- **Problem:** The idempotency key is `checkout-${image.id}-${ip}-${minute}-${randomUUID()}`. Because `randomUUID()` is unique per request, EVERY checkout request gets a distinct idempotency key. Stripe's server-side deduplication is therefore completely disabled. A visitor double-clicking the Buy button creates TWO checkout sessions instead of one. The original intent ("collapse rapid duplicates") is void.
- **Root cause:** C17-SEC-01 identified that when TRUST_PROXY is unset, all users share IP `'unknown'`, causing key collision. The fix appended randomUUID to prevent cross-user collision, but this overcorrected and removed SAME-user deduplication too.
- **Fix:** Make the key deterministic per user/session context while keeping distinct users separate. Use a hash of the admin session cookie (if present) or a fingerprint of IP + User-Agent. If truly anonymous, use `ip` alone but accept that deduplication only works when TRUST_PROXY is configured.

---

### MEDIUM SEVERITY

**C18-MED-01: Service Worker cache.delete uses URL string while put/match use Request object**
- **File:** `apps/web/public/sw.template.js:94` / `apps/web/public/sw.js:94`
- **Confidence:** MEDIUM
- **Problem:** `recordAndEvict` calls `imageCache.delete(entry.url)` (string URL), but entries were stored via `imageCache.put(request, ...)` (Request object). The Cache API may not match a string URL against a Request-keyed entry when Vary headers or request method differ. This means LRU eviction may fail to remove actual cache entries while the metadata Map is updated, causing unbounded cache growth beyond the 50 MB cap.
- **Fix:** Store the Request object (or reconstruct it from URL) in metadata and use `imageCache.delete(request)` for consistent key semantics. Or use string URLs consistently for both put and delete.

**C18-MED-02: Semantic search min-length check uses UTF-16 code units**
- **File:** `apps/web/src/app/api/search/semantic/route.ts:111`
- **Confidence:** MEDIUM
- **Problem:** `query.length < 3` counts UTF-16 code units, not code points. A 2-emoji query has `length === 4` but only 2 logical characters, incorrectly passing the minimum-length gate. This is inconsistent with the rest of the codebase which uses `countCodePoints` for user-facing length validation.
- **Fix:** Import `countCodePoints` from `@/lib/utils` and use `countCodePoints(query) < 3`.

---

### LOW SEVERITY

**C18-LOW-01: Caption/embedding hooks race with deletion after processed=true**
- **File:** `apps/web/src/lib/image-queue.ts:351-400`
- **Confidence:** LOW
- **Problem:** The fire-and-forget `generateCaption` and embedding IIFE run after `processed=true` is committed but are not guarded against concurrent deletion. If an admin deletes the image in the narrow window between the UPDATE commit and hook execution, both hooks attempt DB UPDATEs on non-existent rows. Errors are caught and logged at warn level, but CPU is wasted.
- **Fix:** Optional: add an existence check before the caption/embedding DB writes, or accept the current behavior since it is non-fatal.

**C18-LOW-02: Service Worker HTML route detection misses navigate-mode requests**
- **File:** `apps/web/public/sw.template.js:42` / `apps/web/public/sw.js:42`
- **Confidence:** LOW
- **Problem:** `isHtmlRoute` only checks `Accept: text/html`. Some browser navigation contexts send `Accept: */*`, causing HTML routes to fall through to "pass through to network" instead of using the network-first strategy. Offline fallback is lost for those navigations.
- **Fix:** Add `request.mode === 'navigate'` as a fallback check when Accept doesn't include text/html.
