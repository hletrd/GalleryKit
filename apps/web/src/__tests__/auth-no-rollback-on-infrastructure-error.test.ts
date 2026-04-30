/**
 * Test: verify that the login and updatePassword catch blocks do NOT
 * roll back rate-limit counters on unexpected infrastructure errors.
 *
 * C1F-CR-04 / C1F-SR-01: Rolling back on infrastructure errors gives
 * attackers extra attempts when they can trigger infrastructure errors.
 * The fix removes rollback calls from the outer catch blocks.
 *
 * This is a fixture-style test that verifies the source code does not
 * contain the regression pattern (rollback in infrastructure-error catch).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const AUTH_FILE = path.join(__dirname, '..', 'app', 'actions', 'auth.ts');

describe('auth rate-limit rollback on infrastructure errors', () => {
  const source = fs.readFileSync(AUTH_FILE, 'utf-8');
  const lines = source.split('\n');

  it('should not call rollbackLoginRateLimit in the login infrastructure-error catch', () => {
    // Find the outer catch block in the login function that handles
    // infrastructure errors (after the Argon2 verify block).
    // It should NOT contain rollbackLoginRateLimit.
    const loginCatchStart = source.indexOf(
      'console.error("Login verification failed:"',
    );
    expect(loginCatchStart).toBeGreaterThan(0);

    // Find the end of this catch block (next `}` at the correct nesting level)
    const afterLoginCatch = source.substring(loginCatchStart);
    const catchBlockEnd = afterLoginCatch.indexOf('return { error: t(');
    expect(catchBlockEnd).toBeGreaterThan(0);

    const catchBlock = afterLoginCatch.substring(0, catchBlockEnd + 50);
    expect(catchBlock).not.toContain('rollbackLoginRateLimit');
    expect(catchBlock).not.toContain('rollbackAccountLoginRateLimit');
  });

  it('should not call rollbackPasswordChangeRateLimit in the updatePassword infrastructure-error catch', () => {
    const passwordCatchStart = source.indexOf(
      'console.error("Failed to update password:"',
    );
    expect(passwordCatchStart).toBeGreaterThan(0);

    const afterPasswordCatch = source.substring(passwordCatchStart);
    const catchBlockEnd = afterPasswordCatch.indexOf("return { error: t('failedToUpdatePassword') }");
    expect(catchBlockEnd).toBeGreaterThan(0);

    const catchBlock = afterPasswordCatch.substring(0, catchBlockEnd + 50);
    expect(catchBlock).not.toContain('rollbackPasswordChangeRateLimit');
  });

  it('should still call rollback in the tooManyAttempts early-return path', () => {
    // The rollback on the tooManyAttempts path is correct — the request
    // was rejected before authentication work, so the pre-increment must
    // be rolled back.
    const tooManyAttemptsSection = source.indexOf(
      "return { error: t('tooManyAttempts') };",
    );
    expect(tooManyAttemptsSection).toBeGreaterThan(0);

    // There should be rollback calls BEFORE this return
    const beforeTooMany = source.substring(0, tooManyAttemptsSection);
    expect(beforeTooMany).toContain('rollbackLoginRateLimit');
  });
});
