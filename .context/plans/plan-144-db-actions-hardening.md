# Plan 144: DB Actions Child Process Hardening and CSV Defense-in-Depth

**Priority:** P2
**Source:** Cycle 43 review (C43-01, CR43-02, DS43-02, D43-01, TE43-02)

## Findings to Address

### 1. Set deterministic locale in mysqldump/mysql child processes (C43-01/CR43-01/S43-01/D43-04/A43-01)
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 120, 312
- Replace `LANG: process.env.LANG, LC_ALL: process.env.LC_ALL` with `LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8'`
- This ensures deterministic backup/restore behavior regardless of server locale
- Consistent with the principle established by the HOME removal (commit 00000002b)
- Add a comment explaining the security/consistency rationale for each env variable

### 2. Add control character stripping to `escapeCsvField` (CR43-02/S43-04)
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 20-29
- Strip null bytes and other non-\r\n control characters before the existing escape logic
- Apply regex `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g` to strip control characters
- This is defense-in-depth for legacy data stored before `stripControlChars` was added
- The existing `\r\n` replacement should remain (it converts to spaces)

### 3. Add security rationale comments to spawn env objects (DS43-02)
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 114-121, 307-313
- Add a comment block explaining why each env variable is included/excluded
- Specifically note: HOME excluded (prevents ~/.my.cnf loading), LANG/LC_ALL set to C.UTF-8 (deterministic output), MYSQL_* included (required for auth)

### 4. Verify backup file is non-empty after write (D43-01)
**File:** `apps/web/src/app/[locale]/admin/db-actions.ts` lines 143-186
- After writeStream finishes, stat the output file and verify it's non-empty
- Optionally check the first few bytes for the `-- MySQL dump` header
- Report failure if the file is empty or missing the expected header

## Deferred Items

### D1. Test coverage for `escapeCsvField` (TE43-02) — DEFERRED
**Reason:** Adding unit tests for `escapeCsvField` is valuable but is a test-coverage improvement, not a bug fix. The function is simple and its behavior can be verified manually. Should be done incrementally alongside other test coverage work.
**Exit criterion:** When test coverage for server actions is prioritized (see TE-38-01 through TE-38-04).

### D2. Test coverage for dump/restore locale behavior (TE43-01) — DEFERRED
**Reason:** Testing mysqldump/mysql child process behavior requires a running MySQL instance, making it an integration test. The fix (setting C.UTF-8) is simple enough that the risk is low.
**Exit criterion:** When integration test infrastructure is set up.

## Implementation Status: DONE
- 1. Set LANG/LC_ALL to C.UTF-8 in mysqldump/mysql spawn env ✅ (0000000ad)
- 2. Add control character stripping to escapeCsvField ✅ (0000000ad)
- 3. Add security rationale comments to spawn env objects ✅ (0000000ad)
- 4. Verify backup file is non-empty after write ✅ (0000000ad)
All deferred items remain deferred per the plan.

## Exit Criteria
- `LANG` and `LC_ALL` set to `'C.UTF-8'` in both spawn calls
- `escapeCsvField` strips control characters (except already-handled \r\n)
- Security rationale comments added to both spawn env objects
- Backup file verified as non-empty after write
- All existing tests pass
- ESLint passes
- Build succeeds
