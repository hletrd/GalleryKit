# Cycle 17 — Comprehensive Multi-Perspective Review

**Date:** 2026-04-30
**Reviewer:** consolidated (code quality, security, performance, architecture, correctness, test coverage)

## Scope

All source files under `apps/web/src/`, focused on recently-modified and high-risk surfaces: data layer, auth/session, rate limiting, sharing, upload pipeline, admin actions, middleware, CSP, and test coverage.

---

## NEW FINDINGS

### C17-MED-01: `loadMoreImages` DB rate-limit counter incremented on `rateLimited` fast-path exit [MEDIUM, HIGH confidence]

**File:** `apps/web/src/app/actions/public.ts:99-121`

**Description:** When the in-memory pre-increment detects the request is over the limit (line 99), the function returns `rateLimited` immediately. However, the DB increment at line 107 has NOT yet run at that point, so the in-memory and DB counters are out of sync. On the NEXT request from the same IP, the in-memory counter is already high, but the DB counter is missing that prior increment. This means a process restart could allow a burst that exceeds the intended rate.

More critically: when the in-memory check on line 99 returns rate-limited, the function returns without calling `rollbackLoadMoreAttempt`. So the in-memory counter stays incremented (correct — the request should count), but the DB counter was never incremented for that request. After a restart, those in-memory-only increments are lost, giving the user a fresh budget in the DB.

This is the same pattern as `searchImagesAction` which DOES increment the DB counter even when the fast-path check succeeds (lines 166-170 happen before the DB-backed check at line 175). In `searchImagesAction`, the in-memory pre-increment always happens, and then the DB-backed check may trigger a rollback. In `loadMoreImages`, when the in-memory pre-increment catches the over-limit case, the DB increment is never attempted.

**Failure scenario:** Attacker sends 120 rapid requests. The in-memory map correctly rate-limits at request 121. Process restarts. Attacker gets 120 more requests because the DB counter only has ~100-110 increments (the ones that made it past the in-memory check to the DB increment step).

**Suggested fix:** Move the DB increment BEFORE the in-memory over-limit check (matching searchImagesAction pattern), or add a DB increment even on the rate-limited exit path.

---

### C17-MED-02: `getImage` navigation query can return wrong prev/next when multiple images share identical (capture_date, created_at) [MEDIUM, MEDIUM confidence]

**File:** `apps/web/src/lib/data.ts:762-861`

**Description:** The prev/next navigation in `getImage` uses `(capture_date, created_at, id)` as the sort key, but the prev query orders by `asc(capture_date, created_at, id)` while the next query orders by `desc(capture_date, created_at, id)`. The `id` tiebreaker ensures deterministic ordering when all three fields match, which is correct.

However, there is a subtle issue with the prevConditions for dated images: the `isNull(images.capture_date)` condition is NOT included in the dated-image prev branch (line 774-778). This means a dated image's "prev" query will only find dated predecessors, not undated ones. While this matches the documented sort order (undated = NULLS LAST in DESC = first in ASC), the next branch for dated images (line 786-790) DOES include `isNull(capture_date)`.

This asymmetry is actually correct for the sort order, but the comment at line 781-783 says "Undated rows (NULL) sort LAST in ASC, so they are NOT predecessors of dated rows." This is correct, but only because the `isNotNull(capture_date)` guards on lines 775-777 implicitly exclude undated rows. If someone removes those guards as a "simplification," undated rows would start appearing as predecessors, breaking the sort-order invariant.

**Suggested fix:** Add a defensive comment in the prev branch noting that `isNotNull(capture_date)` is load-bearing and must not be removed, matching the C10-LOW-01 comment style already used elsewhere.

---

### C17-MED-03: `normalizeImageListCursor` accepts `created_at` as `Date` but `getImagesLite` offset path truncates it [MEDIUM, LOW confidence]

**File:** `apps/web/src/lib/data.ts:610-614`

**Description:** When `offsetOrCursor` is not a valid cursor object, the code falls back to `Math.floor(Number(offsetOrCursor))`. If someone passes a `Date` object (which `normalizeImageListCursor` would reject, returning null), the code falls through to `safeOffset`. But if the offsetOrCursor is a string like "2026-01-01" (not a valid cursor but also not a number), `Number("2026-01-01")` returns NaN, so `Math.floor(NaN) || 0` gives 0. This is actually safe behavior but could be surprising — a malformed cursor string silently resets to offset 0.

**Confidence reduced** because the function validates cursor shape before reaching this path, and `normalizeImageListCursor` returns null for invalid shapes, which causes `usesCursor` to be false.

**Suggested fix:** No code change needed. This is informational — document the fallback behavior in a comment.

---

### C17-LOW-01: `getImageByShareKey` tag parsing splits on comma without considering null-byte-containing slugs [LOW, MEDIUM confidence]

**File:** `apps/web/src/lib/data.ts:913`

**Description:** The GROUP_CONCAT result is split on `,` (the GROUP_CONCAT separator). If a tag slug ever contained a null byte (`\0`), the split on comma would be correct but the `entry.indexOf('\0')` would find it at an unexpected position. However, `isValidTagSlug` uses `\p{Letter}` and `\p{Number}` which cannot match null bytes, so this is theoretical. The code already has a `nullIdx === -1` guard for malformed entries.

**Suggested fix:** No code change needed. Theoretical only.

---

### C17-LOW-02: `flushGroupViewCounts` does not clear `viewCountRetryCount` entries on successful flush [LOW, MEDIUM confidence]

**File:** `apps/web/src/lib/data.ts:86`

**Description:** When a group's increment is successfully flushed, the code calls `viewCountRetryCount.delete(groupId)` on line 86. This is correct. However, the `viewCountRetryCount` Map is only fully pruned when `viewCountBuffer.size === 0` (line 145). If the buffer never empties (sustained traffic), the stale retry count entries for groups that were successfully flushed in a prior chunk are only cleaned up by the hard-cap eviction at lines 156-166, not proactively. Since each successful flush already deletes the specific entry (line 86), this is not a leak — just a note that the full clear on line 146 is rarely reached under sustained traffic.

**Suggested fix:** No code change needed. Informational.

---

### C17-LOW-03: `searchImages` main branch does not use `searchGroupByColumns` for consistency [LOW, HIGH confidence]

**File:** `apps/web/src/lib/data.ts:1124`

**Description:** The comment at line 1120-1123 explains why GROUP BY is omitted (no tag JOIN). However, if someone later adds a JOIN to the main branch, GROUP BY must be added. This is already documented in the code comment (C16-LOW-02). Re-noting for completeness.

**Suggested fix:** No code change needed. Already documented.

---

### C17-LOW-04: `withAdminAuth` in `api-auth.ts` does not add `X-Content-Type-Options` header to successful handler responses [LOW, HIGH confidence]

**File:** `apps/web/src/lib/api-auth.ts:48`

**Description:** The `NO_STORE_HEADERS` (which includes `X-Content-Type-Options: nosniff`) is only applied to error responses (403 and 401). When the handler succeeds, the response headers come from the handler itself, which may or may not include `nosniff`. The C16-LOW-08 fix only added the header to the wrapper's error paths, not to successful handler responses.

**Suggested fix:** The successful handler should also have `X-Content-Type-Options: nosniff`. Either add it in the wrapper after calling `handler(...)` or document that individual handlers must include it.

---

### C17-LOW-05: `adminUsers.updated_at` column uses `onUpdateNow()` but password change transaction updates `password_hash` via Drizzle `.set()`, not via MySQL auto-update [LOW, LOW confidence]

**File:** `apps/web/src/db/schema.ts:112`, `apps/web/src/app/actions/auth.ts:382-393`

**Description:** The `updated_at` column has `onUpdateNow()` which triggers on any MySQL UPDATE to the row. The `updatePassword` action at line 383 does `tx.update(adminUsers).set({ password_hash: newHash })` — this will trigger `onUpdateNow()`. So `updated_at` IS being updated. However, `createAdminUser` at line 135 does `db.insert(adminUsers)` which gets the `default(sql\`CURRENT_TIMESTAMP\`)`. And `deleteAdminUser` deletes rows. So `updated_at` is only meaningful for password changes, which is exactly what C16-LOW-14 intended. This is working as expected.

**Suggested fix:** No code change needed. Confirming correct behavior.

---

### C17-LOW-06: OG route rate-limit counter not decremented on error [LOW, MEDIUM confidence]

**File:** `apps/web/src/app/api/og/route.tsx:47-55`

**Description:** The `preIncrementOgAttempt` increments the counter before the expensive work. If the topic lookup fails (404) or an exception occurs (500), the counter is not decremented. This follows Pattern 1 from the rate-limit docstring in `rate-limit.ts` (no rollback on infrastructure error) for security-critical paths. However, the OG route is a public read path, which should use Pattern 2 (rollback on infrastructure error). A 404 for a non-existent topic is a legitimate user action and should not consume rate-limit budget.

**Suggested fix:** Add a rollback/decrement on the 404 path (topic not found) since the user didn't actually consume CPU resources for image generation. The 500 error path can keep the charge per Pattern 1 logic.

---

### C17-LOW-07: `serveUploadFile` resolves symlink target via `realpath` but then streams from the resolved path without re-validating the resolved path stays within UPLOAD_ROOT [LOW, LOW confidence]

**File:** `apps/web/src/lib/serve-upload.ts:80-95`

**Description:** The code correctly validates that `resolvedPath.startsWith(resolvedRoot)` on line 82. Then it creates the read stream from `resolvedPath` on line 95. The TOCTOU gap between `realpath` validation and `createReadStream` is acknowledged in the comment at line 93-94. Since the `resolvedPath` is the realpath (canonical, no symlinks), and the filesystem is assumed to be non-adversarial between lines 82 and 95 (a few microseconds), this is acceptable. The alternative (opening the file first, then validating the fd) would add significant complexity.

**Suggested fix:** No code change needed. The existing defense is sufficient for the threat model.

---

### C17-LOW-08: `CSP style-src 'unsafe-inline'` remains in production [LOW, HIGH confidence]

**File:** `apps/web/src/lib/content-security-policy.ts:81`

**Description:** Carry-forward from C16-LOW-03. The CSP production policy includes `style-src 'self' 'unsafe-inline'` which allows inline style injection. This is required by Radix UI/shadcn components that use inline styles. No mitigation path exists without refactoring all component styling.

**Suggested fix:** Defer until component library supports nonce-based styles.

---

### C17-LOW-09: `uploadTracker` prune uses `UPLOAD_TRACKING_WINDOW_MS * 2` instead of `* 1` for expiry [LOW, LOW confidence]

**File:** `apps/web/src/lib/upload-tracker-state.ts:33`

**Description:** The prune function uses `now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS * 2` (double the window). The comment doesn't explain why 2x is used. Presumably this gives a grace period for in-flight uploads that started near the end of a window. But the window reset logic in `resetUploadTrackerWindowIfExpired` uses exactly `1x`. The mismatch means entries are kept for 2 hours in the tracker even though the window resets after 1 hour.

**Suggested fix:** Add a comment explaining the 2x grace period, or align with 1x for consistency.

---

### C17-LOW-10: `batchUpdateImageTags` in tags.ts logs `failedToAddTag` error even for remove failures [LOW, MEDIUM confidence]

**File:** `apps/web/src/app/actions/tags.ts:448`

**Description:** The catch block at line 443-448 logs `failedToAddTag` as the error message even when the failure could have occurred during the remove phase. The error message is misleading — it should say something like `failedToUpdateTags` or the translation key should be more generic.

**Suggested fix:** Change the error return at line 448 to use a more generic translation key like `failedToUpdateTags`.

---

### C17-LOW-11: `createGroupShareLink` re-enqueue after `ER_DUP_ENTRY` does not roll back rate-limit [LOW, MEDIUM confidence]

**File:** `apps/web/src/app/actions/sharing.ts:277-279`

**Description:** When `ER_DUP_ENTRY` is caught for a group share key collision, the code increments `retries` and continues the loop. The in-memory and DB rate-limit counters were pre-incremented before the retry loop, so the user is charged once for all retry attempts within the same call. This is acceptable since the user initiated the action. However, if all 5 retries are exhausted (line 295-298), the rate limit IS rolled back at line 297. So the only concern is that retries 2-5 are "free" from a rate-limit perspective but still consume server resources. With only 5 retries and a 10-char base56 key space, collisions are astronomically unlikely.

**Suggested fix:** No code change needed. Theoretical only.

---

## VERIFIED PRIOR FIXES (confirming correctness)

1. **C16-MED-01** (DB-backed rate limit for loadMoreImages): Verified. `incrementRateLimit` and `checkRateLimit` are called with consistent bucketStart. Rollback is symmetric. New finding C17-MED-01 identifies a residual edge case.

2. **C16-MED-02** (GROUP_CONCAT alignment): Verified. Combined `GROUP_CONCAT(DISTINCT CONCAT(slug, CHAR(0), name))` with null-byte delimiter is used. Parsing on line 913-918 splits on comma then finds null byte. Clean.

3. **C16-MED-03** (shareRateLimit rename): Verified. `shareWriteRateLimit` is now distinct from `shareRateLimit` (the read-path share-key rate limit). No collision.

4. **C16-LOW-07** (sanitizeStderr password regex): Verified. Character class now includes `>`, `}`, `]`.

5. **C16-LOW-05** (stricter cookie validation): Verified. Length >= 100 check, 3 colon-separated parts, each non-empty.

6. **C16-LOW-14** (adminUsers.updated_at): Verified. Column exists with `onUpdateNow()`.

7. **C16-LOW-08** (X-Content-Type-Options on admin API): Partially verified. Added to error responses in `withAdminAuth`, but not to successful handler responses. See C17-LOW-04.

---

## CARRY-FORWARD DEFERRED ITEMS (unchanged)

All previously deferred items from cycles 5-16 remain deferred with no change in status. See:
- Plan 84 (cycle 37 deferred)
- Plan 93 (cycle 6 deferred)
- C16-LOW-03 / C17-LOW-08: CSP `style-src 'unsafe-inline'`
- C16-LOW-04 / C9-F01: `original_file_size` BigInt precision
- C16-LOW-11 / C13-03: CSV headers hardcoded in English
- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
