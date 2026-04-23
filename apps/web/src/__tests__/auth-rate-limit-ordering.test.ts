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
});
