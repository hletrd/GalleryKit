# Plan 322 — Cycle 5: sanitizeStderr documentation and test (C5-AGG-01)

## Origin

C5-AGG-01 (Medium/Medium) — `sanitizeStderr` has overlapping/redundant regexes with no documentation — maintenance hazard. Flagged by 4 of 5 review agents.

## Problem

`apps/web/src/app/[locale]/admin/db-actions.ts:44-45` has two regexes in `sanitizeStderr`:

1. Line 44: `/(password\s*[:=]\s*)[^\s;'"`]*/gi` — matches `password=VALUE` and `password:VALUE`
2. Line 45: `/(using password:\s*)\S+/gi` — matches the specific MySQL `using password:` prefix

After line 44 was broadened from `=` to `[:=]` (fixing C4-AGG-08), the second regex is now largely redundant. The overlap creates a maintenance hazard: a future contributor might remove line 45 as "redundant" without understanding that `using password:` is a distinct MySQL error format. There is also no unit test for this security-sensitive function.

## Implementation steps

1. **Add documentation comments** above both regexes in `sanitizeStderr` explaining:
   - Regex 1: Catches generic `password=VALUE` and `password:VALUE` patterns (broadened from C4-AGG-08).
   - Regex 2: Catches the specific MySQL `using password: YES/NO` format in `Access denied` messages. Even though regex 1 overlaps, this regex is intentionally kept because `using password:` is a distinct MySQL error format that appears in `Access denied` messages, and removing it could miss edge cases with custom auth plugins.

2. **Add unit test** at `apps/web/src/__tests__/sanitize-stderr.test.ts`:
   - Test `password=secret` → redacted
   - Test `password:secret` → redacted
   - Test `using password: YES` → redacted
   - Test `using password: NO` → redacted
   - Test mixed-case `PASSWORD=value` → redacted
   - Test actual MYSQL_PWD value redaction (when `pwd` param provided)
   - Test no false positives on unrelated text

3. **Export `sanitizeStderr`** from `db-actions.ts` or move to a testable utility. Since `db-actions.ts` is a `'use server'` module, the function cannot be directly imported in tests. Two options:
   - Option A: Move `sanitizeStderr` to `@/lib/sanitize.ts` (already has `stripControlChars` and `requireCleanInput`)
   - Option B: Create a new `@/lib/stderr-sanitize.ts` module
   - **Preferred**: Option A — `sanitize.ts` is the natural home for sanitization utilities.

4. **Update `db-actions.ts`** to import `sanitizeStderr` from `@/lib/sanitize`.

## Exit criteria

- `sanitizeStderr` has documentation comments on both regexes
- `sanitizeStderr` is testable (moved to lib/)
- Unit test covers all cases listed above
- All gates pass: lint, tsc, build, vitest, lint:api-auth, lint:action-origin

## Deferred findings

None from this finding.
