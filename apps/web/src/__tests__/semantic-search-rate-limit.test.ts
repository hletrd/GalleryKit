import { afterEach, describe, expect, it } from 'vitest';
import {
    SEMANTIC_RATE_LIMIT_MAX,
    SEMANTIC_RATE_LIMIT_WINDOW_MS,
    preIncrementSemanticAttempt,
    rollbackSemanticAttempt,
    resetSemanticRateLimitForTests,
} from '@/lib/rate-limit';

afterEach(() => {
    resetSemanticRateLimitForTests();
});

describe('preIncrementSemanticAttempt (R2C11-MED-01 / R2C11-LOW-10)', () => {
    it('returns false for the first request and true once over SEMANTIC_RATE_LIMIT_MAX', () => {
        const ip = '203.0.113.50';
        const now = 1_000_000;

        for (let i = 1; i <= SEMANTIC_RATE_LIMIT_MAX; i++) {
            expect(preIncrementSemanticAttempt(ip, now)).toBe(false);
        }
        // Next call exceeds the bucket.
        expect(preIncrementSemanticAttempt(ip, now)).toBe(true);
    });

    it('resets the bucket once now advances past resetAt', () => {
        const ip = '203.0.113.51';
        const start = 2_000_000;

        // Saturate.
        for (let i = 0; i < SEMANTIC_RATE_LIMIT_MAX; i++) {
            preIncrementSemanticAttempt(ip, start);
        }
        expect(preIncrementSemanticAttempt(ip, start)).toBe(true);

        // Advance past the window — the next call must be a fresh bucket.
        const after = start + SEMANTIC_RATE_LIMIT_WINDOW_MS + 1;
        expect(preIncrementSemanticAttempt(ip, after)).toBe(false);
    });

    it('tracks different IPs independently', () => {
        const now = 3_000_000;
        const ipA = '203.0.113.10';
        const ipB = '203.0.113.11';

        // Saturate ipA
        for (let i = 0; i < SEMANTIC_RATE_LIMIT_MAX; i++) {
            preIncrementSemanticAttempt(ipA, now);
        }
        expect(preIncrementSemanticAttempt(ipA, now)).toBe(true);

        // ipB should still have budget
        expect(preIncrementSemanticAttempt(ipB, now)).toBe(false);
    });
});

describe('rollbackSemanticAttempt (R2C11-LOW-10)', () => {
    it('rolls back a single pre-incremented attempt', () => {
        const ip = '203.0.113.60';
        const now = 4_000_000;

        // Pre-increment once
        expect(preIncrementSemanticAttempt(ip, now)).toBe(false);

        // Roll it back
        rollbackSemanticAttempt(ip);

        // Should be back to having full budget
        for (let i = 0; i < SEMANTIC_RATE_LIMIT_MAX; i++) {
            expect(preIncrementSemanticAttempt(ip, now)).toBe(false);
        }
        expect(preIncrementSemanticAttempt(ip, now)).toBe(true);
    });

    it('rolls back multiple attempts correctly', () => {
        const ip = '203.0.113.61';
        const now = 5_000_000;

        // Pre-increment 5 times
        for (let i = 0; i < 5; i++) {
            preIncrementSemanticAttempt(ip, now);
        }

        // Roll back 3 times
        for (let i = 0; i < 3; i++) {
            rollbackSemanticAttempt(ip);
        }

        // Should have used 2 slots, so 30 - 2 = 28 remaining
        for (let i = 0; i < 28; i++) {
            expect(preIncrementSemanticAttempt(ip, now)).toBe(false);
        }
        expect(preIncrementSemanticAttempt(ip, now)).toBe(true);
    });

    it('deletes the entry when rolling back from count 1', () => {
        const ip = '203.0.113.62';
        const now = 6_000_000;

        preIncrementSemanticAttempt(ip, now);
        rollbackSemanticAttempt(ip);

        // After rolling back from count 1, the entry should be removed
        // Next increment should create a fresh bucket
        expect(preIncrementSemanticAttempt(ip, now)).toBe(false);
        // Should have 29 remaining after that
        for (let i = 0; i < 29; i++) {
            expect(preIncrementSemanticAttempt(ip, now)).toBe(false);
        }
        expect(preIncrementSemanticAttempt(ip, now)).toBe(true);
    });

    it('is a no-op when the IP has no entry', () => {
        const ip = '203.0.113.63';

        // Rolling back a non-existent entry should not throw
        rollbackSemanticAttempt(ip);

        // Should still have full budget
        const now = 7_000_000;
        for (let i = 0; i < SEMANTIC_RATE_LIMIT_MAX; i++) {
            expect(preIncrementSemanticAttempt(ip, now)).toBe(false);
        }
        expect(preIncrementSemanticAttempt(ip, now)).toBe(true);
    });

    it('allows exactly SEMANTIC_RATE_LIMIT_MAX successful calls after rolled-back failures', () => {
        const ip = '203.0.113.64';
        const now = 8_000_000;

        // Simulate 5 validation failures (each pre-incremented then rolled back)
        for (let i = 0; i < 5; i++) {
            preIncrementSemanticAttempt(ip, now);
            rollbackSemanticAttempt(ip);
        }

        // Now 30 successful calls — the failed attempts do not count
        for (let i = 0; i < SEMANTIC_RATE_LIMIT_MAX; i++) {
            expect(preIncrementSemanticAttempt(ip, now)).toBe(false);
        }

        // The 31st successful request should be rate limited
        expect(preIncrementSemanticAttempt(ip, now)).toBe(true);
    });
});
