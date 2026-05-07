# Security Review — Cycle 6 (2026-04-19)

## Summary
Deep security review of GalleryKit. The codebase has strong security posture with defense-in-depth across auth, rate limiting, file handling, and input validation. Found **1 new finding** (LOW).

## Findings

### C6-SEC01: `createGroupShareLink` insertId BigInt coercion — already deferred but risk underestimated
**File:** `apps/web/src/app/actions/sharing.ts:166`
**Severity:** LOW | **Confidence:** LOW

The `Number(result.insertId)` at line 166 can silently produce incorrect values if `insertId` exceeds `Number.MAX_SAFE_INTEGER` (2^53). The `Number.isFinite` check on line 167 only validates NaN/Infinity, not precision loss. This is already properly deferred under C30-04/C36-02. No new action needed — reaffirming the finding is theoretical for a personal gallery.

## Verified as Secure
- **Auth:** Argon2id hashing, timing-safe token comparison, HMAC-SHA256 session tokens, production SESSION_SECRET enforcement, session fixation prevention via transactional session replacement
- **Rate limiting:** In-memory + DB-backed dual layer, TOCTOU pre-increment, IP normalization with bracket handling, TRUST_PROXY opt-in
- **File uploads:** Path traversal prevention (SAFE_SEGMENT + ALLOWED_UPLOAD_DIRS + resolvedPath.startsWith), symlink rejection, UUID filenames, decompression bomb mitigation (limitInputPixels)
- **Input validation:** Comprehensive slug/name/filename validation, LIKE wildcard escaping, CSV formula injection prevention
- **DB security:** Parameterized queries via Drizzle ORM, advisory lock for DB restore, SQL dump scanning (containsDangerousSql)
- **Privacy:** GPS coordinates excluded from public queries (selectFields omission), filename_original excluded, PRIVACY comments added
- **Cookie security:** httpOnly, secure in production, sameSite:lax, proper path scoping
- **XSS prevention:** safeJsonLd escapes `<`, no raw innerHTML usage, no eval/Function constructors

## No Issues Found In
- `apps/web/src/proxy.ts` — proper middleware auth guard with token format validation
- `apps/web/src/lib/api-auth.ts` — withAdminAuth wrapper for API routes
- `apps/web/src/app/api/health/route.ts` — minimal DB status disclosure (already deferred)
- `apps/web/src/app/[locale]/admin/db-actions.ts` — advisory lock, file header validation, SQL scanning, MYSQL_PWD env var usage
