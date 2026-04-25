import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    headersMock,
    getImagesLiteMock,
    searchImagesMock,
    getClientIpMock,
    checkRateLimitMock,
    incrementRateLimitMock,
    decrementRateLimitMock,
    pruneSearchRateLimitMock,
    isRestoreMaintenanceActiveMock,
    searchRateLimit,
} = vi.hoisted(() => ({
    headersMock: vi.fn(),
    getImagesLiteMock: vi.fn(),
    searchImagesMock: vi.fn(),
    getClientIpMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    incrementRateLimitMock: vi.fn(),
    decrementRateLimitMock: vi.fn(),
    pruneSearchRateLimitMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
    searchRateLimit: new Map<string, { count: number; resetAt: number }>(),
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

vi.mock('@/lib/data', () => ({
    getImagesLite: getImagesLiteMock,
    searchImages: searchImagesMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    SEARCH_WINDOW_MS: 60_000,
    SEARCH_MAX_REQUESTS: 30,
    SEARCH_RATE_LIMIT_MAX_KEYS: 2_000,
    searchRateLimit,
    getClientIp: getClientIpMock,
    checkRateLimit: checkRateLimitMock,
    incrementRateLimit: incrementRateLimitMock,
    decrementRateLimit: decrementRateLimitMock,
    pruneSearchRateLimit: pruneSearchRateLimitMock,
    isRateLimitExceeded: (count: number, maxRequests: number, includesCurrentRequest = false) => (
        includesCurrentRequest ? count > maxRequests : count >= maxRequests
    ),
}));

import { loadMoreImages, searchImagesAction } from '@/app/actions/public';

describe('searchImagesAction', () => {
    beforeEach(() => {
        headersMock.mockReset();
        getImagesLiteMock.mockReset();
        searchImagesMock.mockReset();
        getClientIpMock.mockReset();
        checkRateLimitMock.mockReset();
        incrementRateLimitMock.mockReset();
        decrementRateLimitMock.mockReset();
        decrementRateLimitMock.mockResolvedValue(undefined);
        searchRateLimit.clear();

        headersMock.mockResolvedValue({
            get: vi.fn().mockReturnValue(null),
        });
        getClientIpMock.mockReturnValue('203.0.113.42');
        incrementRateLimitMock.mockResolvedValue(undefined);
        checkRateLimitMock.mockResolvedValue({ limited: false, count: 1 });
        pruneSearchRateLimitMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        getImagesLiteMock.mockResolvedValue([{ id: 1 }]);
        searchImagesMock.mockResolvedValue([{ id: 1 }]);
    });

    it('preserves unicode tag slugs when loading more images', async () => {
        const result = await loadMoreImages('seoul', ['서울', ' portrait ', ''], 10, 20);

        expect(result).toEqual({ images: [{ id: 1 }], hasMore: false });
        expect(getImagesLiteMock).toHaveBeenCalledWith('seoul', ['서울', 'portrait'], 21, 10);
    });

    it('returns no results for queries that are too short after sanitization', async () => {
        await expect(searchImagesAction('\u0000 ')).resolves.toEqual([]);
        expect(searchImagesMock).not.toHaveBeenCalled();
        expect(searchRateLimit.size).toBe(0);
    });

    it('short-circuits loadMoreImages during restore maintenance', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        await expect(loadMoreImages('seoul', ['서울'], 10, 20)).resolves.toEqual({ images: [], hasMore: false });

        expect(getImagesLiteMock).not.toHaveBeenCalled();
    });

    it('reports hasMore=false without requiring an empty terminal probe request', async () => {
        getImagesLiteMock.mockResolvedValue([{ id: 41 }, { id: 42 }]);

        await expect(loadMoreImages('seoul', ['서울'], 40, 2)).resolves.toEqual({
            images: [{ id: 41 }, { id: 42 }],
            hasMore: false,
        });

        expect(getImagesLiteMock).toHaveBeenCalledWith('seoul', ['서울'], 3, 40);
    });

    it('rate-limits anonymous loadMoreImages with DB-backed rollback on over-limit', async () => {
        checkRateLimitMock.mockResolvedValue({ limited: true, count: 121 });

        await expect(loadMoreImages('seoul', ['서울'], 10, 20)).resolves.toEqual({ images: [], hasMore: false });

        expect(getImagesLiteMock).not.toHaveBeenCalled();
        expect(incrementRateLimitMock).toHaveBeenCalledWith('203.0.113.42', 'load_more', 60_000);
        expect(decrementRateLimitMock).toHaveBeenCalledWith('203.0.113.42', 'load_more', 60_000);
    });

    it('keeps the sentinel row available when the caller asks for 100 images', async () => {
        getImagesLiteMock.mockResolvedValue(Array.from({ length: 101 }, (_, index) => ({ id: index + 1 })));

        await expect(loadMoreImages('seoul', ['서울'], 0, 100)).resolves.toEqual({
            images: Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })),
            hasMore: true,
        });

        expect(getImagesLiteMock).toHaveBeenCalledWith('seoul', ['서울'], 101, 0);
    });

    it('short-circuits searchImagesAction during restore maintenance before rate-limit or DB work', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        await expect(searchImagesAction('landscape')).resolves.toEqual([]);

        expect(headersMock).not.toHaveBeenCalled();
        expect(getClientIpMock).not.toHaveBeenCalled();
        expect(incrementRateLimitMock).not.toHaveBeenCalled();
        expect(checkRateLimitMock).not.toHaveBeenCalled();
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

    it('rolls back BOTH in-memory AND DB counters on over-limit (C6R-RPL-03 / AGG6R-02)', async () => {
        checkRateLimitMock.mockResolvedValue({ limited: true, count: 31 });

        await searchImagesAction('landscape');

        // Symmetric rollback: in-memory was cleared (asserted above) AND
        // the DB decrement was invoked to undo the pre-increment at line
        // 65 of public.ts. Without this, the DB counter drifts ahead of
        // in-memory, causing premature rate-limiting later in the window.
        expect(decrementRateLimitMock).toHaveBeenCalledWith('203.0.113.42', 'search', 60_000);
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

    it('rolls back both search counters when the search query throws after pre-increment', async () => {
        searchImagesMock.mockRejectedValue(new Error('db query failed'));

        await expect(searchImagesAction('landscape')).rejects.toThrow('db query failed');

        expect(searchRateLimit.has('203.0.113.42')).toBe(false);
        expect(decrementRateLimitMock).toHaveBeenCalledWith('203.0.113.42', 'search', 60_000);
    });
});
