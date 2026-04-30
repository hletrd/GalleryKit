# Plan 92 — Cycle 6 Fixes

**Source review:** Cycle 6 Multi-Agent Review (C6-F01, C6-F02, C6-F03, C6-F04)
**Status:** DONE

---

## Findings to Address

| ID | Description | Severity | Confidence |
|----|------------|----------|------------|
| C6-F01 | `selectFields` privacy guard is implicit — no type constraint prevents adding GPS fields | MEDIUM | HIGH |
| C6-F02 | `home-client.tsx` file-level eslint-disable (carry-forward from C5-F02) | LOW | HIGH |
| C6-F03 | No integration/E2E tests for the upload-to-processing pipeline | LOW | HIGH |
| C6-F04 | `image-manager.tsx` native checkboxes instead of Checkbox component (carry-forward from C4-F02) | LOW | HIGH |

### Already Resolved (verified in current codebase)

- C6-F02: File-level eslint-disable already removed from `home-client.tsx`. Per-element disable at line 260 is present. **RESOLVED in prior cycle.**

### Deferred Findings

- C6-F03 (E2E test coverage): Large effort, requires Playwright setup and test infrastructure. Defer to a dedicated test-writing cycle. **Exit criterion:** When a test infrastructure cycle is scheduled.
- C6-F04 (native checkboxes): Same as C4-F02, properly deferred. **Exit criterion:** When UI component migration is scheduled.

---

## C6-F01: Implicit privacy guard on selectFields — IMPLEMENTED

**File:** `apps/web/src/lib/data.ts:67-118`

**Fix applied (commit 8cef2e4):**
- Added PRIVACY comment block above `selectFields` documenting the constraint
- Changed `selectFields` declaration to `as const` to enable type-level key extraction
- Added compile-time type assertion: `_AssertNoSensitiveFields` checks that `selectFields` keys do not include `latitude`, `longitude`, `filename_original`, or `user_filename`
- If any sensitive key is added, TypeScript will produce a compile error with a descriptive message
- Zero runtime cost — all enforcement is at the type level

---

## Verification

- [x] C6-F01: Type assertion added to data.ts — `selectFields` cannot include GPS/PII fields (commit 8cef2e4)
- [x] C6-F02: Already resolved (file-level disable removed, per-element disable at line 260)
- [x] `npm run lint --workspace=apps/web` passes with 0 errors
- [x] `npm run build` passes
- [x] `cd apps/web && npx vitest run` passes (66 tests, 9 files)
