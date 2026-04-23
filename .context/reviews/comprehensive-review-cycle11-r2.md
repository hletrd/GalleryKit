# Comprehensive Code Review — Cycle 11 Round 2 (2026-04-19)

**Scope:** Full repository — apps/web/src, scripts, config, translations, tests
**Methodology:** File-by-file inspection of all recently changed files + cross-file interaction analysis + verification of prior findings
**Reviewer:** Claude Code (single reviewer, multi-angle)

---

## Summary

The codebase is mature and well-hardened. Many prior findings have been resolved since the original cycle 11 review. This review identified **3 new actionable issues** (1 MEDIUM, 2 LOW) and confirmed 1 previously identified issue still outstanding. No CRITICAL or HIGH findings. No regressions from prior cycles.

---

## PRIOR FINDINGS VERIFICATION

### Confirmed RESOLVED since last full review:

| Prior ID | Description | Status |
|----------|-------------|--------|
| S-01 | GPS validation allows out-of-range decimal degrees | FIXED — `Math.abs(dd) > maxDegrees` check added at process-image.ts:448 |
| S-02 | Object URL recreation causes preview flicker | FIXED — upload-dropzone.tsx now uses ref-based incremental URL management |
| S-06 | Native `confirm()` breaks dark mode | FIXED — admin-user-manager.tsx uses AlertDialog |
| S-07 | Temp file without restrictive permissions | FIXED — process-topic-image.ts:68 uses `{ mode: 0o600 }` |
| C-08 | Dead `\r` in CSV injection regex | FIXED — db-actions.ts:24 now uses `/^[=+\-@\t]/` |
| R-03 | Octet-stream fallback instead of 404 | FIXED — serve-upload.ts:67-69 returns 404 for unknown extensions |
| C-02 | Tags discarded on shared photo page | FIXED — s/[key]/page.tsx:90 passes `tags={image.tags ?? []}` |
| C-03 | Tags discarded on shared group page | FIXED — g/[key]/page.tsx:111 passes `tags={selectedImage.tags ?? []}` |
| D-02 | Advisory lock unreliable with pooled connections | Previously addressed — db-actions.ts uses dedicated connection |
| D-05 | deleteTopicAlias lacks error handling | FIXED — try/catch added |
| D-07 | batchUpdateImageTags non-transactional | FIXED — wrapped in db.transaction() |
| A-01 | Rate limit TOCTOU on login | FIXED — increment-before-verify pattern applied |
| A-02 | Error message confirms valid credentials | FIXED — now returns generic `t('authFailed')` |
| A-04 | No rate limiting on password change | FIXED — rate limiting added with same pre-increment pattern |
| D-01 | SQL restore scan conditional comment bypass | FIXED — stripSqlCommentsAndLiterals now extracts inner content from `/*!ddddd ... */` before stripping |
| SEC-39-03 | SQL restore scan missing `SET @@global.` pattern | FIXED — pattern added to DANGEROUS_SQL_PATTERNS |
| C39-01 | batchUpdateImageTags remove path slug-only lookup | FIXED — name-first, slug-fallback pattern applied |
| C39-02 | Mobile bottom sheet GPS dead code not annotated | FIXED |
| C39-03 | Admin user creation form labels not associated | FIXED — htmlFor and id attributes added |
| S-05 | document.title not restored on navigation | FIXED — photo-viewer.tsx:75-80 has cleanup with siteTitleRef |

---

## NEW FINDINGS

### C11R2-01: `s/[key]/page.tsx` still uses `dynamic()` import — inconsistent with `g/[key]/page.tsx` [LOW] [HIGH confidence]
**File:** `apps/web/src/app/[locale]/(public)/s/[key]/page.tsx:10`
**Description:** The shared photo page still uses `dynamic(() => import('@/components/photo-viewer'))` while the shared group page was converted to a static import in a recent commit. The `p/[id]/page.tsx` also uses `dynamic()` but with explicit `ssr: false` and loading state — that one may be intentional for performance. However, `s/[key]/page.tsx` has no `ssr: false` option and no loading state, making the dynamic import unnecessary and inconsistent.
**Fix:** Convert to static import matching the `g/[key]/page.tsx` pattern, or add `ssr: false` + loading component if dynamic loading is intentional.

### C11R2-02: `checkUserCreateRateLimit` in admin-users.ts has check-and-increment TOCTOU (same pattern as A-01 fix) [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/admin-users.ts:37-47`
**Description:** The in-memory `checkUserCreateRateLimit` function checks the count and then increments it in the same function call, which is fine for Node.js single-thread. However, the overall flow in `createAdminUser` (lines 66-85) has a classic TOCTOU: the in-memory check at line 68 passes, then the DB check at line 73 passes, then the DB increment at line 82 fires — but between the DB check and DB increment, another concurrent request could also pass the DB check. The DB increment uses `ON DUPLICATE KEY UPDATE` which is atomic, but the `checkRateLimit` + `incrementRateLimit` are two separate DB calls. This is the same pattern that was fixed for login (A-01) with pre-increment, but `createAdminUser` does NOT use pre-increment for the in-memory map — it calls `checkUserCreateRateLimit` which increments inside, but the DB path is still check-then-increment.
**Concrete scenario:** Two concurrent `createAdminUser` requests from the same IP both pass `checkRateLimit` (DB returns count=9, limit is 10), both increment (count becomes 11), both proceed to expensive Argon2 hash. The in-memory check prevents this for single-process, but the DB path has a narrow window.
**Fix:** Pre-increment the DB rate limit before the Argon2 hash, matching the login pattern. Use `incrementRateLimit` first, then if the expensive operation fails for non-rate-limit reasons, roll back.

### C11R2-03: `admin-user-manager.tsx` password confirmation only checked client-side [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/actions/admin-users.ts:87-88`
**Description:** The `createAdminUser` server action receives `password` from `formData` but does not receive or validate `confirmPassword`. The password match check is done only on the client (`admin-user-manager.tsx:40-42`). If the server action is called directly (e.g., via crafted request), no password confirmation is validated. This is not a security vulnerability (the password is whatever was submitted), but it means a typo in the password field from a direct API call would create an admin with an unintended password.
**Fix:** Either accept `confirmPassword` in the server action and validate the match server-side, or document that client-side validation is sufficient since the action requires admin auth.

---

## PREVIOUSLY DEFERRED ITEMS (No Change)

All previously deferred items from cycles 5-39 remain deferred with no change in status:

- C32-03: Insertion-order eviction in Maps
- C32-04 / C30-08: Health endpoint DB disclosure
- C29-05: `passwordChangeRateLimit` shares `LOGIN_RATE_LIMIT_MAX_KEYS` cap
- C30-03 / C36-03: `flushGroupViewCounts` re-buffers failed increments without retry limit
- C30-04 / C36-02: `createGroupShareLink` insertId validation / BigInt coercion
- C30-06: Tag slug regex inconsistency
- CR-38-05: `db-actions.ts` env passthrough is overly broad
- DOC-38-01 / DOC-38-02: CLAUDE.md version mismatches
- Font subsetting (Python brotli dependency)
- Docker node_modules removal (native module bundling)
- CRI-38-01: DRY violation in Map pruning (5+ copies)
- CR-38-02: `uploadTracker` uses insertion-order eviction, not LRU
- CR-38-06: `photo-viewer.tsx` `Histogram` null-safety
- PERF-38-02: `exportImagesCsv` loads up to 50K rows into memory
- ARCH-38-03: `data.ts` is a god module
- TE-38-01 through TE-38-04: Test coverage gaps
- C9-F01: original_file_size bigint mode: 'number' precision [MEDIUM]
- C9-F03: searchImagesAction rate limit check/increment window [LOW]
- C4-F02 / C6-F04: Admin checkboxes use native `<input>` (no Checkbox component)
- C6-F03: No E2E test coverage for upload pipeline
- C7-F03: No test coverage for view count buffering system
- C7-F04: No test for search rate limit rollback logic
- C8-F01: deleteTopicAlias revalidation (informational)
- UX-39-02: Admin user creation form lacks password confirmation (server-side)

---

## ISSUE SUMMARY TABLE

| ID | Severity | Confidence | File | Description | Action |
|----|----------|------------|------|-------------|--------|
| C11R2-01 | LOW | HIGH | `s/[key]/page.tsx:10` | Inconsistent dynamic import vs g/[key] static | IMPLEMENT |
| C11R2-02 | MEDIUM | HIGH | `admin-users.ts:66-85` | DB rate limit TOCTOU (check-then-increment) | IMPLEMENT |
| C11R2-03 | LOW | MEDIUM | `admin-users.ts:87-88` | Password confirmation only client-side | DEFER (requires admin auth) |

**0 CRITICAL, 0 HIGH, 1 MEDIUM, 2 LOW** — Total: 3 new findings

---

## POSITIVE OBSERVATIONS

- All previously identified HIGH/CRITICAL issues have been resolved
- Rate limiting is consistently applied (login, password change, user creation)
- SQL restore scan now handles conditional comments correctly
- Tag slug collision handling is consistent across all code paths
- Admin user deletion uses atomic transaction for last-admin check
- Session invalidation on password change is properly transactional
- `confirm()` completely eliminated from codebase
- Accessibility improvements: aria-current on nav links, label-input associations, Dialog vs AlertDialog
- Upload dropzone preview URLs are now properly managed with incremental create/revoke
