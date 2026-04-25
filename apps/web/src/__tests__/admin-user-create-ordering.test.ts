import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * AGG10R-RPL-01 regression guard: assert that `createAdminUser` in
 * `admin-users.ts` performs form-field validation (empty/mismatch/too-short/
 * too-long/regex mismatch/control-char rejection) BEFORE the user_create
 * rate-limit pre-increment. Without this ordering, legitimate
 * authenticated-admin typos (e.g. too-short username, mismatched
 * confirmPassword, disallowed characters) burn the 10-per-hour user_create
 * bucket without ever triggering an Argon2 hash, locking the admin out of
 * user creation for an hour purely from client-side mistakes.
 *
 * Mirrors `auth-rate-limit-ordering.test.ts` which guards the parallel
 * AGG9R-RPL-01 fix in `updatePassword`.
 *
 * The contract: in the `createAdminUser` function body, the offsets of the
 * validation early-returns must all be smaller than the offset of the
 * `incrementRateLimit(ip, 'user_create', ...)` call.
 */
describe('admin-users.ts — createAdminUser validates form fields before rate-limit increment', () => {
    const source = readFileSync(
        resolve(__dirname, '..', 'app', 'actions', 'admin-users.ts'),
        'utf-8',
    );

    const createAdminUserMatch = /export async function createAdminUser[\s\S]*?^}/m.exec(source);

    it('createAdminUser exists in admin-users.ts', () => {
        expect(createAdminUserMatch).not.toBeNull();
    });

    it('validates control-char rejection (invalidUsernameFormat on sanitize delta) before pre-incrementing user_create', () => {
        const body = createAdminUserMatch![0];
        const sanitizeGuard = body.indexOf('if (username !== rawUsername)');
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'user_create'",
        );
        expect(sanitizeGuard).toBeGreaterThanOrEqual(0);
        expect(preIncrement).toBeGreaterThanOrEqual(0);
        expect(sanitizeGuard).toBeLessThan(preIncrement);
    });

    it('validates usernameTooShort before pre-incrementing user_create', () => {
        const body = createAdminUserMatch![0];
        const tooShort = body.indexOf("t('usernameTooShort')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'user_create'",
        );
        expect(tooShort).toBeGreaterThanOrEqual(0);
        expect(tooShort).toBeLessThan(preIncrement);
    });

    it('validates usernameTooLong before pre-incrementing user_create', () => {
        const body = createAdminUserMatch![0];
        const tooLong = body.indexOf("t('usernameTooLong')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'user_create'",
        );
        expect(tooLong).toBeGreaterThanOrEqual(0);
        expect(tooLong).toBeLessThan(preIncrement);
    });

    it('validates invalidUsernameFormat (regex) before pre-incrementing user_create', () => {
        const body = createAdminUserMatch![0];
        const regexFail = body.indexOf("t('invalidUsernameFormat')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'user_create'",
        );
        expect(regexFail).toBeGreaterThanOrEqual(0);
        expect(regexFail).toBeLessThan(preIncrement);
    });

    it('validates passwordTooShortCreate before pre-incrementing user_create', () => {
        const body = createAdminUserMatch![0];
        const pwdShort = body.indexOf("t('passwordTooShortCreate')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'user_create'",
        );
        expect(pwdShort).toBeGreaterThanOrEqual(0);
        expect(pwdShort).toBeLessThan(preIncrement);
    });

    it('validates passwordTooLongCreate before pre-incrementing user_create', () => {
        const body = createAdminUserMatch![0];
        const pwdLong = body.indexOf("t('passwordTooLongCreate')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'user_create'",
        );
        expect(pwdLong).toBeGreaterThanOrEqual(0);
        expect(pwdLong).toBeLessThan(preIncrement);
    });

    it('validates passwordsDoNotMatch before pre-incrementing user_create', () => {
        const body = createAdminUserMatch![0];
        const mismatch = body.indexOf("t('passwordsDoNotMatch')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'user_create'",
        );
        expect(mismatch).toBeGreaterThanOrEqual(0);
        expect(mismatch).toBeLessThan(preIncrement);
    });

    it('pre-increment is still present (guards against accidental removal of the TOCTOU fix)', () => {
        const body = createAdminUserMatch![0];
        expect(body).toMatch(
            /incrementRateLimit\(ip,\s*'user_create',\s*USER_CREATE_WINDOW_MS,\s*userCreateBucketStart\)/,
        );
    });

    it('in-memory checkUserCreateRateLimit call is still present (guards against accidental removal)', () => {
        const body = createAdminUserMatch![0];
        expect(body).toMatch(/if \(checkUserCreateRateLimit\(ip\)\)/);
    });

    /**
     * C11R-FRESH-01 regression guard: when `db.insert` throws
     * ER_DUP_ENTRY (username already exists), BOTH counters must be
     * rolled back. Without rollback, ten duplicate-username typos within
     * the 1-hour window lock the admin out of user creation purely from
     * client-side mistakes. Matches the precedent set by login /
     * updatePassword / createAdminUser-form-validation ordering:
     * legitimate user errors must not consume rate-limit slots.
     */
    it('rolls back DB rate limit when duplicate-username error is caught', () => {
        const body = createAdminUserMatch![0];
        // Locate the ER_DUP_ENTRY branch
        const dupBranchStart = body.indexOf("hasMySQLErrorCode(e, 'ER_DUP_ENTRY')");
        expect(dupBranchStart).toBeGreaterThanOrEqual(0);

        // Locate the next return for usernameExists
        const usernameExistsReturn = body.indexOf("return { error: t('usernameExists') };", dupBranchStart);
        expect(usernameExistsReturn).toBeGreaterThan(dupBranchStart);

        // Between the dup-entry branch start and the usernameExists return,
        // a one-attempt rollback must be called so duplicate-username failures
        // don't burn the current attempt, without deleting concurrent pressure
        // from the whole bucket.
        const dupBranchBody = body.slice(dupBranchStart, usernameExistsReturn);
        expect(dupBranchBody).toMatch(/rollbackUserCreateRateLimit\(ip,\s*'duplicate username',\s*userCreateBucketStart\)/);
    });
});
