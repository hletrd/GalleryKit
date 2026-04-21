import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    headersMock,
    searchImagesMock,
    getClientIpMock,
    checkRateLimitMock,
    incrementRateLimitMock,
    searchRateLimit,
} = vi.hoisted(() => ({
    headersMock: vi.fn(),
    searchImagesMock: vi.fn(),
    getClientIpMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    incrementRateLimitMock: vi.fn(),
    searchRateLimit: new Map<string, { count: number; resetAt: number }>(),
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

vi.mock('@/lib/data', () => ({
    getImagesLite: vi.fn(),
    searchImages: searchImagesMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    SEARCH_WINDOW_MS: 60_000,
    SEARCH_MAX_REQUESTS: 30,
    SEARCH_RATE_LIMIT_MAX_KEYS: 2_000,
    searchRateLimit,
    getClientIp: getClientIpMock,
    checkRateLimit: checkRateLimitMock,
    incrementRateLimit: incrementRateLimitMock,
    isRateLimitExceeded: (count: number, maxRequests: number, includesCurrentRequest = false) => (
        includesCurrentRequest ? count > maxRequests : count >= maxRequests
    ),
}));

import { searchImagesAction } from '@/app/actions/public';

describe('searchImagesAction', () => {
    beforeEach(() => {
        headersMock.mockReset();
        searchImagesMock.mockReset();
        getClientIpMock.mockReset();
        checkRateLimitMock.mockReset();
        incrementRateLimitMock.mockReset();
        searchRateLimit.clear();

        headersMock.mockResolvedValue({
            get: vi.fn().mockReturnValue(null),
        });
        getClientIpMock.mockReturnValue('203.0.113.42');
        incrementRateLimitMock.mockResolvedValue(undefined);
        checkRateLimitMock.mockResolvedValue({ limited: false, count: 1 });
        searchImagesMock.mockResolvedValue([{ id: 1 }]);
    });

    it('returns no results for queries that are too short after sanitization', async () => {
        await expect(searchImagesAction('\u0000 ')).resolves.toEqual([]);
        expect(searchImagesMock).not.toHaveBeenCalled();
        expect(searchRateLimit.size).toBe(0);
    });

    it('rolls back the in-memory pre-increment when the DB bucket is already over the limit', async () => {
        checkRateLimitMock.mockResolvedValue({ limited: true, count: 31 });

        const result = await searchImagesAction('landscape');

        expect(result).toEqual([]);
        expect(searchImagesMock).not.toHaveBeenCalled();
        expect(searchRateLimit.has('203.0.113.42')).toBe(false);
    });

    it('falls back to the in-memory limiter when the DB increment fails', async () => {
        incrementRateLimitMock.mockRejectedValue(new Error('db offline'));

        const result = await searchImagesAction('landscape');

        expect(result).toEqual([{ id: 1 }]);
        expect(searchImagesMock).toHaveBeenCalledWith('landscape', 20);
        expect(searchRateLimit.get('203.0.113.42')).toEqual({
            count: 1,
            resetAt: expect.any(Number),
        });
    });
});
