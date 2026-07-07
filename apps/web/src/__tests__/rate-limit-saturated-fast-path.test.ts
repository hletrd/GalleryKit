import { describe, expect, it, vi } from 'vitest';

/**
 * C1-01 (run-10 cycle-1): read-only saturated fast path for the public
 * `load_more` and `view_record` limiters.
 *
 * Once an IP's in-memory bucket is saturated, every further request in the
 * window must be rejected WITHOUT any persistent limiter work — no
 * incrementRateLimit, no checkRateLimit, no decrementRateLimit round-trips
 * against the single-writer MySQL instance. This mirrors the pre-existing
 * searchImagesAction fast path and closes the cycle-99 architect finding
 * (C99-01) re-confirmed by run-10 cycle-1 FD-01.
 *
 * The in-memory maps are module-private and persist for the file lifetime,
 * so each test uses a unique IP (same pattern as load-more-rate-limit.test.ts).
 */

const {
    headersMock,
    getImagesLiteMock,
    getClientIpMock,
    isRestoreMaintenanceActiveMock,
    incrementRateLimitMock,
    decrementRateLimitMock,
    checkRateLimitMock,
    dbSelectMock,
    trackAnalyticsDbWriteMock,
} = vi.hoisted(() => ({
    headersMock: vi.fn(),
    getImagesLiteMock: vi.fn(),
    getClientIpMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
    incrementRateLimitMock: vi.fn(),
    decrementRateLimitMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    dbSelectMock: vi.fn(),
    trackAnalyticsDbWriteMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

vi.mock('@/lib/data', () => ({
    getImagesLite: getImagesLiteMock,
    normalizeImageListCursor: () => null,
    searchImages: vi.fn(),
    getSmartCollectionBySlugCached: vi.fn(),
    getImagesForSmartCollection: vi.fn(),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

vi.mock('@/lib/analytics', () => ({
    isBot: () => false,
    lookupCountry: () => null,
    sanitizeReferrerHost: () => null,
}));

vi.mock('@/lib/background-db-writes', () => ({
    trackAnalyticsDbWrite: trackAnalyticsDbWriteMock,
}));

vi.mock('@/db', () => ({
    db: {
        select: dbSelectMock,
        insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    },
    images: { id: 'id', processed: 'processed' },
    imageViews: {},
    topicViews: {},
    sharedGroupViews: {},
    sharedGroups: {},
    sharedGroupImages: {},
    topics: {},
}));

vi.mock('@/lib/rate-limit', () => ({
    SEARCH_WINDOW_MS: 60_000,
    SEARCH_MAX_REQUESTS: 30,
    SEARCH_RATE_LIMIT_MAX_KEYS: 2_000,
    searchRateLimit: new Map(),
    getClientIp: getClientIpMock,
    checkRateLimit: checkRateLimitMock,
    incrementRateLimit: incrementRateLimitMock,
    decrementRateLimit: decrementRateLimitMock,
    pruneSearchRateLimit: vi.fn(),
    getRateLimitBucketStart: vi.fn().mockReturnValue(1_700_000_000),
    isRateLimitExceeded: (count: number, maxRequests: number, includesCurrentRequest = false) => (
        includesCurrentRequest ? count > maxRequests : count >= maxRequests
    ),
}));

import { loadMoreImages, recordPhotoView } from '@/app/actions/public';

const LOAD_MORE_MAX_REQUESTS = 120;
const VIEW_RECORD_MAX_REQUESTS = 120;

let ipCounter = 1;
function nextIp(): string {
    return `203.0.113.${ipCounter++}`;
}

function setupMocks(ip: string) {
    headersMock.mockResolvedValue(new Headers());
    getClientIpMock.mockReturnValue(ip);
    isRestoreMaintenanceActiveMock.mockReturnValue(false);
    getImagesLiteMock.mockResolvedValue([]);
    incrementRateLimitMock.mockResolvedValue(undefined);
    decrementRateLimitMock.mockResolvedValue(undefined);
    checkRateLimitMock.mockResolvedValue({ limited: false, count: 0 });
    trackAnalyticsDbWriteMock.mockResolvedValue(undefined);
    dbSelectMock.mockReturnValue({
        from: () => ({
            where: () => ({
                limit: async () => [{ id: 1 }],
            }),
        }),
    });
}

function clearRateLimitCallCounts() {
    incrementRateLimitMock.mockClear();
    decrementRateLimitMock.mockClear();
    checkRateLimitMock.mockClear();
}

describe('C1-01 saturated fast path — load_more', () => {
    it('rejects an over-limit caller without any persistent limiter work', async () => {
        const ip = nextIp();
        setupMocks(ip);

        // Saturate the in-memory bucket with the full admitted budget.
        for (let i = 0; i < LOAD_MORE_MAX_REQUESTS; i++) {
            const result = await loadMoreImages(undefined, undefined, 0, 30);
            expect(result.status).toBe('ok');
        }

        clearRateLimitCallCounts();

        // Saturated caller: rejected read-only, repeatedly.
        for (let i = 0; i < 3; i++) {
            const rejected = await loadMoreImages(undefined, undefined, 0, 30);
            expect(rejected.status).toBe('rateLimited');
        }
        expect(incrementRateLimitMock).not.toHaveBeenCalled();
        expect(checkRateLimitMock).not.toHaveBeenCalled();
        expect(decrementRateLimitMock).not.toHaveBeenCalled();
    });

    it('still admits and counts requests under the limit (accounting unchanged)', async () => {
        const ip = nextIp();
        setupMocks(ip);

        const result = await loadMoreImages(undefined, undefined, 0, 30);
        expect(result.status).toBe('ok');
        // An admitted request still performs the persistent increment + check.
        expect(incrementRateLimitMock).toHaveBeenCalled();
        expect(checkRateLimitMock).toHaveBeenCalled();
    });
});

describe('C1-01 saturated fast path — view_record', () => {
    it('rejects an over-limit caller without any persistent limiter work or DB reads', async () => {
        const ip = nextIp();
        setupMocks(ip);

        for (let i = 0; i < VIEW_RECORD_MAX_REQUESTS; i++) {
            await recordPhotoView(1);
        }

        clearRateLimitCallCounts();
        dbSelectMock.mockClear();

        for (let i = 0; i < 3; i++) {
            await recordPhotoView(1);
        }
        expect(incrementRateLimitMock).not.toHaveBeenCalled();
        expect(checkRateLimitMock).not.toHaveBeenCalled();
        expect(decrementRateLimitMock).not.toHaveBeenCalled();
        // The saturated fast path must return before the image-visibility SELECT.
        expect(dbSelectMock).not.toHaveBeenCalled();
    });
});
