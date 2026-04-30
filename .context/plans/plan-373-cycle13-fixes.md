# Plan 373 — Cycle 13 Fixes

## Origin

Cycle 13 review findings from `_aggregate-c13.md`.

## C13-MED-01: `sanitizeAdminString` returns non-null `value` for C0 control character rejection

- **File+line**: `apps/web/src/lib/sanitize.ts:172-173`
- **Severity**: Medium | **Confidence**: High
- **2 agents agree** (verifier + test-engineer)

### Problem

When Unicode formatting characters (bidi, zero-width) are detected, `sanitizeAdminString` returns `{ value: null, rejected: true }` (line 169). But when only C0 control characters are present, it returns `{ value: stripped, rejected: true }` (line 173) — a non-null stripped value with `rejected: true`.

The comment on lines 163-167 states: "return null when rejected=true so callers cannot accidentally persist a stripped value that looks visually identical to the original." C0 control characters can also produce visually-identical stripped strings (e.g., `hello\x01world` -> `helloworld`).

This creates a contract inconsistency: some `rejected: true` paths return null (safe) and others return a non-null value (potentially unsafe if a caller checks `rejected` but then uses `value`).

### Fix

1. In `sanitize.ts`, change line 173 to return `{ value: null, rejected: true }` when `rejected` is true (regardless of whether the rejection came from Unicode formatting or C0 controls).

2. Update `sanitize-admin-string.test.ts` line 60-62 to expect `value: null` for the C0 control character test case instead of `value: 'helloworld'`.

3. Verify no callers depend on the non-null `value` when `rejected: true`. All current callers check `rejected` first and return an error, so they never use the `value` field when rejected.

### Files to modify

- `apps/web/src/lib/sanitize.ts` — line 173: change to `{ value: null, rejected: true }` when `stripped !== input`
- `apps/web/src/__tests__/sanitize-admin-string.test.ts` — line 62: change `expect(result.value).toBe('helloworld')` to `expect(result.value).toBeNull()`

### Status: DONE

- Commit: `1c99ca5` — fix(sanitize): return null on all sanitizeAdminString rejected paths
- All gates pass: ESLint, tsc --noEmit, vitest (577/577), lint:api-auth, lint:action-origin, next build
- Deploy: successful
