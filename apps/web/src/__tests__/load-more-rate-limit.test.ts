import { describe, expect, it, vi } from 'vitest';

/**
 * C3-TG03: Test for loadMoreRateLimit pre-increment + rollback pattern.
 * Exercises the in-memory rate-limit mechanics of loadMoreImages through
 * its public surface, matching parity with og-rate-limit.test.ts and the
 * search-rate-limit coverage in public-actions.test.ts.
 *
 * The loadMoreRateLimit Map is module-private in actions/public.ts and
 * cannot be reset between tests, so each test case uses a unique IP to
 * avoid cross-test Map contamination.
 */

const {
    headersMock,
    getImagesLiteMock,
    getClientIpMock,
    isRestoreMaintenanceActiveMock,
} = vi.hoisted(() => ({
    headersMock: vi.fn(),
    getImagesLiteMock: vi.fn(),
    getClientIpMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

vi.mock('@/lib/data', () => ({
    getImagesLite: getImagesLiteMock,
    normalizeImageListCursor: (value: unknown) => {
        if (!value || typeof value !== 'object') return null;
        const candidate = value as { id?: unknown; capture_date?: unknown; created_at?: unknown };
        if (typeof candidate.id !== 'number' || !Number.isInteger(candidate.id) || candidate.id <= 0) return null;
        if (!(candidate.capture_date === null || typeof candidate.capture_date === 'string')) return null;
        if (!(typeof candidate.created_at === 'string' || candidate.created_at instanceof Date)) return null;
        return {
            id: candidate.id,
            capture_date: candidate.capture_date,
            created_at: candidate.created_at instanceof Date ? candidate.created_at : new Date(candidate.created_at),
        };
    },
    searchImages: vi.fn(),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    SEARCH_WINDOW_MS: 60_000,
    SEARCH_MAX_REQUESTS: 30,
    SEARCH_RATE_LIMIT_MAX_KEYS: 2_000,
    searchRateLimit: new Map(),
    getClientIp: getClientIpMock,
    checkRateLimit: vi.fn().mockResolvedValue({ limited: false, count: 0 }),
    incrementRateLimit: vi.fn().mockResolvedValue(undefined),
    decrementRateLimit: vi.fn().mockResolvedValue(undefined),
    pruneSearchRateLimit: vi.fn(),
    getRateLimitBucketStart: vi.fn().mockReturnValue(1_700_000_000),
    isRateLimitExceeded: (count: number, maxRequests: number, includesCurrentRequest = false) => (
        includesCurrentRequest ? count > maxRequests : count >= maxRequests
    ),
}));

import { loadMoreImages } from '@/app/actions/public';

const LOAD_MORE_MAX_REQUESTS = 120;
const LOAD_MORE_WINDOW_MS = 60_000;

describe('loadMoreRateLimit (C3-TG03)', () => {
    let ipCounter = 1;

    /** Return a unique IP per test to avoid Map contamination. */
    function nextIp(): string {
        return `198.51.100.${ipCounter++}`;
    }

    function setupMocks(ip: string) {
        headersMock.mockResolvedValue({
            get: vi.fn().mockReturnValue(null),
        });
        getClientIpMock.mockReturnValue(ip);
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        getImagesLiteMock.mockResolvedValue([{ id: 1 }]);
    }

    describe('preIncrementLoadMoreAttempt', () => {
        it('allows requests up to LOAD_MORE_MAX_REQUESTS and blocks the next', async () => {
            const ip = nextIp();
            setupMocks(ip);

            for (let i = 0; i < LOAD_MORE_MAX_REQUESTS; i++) {
                const result = await loadMoreImages(undefined, [], 0, 30);
                expect(result.status).toBe('ok');
            }

            const result = await loadMoreImages(undefined, [], 0, 30);
            expect(result).toEqual({ status: 'rateLimited', images: [], hasMore: true });
        });

        it('resets the in-memory bucket after the window expires', async () => {
            const ip = nextIp();
            setupMocks(ip);

            const baseTime = 10_000_000;
            const originalDateNow = Date.now;
            let currentTime = baseTime;
            Date.now = () => currentTime;

            try {
                // Saturate the bucket
                for (let i = 0; i < LOAD_MORE_MAX_REQUESTS; i++) {
                    await loadMoreImages(undefined, [], 0, 30);
                }

                const limited = await loadMoreImages(undefined, [], 0, 30);
                expect(limited.status).toBe('rateLimited');

                // Advance past the window — bucket should reset
                currentTime = baseTime + LOAD_MORE_WINDOW_MS + 1;

                const after = await loadMoreImages(undefined, [], 0, 30);
                expect(after.status).toBe('ok');
            } finally {
                Date.now = originalDateNow;
            }
        });

        it('isolates buckets per IP', async () => {
            const ipA = nextIp();
            const ipB = nextIp();

            // Saturate IP A
            setupMocks(ipA);
            for (let i = 0; i < LOAD_MORE_MAX_REQUESTS; i++) {
                await loadMoreImages(undefined, [], 0, 30);
            }
            expect((await loadMoreImages(undefined, [], 0, 30)).status).toBe('rateLimited');

            // IP B should be unaffected
            setupMocks(ipB);
            const result = await loadMoreImages(undefined, [], 0, 30);
            expect(result.status).toBe('ok');
        });
    });

    describe('rollbackLoadMoreAttempt', () => {
        it('rolls back the pre-increment when getImagesLite throws', async () => {
            const ip = nextIp();
            setupMocks(ip);

            getImagesLiteMock.mockRejectedValueOnce(new Error('DB error'));

            // Pre-increment happened but rollback should decrement it
            await expect(loadMoreImages(undefined, [], 0, 30)).rejects.toThrow('DB error');

            // The next call should succeed (the failed increment was rolled back)
            const result = await loadMoreImages(undefined, [], 0, 30);
            expect(result.status).toBe('ok');
        });

        it('allows exactly LOAD_MORE_MAX_REQUESTS successful calls after a rolled-back failure', async () => {
            const ip = nextIp();
            setupMocks(ip);

            // One failed call whose pre-increment is rolled back
            getImagesLiteMock.mockRejectedValueOnce(new Error('DB error'));
            await expect(loadMoreImages(undefined, [], 0, 30)).rejects.toThrow('DB error');

            // Now 120 successful calls — the failed attempt does not count
            for (let i = 0; i < LOAD_MORE_MAX_REQUESTS; i++) {
                const result = await loadMoreImages(undefined, [], 0, 30);
                expect(result.status).toBe('ok');
            }

            // The 121st successful request should be rate limited
            const result = await loadMoreImages(undefined, [], 0, 30);
            expect(result).toEqual({ status: 'rateLimited', images: [], hasMore: true });
        });
    });
});
