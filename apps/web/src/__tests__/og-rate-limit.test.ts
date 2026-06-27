import { afterEach, describe, expect, it } from 'vitest';
import {
    OG_MAX_REQUESTS,
    OG_WINDOW_MS,
    ogRateLimit,
    preIncrementOgAttempt,
    pruneOgRateLimit,
    rollbackOgAttempt,
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

// R19C19 test FINDING-1: rollbackSemanticAttempt has five behavioral tests but
// its OG twin rollbackOgAttempt — the decrement-vs-delete branch used by the
// photo OG route on a pre-DB syntactic rejection (og-photo-fallback.test.ts) —
// had none. These exercise both branches directly.
describe('rollbackOgAttempt (R19C19 FINDING-1)', () => {
    it('decrements a pre-incremented counter when count > 1', () => {
        const ip = '203.0.113.20';
        const now = 1_000_000;
        preIncrementOgAttempt(ip, now); // count 1
        preIncrementOgAttempt(ip, now); // count 2
        rollbackOgAttempt(ip);
        expect(ogRateLimit.get(ip)?.count).toBe(1);
        expect(ogRateLimit.has(ip)).toBe(true);
    });

    it('deletes the entry when rolling back from count 1', () => {
        const ip = '203.0.113.21';
        const now = 1_000_000;
        preIncrementOgAttempt(ip, now); // count 1
        rollbackOgAttempt(ip);
        expect(ogRateLimit.has(ip)).toBe(false);
    });

    it('rolls back multiple attempts down to deletion', () => {
        const ip = '203.0.113.22';
        const now = 1_000_000;
        for (let i = 0; i < 3; i++) preIncrementOgAttempt(ip, now); // count 3
        rollbackOgAttempt(ip); // 2
        rollbackOgAttempt(ip); // 1
        expect(ogRateLimit.get(ip)?.count).toBe(1);
        rollbackOgAttempt(ip); // deletes
        expect(ogRateLimit.has(ip)).toBe(false);
    });

    it('is a no-op when the IP has no entry (does not throw or create one)', () => {
        const ip = '203.0.113.23';
        expect(() => rollbackOgAttempt(ip)).not.toThrow();
        expect(ogRateLimit.has(ip)).toBe(false);
    });

    it('preserves resetAt when decrementing (rollback does not extend the window)', () => {
        const ip = '203.0.113.24';
        const now = 4_000_000;
        preIncrementOgAttempt(ip, now);
        preIncrementOgAttempt(ip, now);
        const resetAt = ogRateLimit.get(ip)?.resetAt;
        rollbackOgAttempt(ip);
        expect(ogRateLimit.get(ip)?.resetAt).toBe(resetAt);
    });
});
