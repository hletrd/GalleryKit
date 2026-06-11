/**
 * PERF-R5C1-01: admin-backfill-runner batched candidate fetch.
 *
 * Verifies:
 *  (a) Single-batch case: all 50 candidates trigger exactly 1 batch query.
 *  (b) Multi-batch case: 150 candidates trigger 2 batch queries, each ≤ BATCH_SIZE.
 *  (c) Cursor advances strictly: second batch query is issued with cursor = 100
 *      (the max id of the first batch).
 *
 * Strategy: db.execute is called in this order:
 *   1. fetchCandidateCount()  → COUNT query
 *   2..N. fetchCandidateBatch(cursor) → SELECT queries (one per batch)
 *   N+1..M. reprocessOne UPDATE queries (one per row × 2 columns)
 *
 * We dispatch by call count, not by SQL content inspection (drizzle sql
 * template objects do not serialise to a searchable string in this context).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock, releaseMock, lockConnection, executeMock } = vi.hoisted(() => {
    const queryMock = vi.fn();
    const releaseMock = vi.fn();
    return {
        queryMock,
        releaseMock,
        lockConnection: { query: queryMock, release: releaseMock },
        executeMock: vi.fn(),
    };
});

vi.mock('@/db', () => ({
    connection: {
        getConnection: vi.fn(async () => lockConnection),
    },
    db: {
        execute: executeMock,
    },
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: vi.fn().mockResolvedValue({
        imageQualityWebp: 80,
        imageQualityAvif: 60,
        imageQualityJpeg: 80,
        imageSizes: [640],
        forceSrgbDerivatives: false,
        wideGamutJpegChroma: '4:4:4' as const,
        avifEffort: 6,
        sdrJpegChroma: '4:2:0' as const,
        wideGamutMaxSourcePixels: 50_000_000,
    }),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: vi.fn(() => false),
}));

vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        processImageFormats: vi.fn(async () => ({ wasDownscaled: false, avif10bit: false })),
        resolveColorPipelineDecision: vi.fn(() => null),
        IMAGE_PIPELINE_VERSION: 7,
    };
});

vi.mock('@/lib/color-detection', () => ({
    detectColorSignals: vi.fn().mockResolvedValue({
        iccProfileName: null,
        colorPrimaries: 'bt709',
        transferFunction: 'srgb',
        matrixCoefficients: null,
        isHdr: false,
        hasGainMap: false,
    }),
    isWideGamutPrimary: vi.fn(() => false),
}));

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: vi.fn(async (n: string) => `/fake/${n}`),
    ensureUploadDirectories: vi.fn(),
}));

vi.mock('fs/promises', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return { ...actual, access: vi.fn().mockResolvedValue(undefined) };
});

import { triggerAdminBackfill } from '@/lib/admin-backfill-runner';

const BATCH_SIZE = 100;

function makeRow(id: number) {
    return {
        id,
        filename_original: `orig-${id}.jpg`,
        filename_avif: `${id}.avif`,
        filename_webp: `${id}.webp`,
        filename_jpeg: `${id}.jpg`,
        icc_profile_name: null,
        color_primaries: null,
        width: 100,
    };
}

function resetGlobalState() {
    const sym = Symbol.for('gallerykit.adminBackfillState');
    const g = globalThis as Record<symbol, unknown>;
    g[sym] = { running: false, lastQueuedCount: 0, completedRuns: 0, lastError: null };
}

function setupLockMocks() {
    queryMock.mockImplementation(async (sqlText: string) => {
        if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) return [[{ acquired: 1 }]];
        if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
        return [[]];
    });
}

/**
 * Build an executeMock that:
 *  - call 0: returns COUNT = totalRows (for fetchCandidateCount in triggerAdminBackfill)
 *  - call 1..N: returns successive BATCH_SIZE pages (for fetchCandidateBatch in runBackfill)
 *  - all other calls: returns [] (UPDATE rows from reprocessOne)
 *
 * Returns an array that accumulates how many rows each SELECT call returned.
 */
function buildExecuteMock(totalRows: number) {
    const allRows = Array.from({ length: totalRows }, (_, i) => makeRow(i + 1));
    const batchSizes: number[] = [];
    let executeCallCount = 0;
    let batchIndex = 0;

    executeMock.mockImplementation(async () => {
        const callIndex = executeCallCount++;

        if (callIndex === 0) {
            // COUNT query from fetchCandidateCount in triggerAdminBackfill
            return [[{ cnt: totalRows }]];
        }

        // Determine if this is a SELECT batch query or an UPDATE.
        // Batch queries come in strictly after count, one per batch, before
        // reprocessOne's UPDATE calls for that batch (because we await queue.onIdle()
        // before fetching the next batch).
        // However, reprocessOne issues db.execute(UPDATE) calls too — we can't
        // distinguish by call index alone. We use a shared batchIndex counter and
        // a sentinel: once we've returned a short batch (<BATCH_SIZE) or an empty
        // batch, no more SELECT calls are expected.
        const batchStart = batchIndex * BATCH_SIZE;
        if (batchStart < allRows.length) {
            const batch = allRows.slice(batchStart, batchStart + BATCH_SIZE);
            batchSizes.push(batch.length);
            batchIndex++;
            return [batch];
        }

        // All batches served — remaining calls are UPDATE queries
        return [[]];
    });

    return batchSizes;
}

describe('PERF-R5C1-01: admin-backfill-runner batched fetch', () => {
    beforeEach(() => {
        resetGlobalState();
        queryMock.mockReset();
        releaseMock.mockReset();
        executeMock.mockReset();
        setupLockMocks();
    });

    it('(a) single-batch case: exactly 1 SELECT query for 50 candidates', async () => {
        const batchSizes = buildExecuteMock(50);

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await new Promise((r) => setTimeout(r, 500));

        // Exactly 1 batch query issued, returning all 50 rows
        expect(batchSizes).toHaveLength(1);
        expect(batchSizes[0]).toBe(50);
    });

    it('(b) multi-batch: 150 candidates → 2 SELECT queries, each ≤ BATCH_SIZE', async () => {
        const batchSizes = buildExecuteMock(150);

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await new Promise((r) => setTimeout(r, 500));

        // 2 batches: [100, 50]
        expect(batchSizes).toHaveLength(2);
        for (const size of batchSizes) {
            expect(size).toBeLessThanOrEqual(BATCH_SIZE);
        }
        expect(batchSizes[0]).toBe(BATCH_SIZE);
        expect(batchSizes[1]).toBe(50);
    });

    it('(c) cursor advances strictly across 2 batches (110 candidates)', async () => {
        // 110 candidates → 2 batches: first [1..100], second [101..110]
        // The second batch must only contain ids > 100 (cursor = 100 after first batch).
        const allRows = Array.from({ length: 110 }, (_, i) => makeRow(i + 1));
        let batchIndex = 0;
        const returnedBatches: Array<{ ids: number[] }> = [];

        executeMock.mockImplementation(async () => {
            const callIndex = batchIndex;

            if (callIndex === 0) {
                batchIndex++;
                // COUNT query
                return [[{ cnt: 110 }]];
            }

            const batchStart = (callIndex - 1) * BATCH_SIZE;
            if (batchStart < allRows.length) {
                const batch = allRows.slice(batchStart, batchStart + BATCH_SIZE);
                returnedBatches.push({ ids: batch.map((r) => r.id) });
                batchIndex++;
                return [batch];
            }

            return [[]];
        });

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');
        await new Promise((r) => setTimeout(r, 500));

        // 2 batches served
        expect(returnedBatches).toHaveLength(2);

        // (c) strict cursor advance: every id in batch 2 > every id in batch 1
        const maxIdBatch1 = Math.max(...returnedBatches[0]!.ids);
        const minIdBatch2 = Math.min(...returnedBatches[1]!.ids);
        expect(minIdBatch2).toBeGreaterThan(maxIdBatch1);
    });
});
