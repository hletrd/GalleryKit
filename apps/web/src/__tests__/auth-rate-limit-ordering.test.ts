import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * AGG9R-RPL-01 regression guard: assert that `updatePassword` in `auth.ts`
 * performs form-field validation (empty/mismatch/too-short/too-long) BEFORE
 * the password-change rate-limit pre-increment. Without this ordering,
 * legitimate admin typos (e.g. forgetting confirmPassword) burn the 10-attempt
 * bucket without ever triggering an Argon2 verify, locking the admin out of
 * password change for 15 minutes purely from client-side mistakes.
 *
 * The contract: in the `updatePassword` function body, the offsets of the
 * four validation early-returns must all be smaller than the offset of the
 * `incrementRateLimit(ip, 'password_change', ...)` call.
 *
 * This is a static-text check mirroring the auth-rethrow.test.ts pattern.
 */
describe('auth.ts — updatePassword validates form fields before rate-limit increment', () => {
    const authSource = readFileSync(
        resolve(__dirname, '..', 'app', 'actions', 'auth.ts'),
        'utf-8',
    );

    const updatePasswordMatch = /export async function updatePassword[\s\S]*?^}/m.exec(authSource);

    it('updatePassword exists in auth.ts', () => {
        expect(updatePasswordMatch).not.toBeNull();
    });

    it('validates presence (allFieldsRequired) before pre-incrementing password_change', () => {
        const body = updatePasswordMatch![0];
        const allFields = body.indexOf("t('allFieldsRequired')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'password_change'",
        );
        expect(allFields).toBeGreaterThanOrEqual(0);
        expect(preIncrement).toBeGreaterThanOrEqual(0);
        expect(allFields).toBeLessThan(preIncrement);
    });

    it('validates newPassword !== confirmPassword before pre-incrementing password_change', () => {
        const body = updatePasswordMatch![0];
        const mismatchCheck = body.indexOf("t('passwordsDoNotMatch')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'password_change'",
        );
        expect(mismatchCheck).toBeGreaterThanOrEqual(0);
        expect(mismatchCheck).toBeLessThan(preIncrement);
    });

    it('validates passwordTooShort before pre-incrementing password_change', () => {
        const body = updatePasswordMatch![0];
        const tooShort = body.indexOf("t('passwordTooShort')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'password_change'",
        );
        expect(tooShort).toBeGreaterThanOrEqual(0);
        expect(tooShort).toBeLessThan(preIncrement);
    });

    it('validates passwordTooLong before pre-incrementing password_change', () => {
        const body = updatePasswordMatch![0];
        const tooLong = body.indexOf("t('passwordTooLong')");
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'password_change'",
        );
        expect(tooLong).toBeGreaterThanOrEqual(0);
        expect(tooLong).toBeLessThan(preIncrement);
    });

    it('pre-increment is still present (guards against accidental removal of the TOCTOU fix)', () => {
        const body = updatePasswordMatch![0];
        expect(body).toMatch(
            /incrementRateLimit\(ip,\s*'password_change',\s*LOGIN_WINDOW_MS\)/,
        );
    });

    it('checks the DB password_change bucket only after pre-incrementing it', () => {
        const body = updatePasswordMatch![0];
        const preIncrement = body.indexOf(
            "incrementRateLimit(ip, 'password_change'",
        );
        const dbCheck = body.indexOf(
            "checkRateLimit(ip, 'password_change'",
        );
        expect(preIncrement).toBeGreaterThanOrEqual(0);
        expect(dbCheck).toBeGreaterThanOrEqual(0);
        expect(preIncrement).toBeLessThan(dbCheck);
    });

    it('uses includes-current-request semantics for over-limit password_change checks', () => {
        const body = updatePasswordMatch![0];
        expect(body).toContain('isRateLimitExceeded(dbLimit.count, PASSWORD_CHANGE_MAX_ATTEMPTS, true)');
    });

    it('rotates all sessions and inserts a fresh current session after password change', () => {
        const body = updatePasswordMatch![0];
        expect(body).toContain('await tx.delete(sessions).where(eq(sessions.userId, currentUser.id))');
        expect(body).toContain('await tx.insert(sessions).values');
        expect(body).not.toContain('sessions.id} != ${currentSession.id}');
        expect(body).toContain('cookieStore.set(COOKIE_NAME, newSessionToken');
    });
});

describe('auth.ts — login DB-backed rate limits include the current request', () => {
    const authSource = readFileSync(
        resolve(__dirname, '..', 'app', 'actions', 'auth.ts'),
        'utf-8',
    );

    const loginMatch = /export async function login[\s\S]*?^}/m.exec(authSource);

    it('login exists in auth.ts', () => {
        expect(loginMatch).not.toBeNull();
    });

    it('increments login IP and account buckets before checking DB counts', () => {
        const body = loginMatch![0];
        const ipIncrement = body.indexOf("incrementRateLimit(ip, 'login'");
        const accountIncrement = body.indexOf("incrementRateLimit(accountRateLimitKey, 'login_account'");
        const ipCheck = body.indexOf("checkRateLimit(ip, 'login'");
        const accountCheck = body.indexOf("checkRateLimit(accountRateLimitKey, 'login_account'");
        expect(ipIncrement).toBeGreaterThanOrEqual(0);
        expect(accountIncrement).toBeGreaterThanOrEqual(0);
        expect(ipCheck).toBeGreaterThanOrEqual(0);
        expect(accountCheck).toBeGreaterThanOrEqual(0);
        expect(ipIncrement).toBeLessThan(ipCheck);
        expect(accountIncrement).toBeLessThan(accountCheck);
    });

    it('uses includes-current-request semantics and rolls back rejected login attempts', () => {
        const body = loginMatch![0];
        expect(body).toContain('isRateLimitExceeded(dbLimit.count, LOGIN_MAX_ATTEMPTS, true)');
        expect(body).toContain('isRateLimitExceeded(accountLimit.count, LOGIN_MAX_ATTEMPTS, true)');
        expect(body).toContain('rollbackLoginRateLimit(ip)');
        expect(body).toContain("decrementRateLimit(accountRateLimitKey, 'login_account', LOGIN_WINDOW_MS)");
    });
});
