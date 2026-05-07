# Comprehensive Code Review — Cycle 26

**Date:** 2026-04-19
**Reviewer:** Multi-angle deep review (code quality, security, performance, correctness, architecture, i18n, UX)
**Cycle:** 26/100

---

## Review Scope

All source files in `apps/web/src/` were examined, including:
- All server actions (`actions/*.ts`)
- Data layer (`lib/data.ts`)
- Security modules (`lib/session.ts`, `lib/rate-limit.ts`, `lib/auth-rate-limit.ts`, `lib/api-auth.ts`, `lib/sql-restore-scan.ts`, `lib/sanitize.ts`, `lib/validation.ts`)
- Image processing (`lib/process-image.ts`, `lib/image-queue.ts`, `lib/process-topic-image.ts`)
- Middleware (`proxy.ts`)
- Storage layer (`lib/storage/`)
- UI components (photo-viewer, info-bottom-sheet, upload-dropzone, etc.)
- Database schema (`db/schema.ts`)
- Admin DB actions (`admin/db-actions.ts`)

---

## Findings

### C26-01: `adminSelectFields` in data.ts exposes sensitive fields to admin routes — `adminSelectFields` is defined but never used

- **Severity:** LOW
- **Confidence:** MEDIUM
- **Category:** Architecture / Dead Code
- **File:** `apps/web/src/lib/data.ts`
- **Detail:** The CLAUDE.md documentation references `adminSelectFields` as "provides full data only to authenticated admin routes", but the codebase only has `selectFields` and `publicSelectFields` (which are identical). There is no separate `adminSelectFields` that includes latitude/longitude/filename_original for admin queries. The admin dashboard (`getAdminTags`, `getAdminUsers`) doesn't need those fields, so this is dead documentation rather than a bug. However, the `selectFields` constant omits `user_filename` which admin routes DO need (e.g., CSV export accesses it separately). The `selectFields` / `publicSelectFields` identity is correct — both omit PII.
- **Fix:** Update CLAUDE.md to remove the `adminSelectFields` reference, or document that admin-specific queries select needed columns individually rather than through a shared field set.
- **Assessment:** Documentation-code mismatch, not a data leak. No sensitive fields are exposed to public routes.

### C26-02: `passwordChangeRateLimit` uses `LOGIN_RATE_LIMIT_MAX_KEYS` for its hard cap instead of its own constant

- **Severity:** LOW
- **Confidence:** HIGH
- **Category:** Code Quality / Maintainability
- **File:** `apps/web/src/lib/auth-rate-limit.ts`, line 66
- **Detail:** `prunePasswordChangeRateLimit()` uses `LOGIN_RATE_LIMIT_MAX_KEYS` (5000) as the hard cap for the password change rate limit Map. While 5000 is a reasonable cap, it semantically belongs to login rate limiting. If the login cap is changed, the password change cap would change inadvertently. The `passwordChangeRateLimit` Map should have its own named constant (e.g., `PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS`).
- **Fix:** Add `const PASSWORD_CHANGE_RATE_LIMIT_MAX_KEYS = 5000;` and use it in `prunePasswordChangeRateLimit()`.

### C26-03: `toISOString()` in `parseExifDateTime` produces UTC timestamps but `capture_date` column is MySQL DATETIME without timezone

- **Severity:** LOW
- **Confidence:** MEDIUM
- **Category:** Data Integrity / i18n
- **File:** `apps/web/src/lib/process-image.ts`, lines 137-143
- **Detail:** When EXIF `DateTimeOriginal` is a Date object or numeric timestamp, `parseExifDateTime` converts it via `toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')`, which produces a UTC timestamp string. However, the `capture_date` column is `datetime` (no timezone), so MySQL will interpret it as local time. This creates a timezone offset mismatch when the server's timezone differs from UTC. The primary EXIF format path (string matching `YYYY:MM:DD HH:MM:SS`) correctly avoids this issue by not passing through `Date`. The Date/number fallback paths are rarely hit (non-standard EXIF encoders), so impact is low.
- **Fix:** When falling back to Date objects, use timezone-aware formatting (e.g., `format` from `date-fns-tz`) or explicitly document that the fallback may have timezone drift.
- **Assessment:** Low-impact because the primary EXIF date path is correct. Only affects non-standard EXIF encoders that emit Date objects instead of strings.

### C26-04: `flushGroupViewCounts` re-buffers failed increments without checking if the group was deleted

- **Severity:** LOW
- **Confidence:** LOW
- **Category:** Data Integrity
- **File:** `apps/web/src/lib/data.ts`, lines 48-64
- **Detail:** When a view count increment fails (e.g., because the group row was deleted), the code re-buffers the failed count. On the next flush cycle, it will try again against a non-existent row, which will fail again and re-buffer again — a soft loop that only ends when the entry ages out or the buffer is pruned. The `succeeded` counter won't increment, so `consecutiveFlushFailures` will increase, triggering exponential backoff. This is self-limiting but wastes DB queries on deleted groups.
- **Fix:** On UPDATE failure, check if the group still exists before re-buffering. If the group was deleted, discard the increment instead of re-buffering.
- **Assessment:** Self-limiting due to exponential backoff and buffer pruning. Low practical impact.

### C26-05: `searchImages` DB-backed rate limit `incrementRateLimit` runs after the in-memory pre-increment but is not rolled back when the DB check returns limited

- **Severity:** LOW
- **Confidence:** HIGH
- **Category:** Rate Limiting / Consistency
- **File:** `apps/web/src/app/actions/public.ts`, lines 62-87
- **Detail:** In `searchImagesAction`, the order is: (1) in-memory pre-increment, (2) DB-backed check, (3) rollback in-memory if DB says limited, (4) DB increment. However, `incrementRateLimit` (step 4) runs AFTER the DB check that may have already returned "limited". If the DB check says "not limited" but the in-memory check passes, the DB increment is still recorded. More importantly, if the DB check returns "limited" and the in-memory counter is rolled back, the DB increment from step 4 still runs — this means the DB counter is incremented even for rejected requests. Compare with `sharing.ts` and `admin-users.ts` where `incrementRateLimit` runs BEFORE the DB check. In `public.ts`, it runs after, causing an asymmetry: the DB counter overcounts compared to the in-memory counter.
- **Fix:** Move `incrementRateLimit` to before the DB-backed check (matching the pattern in `sharing.ts` and `admin-users.ts`), or skip it entirely when the DB check returns "limited".
- **Assessment:** Low impact — the DB counter slightly overcounts, making the rate limit slightly more conservative. Not a bypass risk.

### C26-06: `exportImagesCsv` releases the `results` array by reassigning it, but TypeScript may not optimize this

- **Severity:** LOW
- **Confidence:** LOW
- **Category:** Performance
- **File:** `apps/web/src/app/[locale]/admin/db-actions.ts`, lines 76-77
- **Detail:** The code assigns `results = [] as typeof results` to "release reference to allow GC". However, `results` is declared with `let` and the original array reference is still held by the closure until the function returns. The V8 engine may or may not GC the original array before the CSV string is materialized. This is a best-effort optimization that may not have measurable impact in practice.
- **Fix:** This is acceptable as-is. If memory pressure is a concern, consider streaming the CSV output instead of building it in memory.
- **Assessment:** No bug — just a cosmetic optimization hint.

---

## Verified: Previous Cycle Fixes

The following findings from prior cycles were verified as fixed in the current codebase:

1. **C25-09**: `dumpDatabase`/`restoreDatabase` now use `MYSQL_USER`/`MYSQL_HOST`/`MYSQL_TCP_PORT` env vars instead of CLI flags. **FIXED.**
2. **C25-10**: `photo-viewer.tsx` now passes `locale` to `toLocaleTimeString(locale)`. **FIXED.**
3. **C25-11**: `info-bottom-sheet.tsx` now passes `locale` to `toLocaleTimeString(locale)`. **FIXED.**

---

## Architecture Assessment

The codebase demonstrates strong security practices:
- Consistent TOCTOU protection via pre-increment rate limiting
- Defense-in-depth with both in-memory and DB-backed rate limits
- Proper input validation and sanitization across all server actions
- Symlink rejection and path traversal prevention in file serving
- Atomic operations (transactions, conditional WHERE) for concurrent safety
- Privacy guard via compile-time type assertions on select fields
- `safeJsonLd()` for XSS prevention in structured data
- `timingSafeEqual` for HMAC signature verification
- `stripControlChars` applied to all admin text inputs
- CSV injection prevention with formula character escaping
- SQL restore scanning with dangerous pattern detection

The code is well-structured, consistently follows established patterns, and has comprehensive error handling. No critical or high-severity issues were found.

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 0 |
| LOW | 6 |
| NOT-A-BUG | 0 |

All findings are LOW severity. The codebase is in excellent shape after 25 prior fix cycles.
