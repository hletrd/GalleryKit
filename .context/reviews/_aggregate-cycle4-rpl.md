# Aggregate Review — Review-Plan-Fix Cycle 4 (2026-04-20)

## Summary

Deep code review of the full repository found **1 new actionable issue** (MEDIUM) and confirmed all previously deferred items with no change in status. No CRITICAL or HIGH findings. No regressions from prior cycles.

## New Findings (Deduplicated)

### C4RPL-01: `updateTopic` does not sanitize `slug` form field with `stripControlChars` [MEDIUM] [HIGH confidence]
**File:** `apps/web/src/app/actions/topics.ts` line 106
**Description:** In `updateTopic`, the `slug` is extracted raw from `formData.get('slug')?.toString() ?? ''` without applying `stripControlChars`. In contrast, `createTopic` at line 38 sanitizes the same field with `stripControlChars(formData.get('slug')?.toString() ?? '') ?? ''`. This is inconsistent with the defense-in-depth pattern applied everywhere else. While `isValidSlug` regex rejects control characters (only `[a-z0-9_-]` allowed), the inconsistency means a control character could pass the raw extraction and reach `isValidSlug`, which would reject it, but the sanitization order is wrong — other functions (like `createTopic`, `updateTag`, etc.) sanitize first and then validate, so the validated and stored values always match.
**Fix:** Change `const slug = formData.get('slug')?.toString() ?? '';` to `const slug = stripControlChars(formData.get('slug')?.toString() ?? '') ?? '';` at line 106 of `topics.ts`.

## Previously Deferred Items (No Change)

All previously deferred items from cycles 5-45 remain deferred with no change in status.

## Codebase Assessment

The codebase is well-structured with consistent security patterns:
- All server actions verify auth via `isAdmin()` (defense in depth)
- `stripControlChars` is consistently applied to user input before validation
- Privacy fields (lat/lon, filename_original, user_filename) are excluded from public queries with compile-time guard
- Rate limiting uses pre-increment TOCTOU-safe pattern across all endpoints
- Transactions used for multi-table operations
- Path traversal prevention in file serving routes
- Symlink rejection in upload/download routes
- Session tokens use HMAC-SHA256 with timing-safe comparison
- SQL restore scanner blocks dangerous SQL patterns
