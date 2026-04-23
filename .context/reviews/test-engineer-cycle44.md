# Test Engineer — Cycle 44 (2026-04-20)

## Review Scope
Test coverage gaps, flaky test risks, TDD opportunities for the existing test suite at `apps/web/src/__tests__/`.

## Existing Test Files
- `base56.test.ts` — base56 encoding/decoding
- `session.test.ts` — session token generation/verification
- `queue-shutdown.test.ts` — graceful shutdown behavior
- `auth-rate-limit.test.ts` — login rate limiting
- `rate-limit.test.ts` — DB-backed and in-memory rate limiting
- `validation.test.ts` — input validation helpers
- `sql-restore-scan.test.ts` — SQL restore scanner
- `locale-path.test.ts` — locale path utilities
- `revalidation.test.ts` — path revalidation helpers

## New Findings

### TE44-01: No unit tests for `stripControlChars` in `sanitize.ts` [LOW] [HIGH confidence]
**File:** `apps/web/src/lib/sanitize.ts`
**Description:** The `stripControlChars` function is a critical security utility used across 10+ action modules, but has no dedicated unit test. Given its importance (defense-in-depth against control character injection), a test covering: normal strings, null bytes, tab/newline/CR, DEL (0x7F), mixed C0 characters, empty string, null input, and strings with only control characters would provide regression protection.
**Fix:** Add `apps/web/src/__tests__/sanitize.test.ts`.

### TE44-02: No integration test for the upload→process→serve pipeline [LOW] [LOW confidence]
**Description:** While individual components (Sharp processing, queue, serve route) are well-tested in isolation, there's no end-to-end test verifying: upload image → queue processes → processed image is servable via the upload route. The Playwright e2e tests may cover this from a UI perspective, but a server-side integration test would catch issues like the .tmp rename race condition (already mitigated) or format verification failures.

### TE44-03: No test for `escapeCsvField` edge cases [LOW] [MEDIUM confidence]
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 20-31
**Description:** The CSV escaping function handles control characters, formula injection, and embedded quotes/double-quotes. No unit test exists for these edge cases, which are security-sensitive (CSV injection can lead to RCE in spreadsheet applications).
**Fix:** Add `apps/web/src/__tests__/csv-escape.test.ts`.

## Previously Deferred Items (No Change)

- TE-38-01 through TE-38-04: Test coverage gaps for various modules.

## Recommendation

The most impactful new test to add would be `sanitize.test.ts` (TE44-01), since `stripControlChars` is now used pervasively and is a security-sensitive function.
