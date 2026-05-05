import { afterEach, describe, expect, it } from 'vitest';
import {
    checkAndIncrementSemanticRateLimit,
    resetSemanticRateLimitForTests,
} from '@/app/api/search/semantic/route';

afterEach(() => {
    resetSemanticRateLimitForTests();
});

describe('checkAndIncrementSemanticRateLimit', () => {
    it('returns false for the first request and true once over the limit', () => {
        const ip = '203.0.113.50';
        const now = 1_000_000;

        for (let i = 1; i <= 30; i++) {
            expect(checkAndIncrementSemanticRateLimit(ip, now)).toBe(false);
        }
        // 31st call exceeds the bucket.
        expect(checkAndIncrementSemanticRateLimit(ip, now)).toBe(true);
    });

    it('resets the bucket once now advances past resetAt', () => {
        const ip = '203.0.113.51';
        const start = 2_000_000;

        // Saturate.
        for (let i = 0; i < 30; i++) {
            checkAndIncrementSemanticRateLimit(ip, start);
        }
        expect(checkAndIncrementSemanticRateLimit(ip, start)).toBe(true);

        // Advance past the window — the next call must be a fresh bucket.
        const after = start + 60_000 + 1;
        expect(checkAndIncrementSemanticRateLimit(ip, after)).toBe(false);
    });

    it('tracks different IPs independently', () => {
        const now = 3_000_000;
        const ipA = '203.0.113.10';
        const ipB = '203.0.113.11';

        // Saturate ipA
        for (let i = 0; i < 30; i++) {
            checkAndIncrementSemanticRateLimit(ipA, now);
        }
        expect(checkAndIncrementSemanticRateLimit(ipA, now)).toBe(true);

        // ipB should still have budget
        expect(checkAndIncrementSemanticRateLimit(ipB, now)).toBe(false);
    });
});
