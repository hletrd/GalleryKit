import { afterEach, describe, expect, it } from 'vitest';
import {
    OG_MAX_REQUESTS,
    OG_WINDOW_MS,
    ogRateLimit,
    preIncrementOgAttempt,
    pruneOgRateLimit,
    resetOgRateLimitForTests,
} from '@/lib/rate-limit';

afterEach(() => {
    resetOgRateLimitForTests();
});

describe('preIncrementOgAttempt (AGG8F-01 / plan-233)', () => {
    it('returns false for the first request and true once over OG_MAX_REQUESTS', () => {
        const ip = '203.0.113.10';
        const now = 1_000_000;

        for (let i = 1; i <= OG_MAX_REQUESTS; i++) {
            expect(preIncrementOgAttempt(ip, now)).toBe(false);
        }
        // Next call exceeds the bucket.
        expect(preIncrementOgAttempt(ip, now)).toBe(true);
    });

    it('resets the bucket once `now` advances past `resetAt`', () => {
        const ip = '203.0.113.11';
        const start = 2_000_000;

        // Saturate.
        for (let i = 0; i < OG_MAX_REQUESTS; i++) {
            preIncrementOgAttempt(ip, start);
        }
        expect(preIncrementOgAttempt(ip, start)).toBe(true);

        // Advance past the window — the next call must be a fresh bucket.
        const after = start + OG_WINDOW_MS + 1;
        expect(preIncrementOgAttempt(ip, after)).toBe(false);
        const entry = ogRateLimit.get(ip);
        expect(entry?.count).toBe(1);
        expect(entry?.resetAt).toBe(after + OG_WINDOW_MS);
    });
});

describe('pruneOgRateLimit (AGG8F-01 / plan-233)', () => {
    it('evicts entries whose window has already expired', () => {
        const expiredIp = '198.51.100.1';
        const liveIp = '198.51.100.2';
        const now = 5_000_000;

        ogRateLimit.set(expiredIp, { count: 4, resetAt: now - 1 });
        ogRateLimit.set(liveIp, { count: 1, resetAt: now + OG_WINDOW_MS });

        pruneOgRateLimit(now);

        expect(ogRateLimit.has(expiredIp)).toBe(false);
        expect(ogRateLimit.has(liveIp)).toBe(true);
    });
});
