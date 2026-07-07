import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    resolve(__dirname, '../app/[locale]/admin/(protected)/password/password-form.tsx'),
    'utf8',
);

describe('PasswordForm accessibility source contract', () => {
    it('associates the visible minimum-length help with both new password fields', () => {
        expect(source).toContain("const passwordHelpId = 'password-min-length-help'");
        expect(source).toContain('aria-describedby={passwordHelpId}');
        expect(source).toContain('id={passwordHelpId}');
        expect(source).toContain('aria-describedby={confirmPasswordDescription}');
        expect(source).toContain('? `${passwordHelpId} confirmPassword-error`');
        expect(source).toContain(': passwordHelpId');
    });

    it('moves focus to the confirm-password field on local mismatch validation', () => {
        expect(source).toContain('const confirmPasswordRef = useRef<HTMLInputElement>(null)');
        expect(source).toContain('confirmPasswordRef.current?.focus()');
        expect(source).toContain('confirmPasswordRef.current?.select()');
        expect(source).toContain('ref={confirmPasswordRef}');
    });
});
