# Comprehensive Code Review -- Cycle 8 (Loop 2)

**Date:** 2026-04-20
**Reviewer:** Multi-angle deep review
**Scope:** Full codebase (`apps/web/src/`)

## Summary

After 46+ prior review cycles, the codebase is well-hardened. This review found **3 new actionable issues** (1 MEDIUM, 2 LOW). No CRITICAL or HIGH findings. All prior sanitize-before-validate issues have been fixed. Security posture is strong with defense-in-depth patterns throughout.

## New Findings

### C8-01: `createAdminUser` does not validate `password` field for control characters [MEDIUM] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/admin-users.ts` lines 95-108

**Description:** The `username` field in `createAdminUser` is sanitized with `stripControlChars` (line 96) and then validated for format/length. However, the `password` field (line 97) is extracted raw from FormData and passed directly to `argon2.hash()` without any `stripControlChars` application. While Argon2 hashing itself is safe regardless of input content, the inconsistency means:
1. The `password.length < 12` check on line 107 operates on the raw unsanitized password. A password of 13 characters where 2 are control characters would pass the length check but the actual stored hash would correspond to a different (11-char) effective password.
2. This is the same class of issue as C46-01/C46-02 (validation before sanitization). While the impact is limited (Argon2 handles any byte sequence), the principle of validating-then-storing the same value applies.
3. The login form (auth.ts line 72) also does not sanitize the password, so login would still work with control characters in the password. However, the `maxLength={1024}` on the client form would truncate differently if control chars were present vs absent.

**Important caveat:** Passwords are a special case -- users may intentionally include certain characters. However, C0 control characters (0x00-0x1F, 0x7F) are never intentional in passwords and can cause subtle mismatches between validated and stored values (e.g., a null byte `\x00` could truncate the string in some contexts, though Node.js strings handle embedded nulls correctly).

**Fix:** Apply `stripControlChars` to the password before length validation, or at minimum reject passwords containing control characters (matching the pattern used for usernames, tags, and other user inputs). This ensures the length check operates on the same value that will be hashed.

**Concrete failure scenario:** User types a password containing a tab character (accidental paste). The raw password passes the `length < 12` check and gets hashed. On login, the user types the same password with the tab. Both Argon2 hashes match. But the `password.length > 1024` check could pass for a 1025-char raw password that is 1024 chars after stripping -- a mismatch between the validated and hashed values.

### C8-02: `updatePassword` does not sanitize `currentPassword` or `newPassword` fields [LOW] [MEDIUM confidence]

**File:** `apps/web/src/app/actions/auth.ts` lines 261-279

**Description:** Same class as C8-01 but for the password change flow. `currentPassword` (line 261), `newPassword` (line 262), and `confirmPassword` (line 263) are all extracted raw. The `newPassword.length < 12` and `newPassword.length > 1024` checks operate on unsanitized values. If `stripControlChars` were applied, a user could not accidentally set a password with embedded control characters that would be difficult to type again.

**Fix:** Same as C8-01 -- strip or reject control characters before length checks.

### C8-03: `login` does not sanitize the `password` field [LOW] [LOW confidence]

**File:** `apps/web/src/app/actions/auth.ts` line 72

**Description:** The `username` is sanitized (line 71) but `password` is not (line 72). If a future change adds any password-length-based logic to the login flow (e.g., rejecting extremely long passwords before the Argon2 verify to prevent CPU DoS), the same sanitize-before-validate bug class would apply. Currently the impact is minimal because the password goes straight to Argon2.verify() without intermediate length checks.

**Fix:** Apply `stripControlChars` to password for consistency, or add a comment explaining why it's intentionally not sanitized (e.g., "passwords may intentionally contain any characters except C0 controls").

## Areas Reviewed With No New Findings

- **Sanitization patterns**: All user-facing string inputs in actions (topics, tags, images, seo, settings, public, sharing) correctly apply `stripControlChars` before validation. Prior C45/C46 findings are resolved.
- **Rate limiting**: All rate-limited operations use the pre-increment pattern correctly (login, password change, search, share, user creation).
- **Path traversal**: `serve-upload.ts` correctly validates segments with `SAFE_SEGMENT` regex, containment check, and symlink rejection.
- **SQL injection**: All queries use Drizzle ORM parameterized queries. The `searchImages` LIKE wildcards are properly escaped. The SQL restore scanner blocks dangerous patterns.
- **Privacy enforcement**: `publicSelectFields` omits latitude, longitude, filename_original, user_filename. Compile-time `_privacyGuard` assertion prevents accidental PII leakage. GPS coordinates stripped when privacy setting enabled.
- **XSS prevention**: `dangerouslySetInnerHTML` only used for `application/ld+json` with `safeJsonLd()` escaping. No `innerHTML`, `eval()`, or `document.write()`.
- **Session security**: HMAC-SHA256 tokens with `timingSafeEqual`, httpOnly/secure/sameSite cookies, 24-hour expiry, session invalidation on password change.
- **Race conditions**: Transactions used for topic rename, batch delete, password change. `INSERT IGNORE` + `ER_DUP_ENTRY` catch for concurrent tag/topic creation.
- **Upload security**: UUID filenames (no user-controlled names), `limitInputPixels` for decompression bombs, `statfs` disk space check, cumulative upload tracking with TOCTOU pre-increment.
- **JSON-LD injection**: `safeJsonLd` escapes `<` to prevent `</script>` breakout.
- **CSV export**: `escapeCsvField` handles formula injection, null bytes, and embedded newlines.
- **Audit logging**: All mutating operations logged. Audit metadata length-capped at 4096 chars. Old entries purged on configurable retention.
