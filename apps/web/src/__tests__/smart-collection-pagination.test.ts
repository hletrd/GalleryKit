import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * R4C5 COR-R4C5-01 / TEST-R4C5-06: smart-collection load-more pagination.
 *
 * Two bugs shipped together because this surface had ZERO coverage:
 *
 * 1. The load-more client always sends a keyset cursor object after the
 *    first page (home-client.tsx seeds `initialCursor`, load-more.tsx
 *    prefers `cursor ?? offset`). `loadMoreSmartCollectionImages` coerced
 *    that object through `Number(obj) → NaN → 0`, so EVERY load-more
 *    re-served page 1: duplicate grid rows, duplicate React keys, and an
 *    endless IntersectionObserver loop (hasMore stayed true at offset 0).
 *
 * 2. The action passed `safeLimit + 1` into a helper that applies its own
 *    +1 lookahead internally, then re-sliced — when exactly safeLimit + 1
 *    rows remained, `hasMore` came back false and the slice dropped the
 *    final row: collections sized ≡ 1 (mod 30) permanently hid their last
 *    photo.
 *
 * The behavioral cases pin the action contract with the same hoisted-mock
 * scaffold as public-actions.test.ts; the source-contract cases lock the
 * helper's cursor branch and single-lookahead shape in lib/data.ts.
 */

const {
    headersMock,
    getSmartCollectionBySlugCachedMock,
    getImagesForSmartCollectionMock,
    getClientIpMock,
    checkRateLimitMock,
    incrementRateLimitMock,
    decrementRateLimitMock,
    getRateLimitBucketStartMock,
    isRestoreMaintenanceActiveMock,
    searchRateLimit,
} = vi.hoisted(() => ({
    headersMock: vi.fn(),
    getSmartCollectionBySlugCachedMock: vi.fn(),
    getImagesForSmartCollectionMock: vi.fn(),
    getClientIpMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    incrementRateLimitMock: vi.fn(),
    decrementRateLimitMock: vi.fn(),
    getRateLimitBucketStartMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
    searchRateLimit: new Map<string, { count: number; resetAt: number }>(),
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

vi.mock('@/lib/data', () => ({
    getImagesLite: vi.fn(),
    searchImages: vi.fn(),
    getSmartCollectionBySlugCached: getSmartCollectionBySlugCachedMock,
    getImagesForSmartCollection: getImagesForSmartCollectionMock,
    // Mirrors the real normalizeImageListCursor contract (see
    // public-actions.test.ts for the same inline shape).
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
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    SEARCH_WINDOW_MS: 60_000,
    SEARCH_MAX_REQUESTS: 30,
    searchRateLimit,
    getClientIp: getClientIpMock,
    checkRateLimit: checkRateLimitMock,
    incrementRateLimit: incrementRateLimitMock,
    decrementRateLimit: decrementRateLimitMock,
    pruneSearchRateLimit: vi.fn(),
    getRateLimitBucketStart: getRateLimitBucketStartMock,
    isRateLimitExceeded: (count: number, maxRequests: number, includesCurrentRequest = false) => (
        includesCurrentRequest ? count > maxRequests : count >= maxRequests
    ),
}));

import { loadMoreSmartCollectionImages } from '@/app/actions/public';

const PUBLIC_COLLECTION = {
    id: 1,
    slug: 'street',
    name: 'Street',
    query_json: '{"type":"predicate","column":"iso","operator":"eq","value":100}',
    is_public: true,
    created_at: new Date('2026-01-01T00:00:00Z'),
};

let nextIp = 1;

describe('loadMoreSmartCollectionImages (R4C5 COR-R4C5-01)', () => {
    beforeEach(() => {
        headersMock.mockReset();
        getSmartCollectionBySlugCachedMock.mockReset();
        getImagesForSmartCollectionMock.mockReset();
        getClientIpMock.mockReset();
        checkRateLimitMock.mockReset();
        incrementRateLimitMock.mockReset();
        decrementRateLimitMock.mockReset();
        getRateLimitBucketStartMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReset();

        headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue(null) });
        // Fresh IP per test so the module-level in-memory load-more budget
        // never couples test cases.
        getClientIpMock.mockReturnValue(`203.0.113.${nextIp++}`);
        incrementRateLimitMock.mockResolvedValue(undefined);
        decrementRateLimitMock.mockResolvedValue(undefined);
        checkRateLimitMock.mockResolvedValue({ limited: false, count: 1 });
        getRateLimitBucketStartMock.mockReturnValue(1_700_000_000);
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        getSmartCollectionBySlugCachedMock.mockResolvedValue(PUBLIC_COLLECTION);
        getImagesForSmartCollectionMock.mockResolvedValue({ images: [{ id: 7 }], totalCount: 31, hasMore: false });
    });

    it('passes a validated keyset cursor through to the collection query (NOT offset 0)', async () => {
        const cursor = { id: 42, capture_date: '2026-04-29 10:00:00', created_at: '2026-04-29 10:01:00' };

        const result = await loadMoreSmartCollectionImages('street', cursor, 30);

        expect(result.status).toBe('ok');
        expect(getImagesForSmartCollectionMock).toHaveBeenCalledTimes(1);
        const [, limitArg, cursorArg] = getImagesForSmartCollectionMock.mock.calls[0];
        expect(limitArg).toBe(30);
        expect(cursorArg).toEqual({
            id: 42,
            capture_date: '2026-04-29 10:00:00',
            created_at: expect.any(Date),
        });
        // The historical bug: Number(cursorObject) → NaN → 0.
        expect(cursorArg).not.toBe(0);
    });

    it('fails closed on an unparseable object cursor instead of re-serving page 1', async () => {
        const result = await loadMoreSmartCollectionImages('street', { bogus: true } as never, 30);

        expect(result).toEqual({ status: 'invalid', images: [], hasMore: false });
        expect(getImagesForSmartCollectionMock).not.toHaveBeenCalled();
    });

    it('passes safeLimit (not safeLimit + 1) and returns helper rows + hasMore unsliced', async () => {
        // Exactly one full page returned with more remaining: the pre-fix
        // double-lookahead shape would have sliced a row away and/or
        // mislabeled hasMore at the limit+1 boundary.
        const fullPage = Array.from({ length: 30 }, (_, i) => ({ id: i + 1 }));
        getImagesForSmartCollectionMock.mockResolvedValue({ images: fullPage, totalCount: 31, hasMore: true });

        const result = await loadMoreSmartCollectionImages('street', 0, 30);

        expect(getImagesForSmartCollectionMock).toHaveBeenCalledWith(expect.anything(), 30, 0);
        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
            expect(result.images).toHaveLength(30);
            expect(result.hasMore).toBe(true);
        }
    });

    it('keeps the numeric offset path intact', async () => {
        const result = await loadMoreSmartCollectionImages('street', 60, 30);

        expect(result.status).toBe('ok');
        expect(getImagesForSmartCollectionMock).toHaveBeenCalledWith(expect.anything(), 30, 60);
    });

    it('rolls back the rate-limit claim and returns invalid for a private collection', async () => {
        getSmartCollectionBySlugCachedMock.mockResolvedValue({ ...PUBLIC_COLLECTION, is_public: false });

        const result = await loadMoreSmartCollectionImages('street', 0, 30);

        expect(result).toEqual({ status: 'invalid', images: [], hasMore: false });
        expect(getImagesForSmartCollectionMock).not.toHaveBeenCalled();
        expect(decrementRateLimitMock).toHaveBeenCalled();
    });
});

describe('getImagesForSmartCollection source contract (single lookahead + cursor branch)', () => {
    const dataSource = fs.readFileSync(
        path.join(__dirname, '..', 'lib', 'data.ts'),
        'utf8',
    );

    function extractFunction(name: string): string {
        const start = dataSource.indexOf(`export async function ${name}`);
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let seenBrace = false;
        for (let i = start; i < dataSource.length; i++) {
            const ch = dataSource[i];
            if (ch === '{') { depth++; seenBrace = true; }
            if (ch === '}') {
                depth--;
                if (seenBrace && depth === 0) return dataSource.slice(start, i + 1);
            }
        }
        throw new Error(`unbalanced braces extracting ${name}`);
    }

    const fn = extractFunction('getImagesForSmartCollection');

    it('normalizes the cursor input and applies buildCursorCondition on the cursor path', () => {
        expect(fn).toContain('normalizeImageListCursor(offsetOrCursor)');
        expect(fn).toContain('buildCursorCondition(normalizedCursor)');
    });

    it('keeps a SINGLE +1 lookahead (the helper owns it, callers must not add another)', () => {
        const lookaheads = fn.match(/normalizedPageSize \+ 1/g) ?? [];
        expect(lookaheads).toHaveLength(1);
    });

    it('skips .offset() on the cursor path (keyset pagination, no offset scan)', () => {
        expect(fn).toMatch(/normalizedCursor\s*\?\s*await limited\b/);
    });
});

describe('loadMoreSmartCollectionImages source contract (no double lookahead)', () => {
    const publicSource = fs.readFileSync(
        path.join(__dirname, '..', 'app', 'actions', 'public.ts'),
        'utf8',
    );

    it('never passes safeLimit + 1 into the collection helper', () => {
        expect(publicSource).not.toContain('getImagesForSmartCollection(compiledCondition, safeLimit + 1');
    });
});

describe('collections actions surface (R4C5 SEC-R4C5-02)', () => {
    const collectionsSource = fs.readFileSync(
        path.join(__dirname, '..', 'app', 'actions', 'collections.ts'),
        'utf8',
    );

    it('does not resurrect the dead unauthenticated getSmartCollections endpoint', () => {
        // Every export of a 'use server' file registers an invokable server
        // action. The removed getter returned ALL rows — including
        // is_public = false collections with their query_json ASTs — with
        // no isAdmin() gate and no rate limit. A future listing getter must
        // be auth-gated (admin) or is_public-filtered + query_json-omitting
        // (public); update this lock alongside that design.
        expect(collectionsSource).not.toMatch(/export\s+(async\s+)?function\s+getSmartCollections\b/);
        expect(collectionsSource).not.toMatch(/export\s+const\s+getSmartCollections\b/);
    });
});
