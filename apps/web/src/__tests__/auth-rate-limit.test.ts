import { beforeEach, describe, expect, it, vi } from 'vitest';

const { incrementRateLimit, resetRateLimit, loginRateLimit } = vi.hoisted(() => ({
    incrementRateLimit: vi.fn(),
    resetRateLimit: vi.fn(),
    loginRateLimit: new Map<string, { count: number; lastAttempt: number }>(),
}));

vi.mock('@/lib/rate-limit', () => ({
    LOGIN_WINDOW_MS: 15 * 60 * 1000,
    incrementRateLimit,
    resetRateLimit,
    loginRateLimit,
}));

import {
    clearSuccessfulLoginAttempts,
    getLoginRateLimitEntry,
    recordFailedLoginAttempt,
} from '@/lib/auth-rate-limit';

describe('auth-rate-limit helpers', () => {
    beforeEach(() => {
        incrementRateLimit.mockReset();
        resetRateLimit.mockReset();
        loginRateLimit.clear();
    });

    it('resets expired in-memory login counts before evaluating a new attempt', () => {
        loginRateLimit.set('203.0.113.1', {
            count: 4,
            lastAttempt: 1,
        });

        expect(getLoginRateLimitEntry('203.0.113.1', 15 * 60 * 1000 + 2)).toEqual({
            count: 0,
            lastAttempt: 1,
        });
    });

    it('records failed attempts in memory and persists them to the current DB bucket', async () => {
        incrementRateLimit.mockResolvedValue(undefined);

        await recordFailedLoginAttempt('203.0.113.2', 123_456);

        expect(loginRateLimit.get('203.0.113.2')).toEqual({
            count: 1,
            lastAttempt: 123_456,
        });
        expect(incrementRateLimit).toHaveBeenCalledWith('203.0.113.2', 'login', 15 * 60 * 1000);
    });

    it('clears successful-login state from both memory and the DB bucket', async () => {
        resetRateLimit.mockResolvedValue(undefined);
        loginRateLimit.set('203.0.113.3', {
            count: 3,
            lastAttempt: 654_321,
        });

        await clearSuccessfulLoginAttempts('203.0.113.3');

        expect(loginRateLimit.has('203.0.113.3')).toBe(false);
        expect(resetRateLimit).toHaveBeenCalledWith('203.0.113.3', 'login', 15 * 60 * 1000);
    });
});
