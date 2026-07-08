/**
 * AGG-C4-05 (run-9 c1 TE-1) — admin-backfill-runner deleted-mid-reencode
 * cleanup on the DETECTION-FAILURE branch.
 *
 * The sibling `admin-backfill-runner-deleted-mid-reencode.test.ts` pins the
 * delete-mid-reencode cleanup on the detection-SUCCESS branch (the `if (signals)`
 * UPDATE in admin-backfill-runner.ts, ~:556-576). But the runner has a SECOND
 * UPDATE — the detection-FAILED-but-encode-succeeded branch (~:594-608) — which
 * also guards `affectedRows===0 → cleanup`. That second guard was UNTESTED, so a
 * refactor dropping it would orphan derivatives on disk for a row deleted mid-
 * reencode whose detection ALSO failed, with a green suite.
 *
 * This test forces detection to FAIL (detectColorSignals throws) so the runner
 * reaches the derivative-only UPDATE, and forces that UPDATE to report
 * `affectedRows: 0` (row deleted mid-reencode). It then asserts:
 *   1. the just-written webp/avif/jpeg variants are cleaned up (all 3, with []
 *      sizes so the directory scan removes every variant), and
 *   2. the outcome is `deleted-mid-reencode` — NOT `detection-failed`, NOT a
 *      `pipeline_version` bump, and NOT counted as an encode/detection failure
 *      (the WITH-FAILURES banner stays down).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    queryMock,
    releaseMock,
    lockConnection,
    executeMock,
    processImageFormatsMock,
    deleteImageVariantsMock,
    detectColorSignalsMock,
} = vi.hoisted(() => {
    const queryMock = vi.fn();
    const releaseMock = vi.fn();
    return {
        queryMock,
        releaseMock,
        lockConnection: { query: queryMock, release: releaseMock },
        executeMock: vi.fn(),
        processImageFormatsMock: vi.fn(async () => ({ wasDownscaled: false, avif10bit: true })),
        deleteImageVariantsMock: vi.fn(
            async (_dir: string, _baseFilename: string, _sizes?: number[]) => undefined,
        ),
        // Detection FAILS — this is what pushes the runner into the
        // derivative-only (detection-failed) UPDATE branch.
        detectColorSignalsMock: vi.fn(async () => {
            throw new Error('synthetic detection failure');
        }),
    };
});

vi.mock('@/db', () => ({
    connection: {
        getConnection: vi.fn(async () => lockConnection),
    },
    db: {
        execute: executeMock,
    },
    POOL_CONNECTION_LIMIT: 10,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfigDetachedStrict: vi.fn(async () => ({
        imageQualityWebp: 80,
        imageQualityAvif: 60,
        imageQualityJpeg: 80,
        imageSizes: [640],
        forceSrgbDerivatives: false,
        wideGamutJpegChroma: '4:4:4' as const,
        avifEffort: 6,
        sdrJpegChroma: '4:2:0' as const,
        wideGamutMaxSourcePixels: 50_000_000,
    })),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: vi.fn(() => false),
}));

// Encode SUCCEEDS (so derivatives get written), but detection FAILS (mocked
// below to throw), so the runner reaches the detection-failed derivative-only
// UPDATE branch — the path whose affectedRows===0 cleanup guard this test pins.
vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        processImageFormats: processImageFormatsMock,
        deleteImageVariants: deleteImageVariantsMock,
        resolveColorPipelineDecision: vi.fn(() => 'srgb'),
        IMAGE_PIPELINE_VERSION: 7,
    };
});

vi.mock('@/lib/color-detection', () => ({
    detectColorSignals: detectColorSignalsMock,
}));

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: vi.fn(async (n: string) => n),
    UPLOAD_DIR_WEBP: '/uploads/webp',
    UPLOAD_DIR_AVIF: '/uploads/avif',
    UPLOAD_DIR_JPEG: '/uploads/jpeg',
}));

vi.mock('sharp', () => {
    const fakeSharp = () => ({
        metadata: async () => ({ width: 100, height: 100, depth: 'uchar' }),
    });
    fakeSharp.concurrency = () => 1;
    fakeSharp.cache = () => undefined;
    return { default: fakeSharp };
});

vi.mock('fs/promises', async (importOriginal) => {
    const actual = (await importOriginal()) as Record<string, unknown>;
    return {
        ...actual,
        default: {
            ...(actual.default as object),
            access: vi.fn(async () => undefined),
        },
        access: vi.fn(async () => undefined),
    };
});

import { triggerAdminBackfill, readAdminBackfillState } from '@/lib/admin-backfill-runner';

let rowExistsAfterUpdate = false;

function staticSqlText(arg: unknown): string {
    const chunks = (arg as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks;
    if (!Array.isArray(chunks)) return '';
    let out = '';
    for (const c of chunks) {
        const v = c?.value;
        if (Array.isArray(v)) out += v.join('');
    }
    return out;
}

function expectImageUpdateBumpsUpdatedAt() {
    const updateTexts = executeMock.mock.calls
        .map(([arg]) => staticSqlText(arg))
        .filter((text) => text.includes('UPDATE images SET'));
    expect(updateTexts.some((text) => /updated_at\s*=\s*CURRENT_TIMESTAMP/.test(text))).toBe(true);
}

describe('AGG-C4-05: backfill cleans up orphaned variants on delete-mid-reencode in the DETECTION-FAILURE branch', () => {
    beforeEach(() => {
        const sym = Symbol.for('gallerykit.adminBackfillState');
        const g = globalThis as Record<symbol, unknown>;
        g[sym] = { running: false, lastQueuedCount: 0, completedRuns: 0, lastError: null };

        queryMock.mockReset();
        releaseMock.mockReset();
        executeMock.mockReset();
        processImageFormatsMock.mockClear();
        deleteImageVariantsMock.mockClear();
        detectColorSignalsMock.mockClear();
        rowExistsAfterUpdate = false;

        queryMock.mockImplementation(async (sqlText: string) => {
            if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        });

        // SELECT → one candidate row; the derivative-only UPDATE (detection
        // failed) → affectedRows 0 (row deleted mid-re-encode).
        executeMock.mockImplementation(async (arg: unknown) => {
            const text = staticSqlText(arg);
            if (text.includes('SELECT id FROM images WHERE id')) {
                return [rowExistsAfterUpdate ? [{ id: 1 }] : []];
            }
            if (text.includes('SELECT')) {
                return [
                    [
                        {
                            id: 1,
                            filename_original: 'original-1.jpg',
                            filename_avif: 'a.avif',
                            filename_webp: 'a.webp',
                            filename_jpeg: 'a.jpg',
                            icc_profile_name: null,
                            color_primaries: null,
                            width: 100,
                        },
                    ],
                ];
            }
            // Any UPDATE matches 0 rows → row was deleted during re-encode.
            return [{ affectedRows: 0 }];
        });
    });

    it('deletes the freshly-written variants on the detection-failure path and reports deleted-mid-reencode', async () => {
        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');

        await vi.waitFor(
            () => {
                if (readAdminBackfillState().running) {
                    throw new Error('backfill runner still draining');
                }
            },
            { timeout: 20_000, interval: 25 },
        );

        // We genuinely traversed the detection-failure branch.
        expect(processImageFormatsMock).toHaveBeenCalled();
        expect(detectColorSignalsMock).toHaveBeenCalled();

        // CONTRACT: the orphaned derivatives were cleaned up for all 3 formats.
        const cleanedDirs = deleteImageVariantsMock.mock.calls.map((c) => c[0]);
        expect(cleanedDirs).toContain('/uploads/webp');
        expect(cleanedDirs).toContain('/uploads/avif');
        expect(cleanedDirs).toContain('/uploads/jpeg');
        // Cleanup must pass [] sizes so the directory scan removes ALL variants.
        for (const call of deleteImageVariantsMock.mock.calls) {
            expect(call[2]).toEqual([]);
        }

        const state = readAdminBackfillState();
        // deleted-mid-reencode wins over detection-failed: the row is gone, so
        // a detection retry is moot. NOT processed, NOT a failure.
        expect(state.deletedMidReencode).toBe(1);
        expect(state.processed).toBe(0);
        expect(state.encodeFailures).toBe(0);
        // The detection threw, but because the row was deleted mid-reencode the
        // outcome is deleted-mid-reencode (not detection-failed), so the
        // detection-failure counter must NOT increment.
        expect(state.detectionFailures).toBe(0);
        expect(state.errors).toBe(0);
        // deleted-mid-reencode must NOT flip the WITH-FAILURES banner.
        expect(state.lastRunHadFailures).toBe(false);
        expect(state.running).toBe(false);
        expectImageUpdateBumpsUpdatedAt();
    });

    it('keeps same-value derivative-only UPDATE results as detection failures when the row still exists', async () => {
        rowExistsAfterUpdate = true;

        const result = await triggerAdminBackfill();
        expect(result.status).toBe('queued');

        await vi.waitFor(
            () => {
                if (readAdminBackfillState().running) {
                    throw new Error('backfill runner still draining');
                }
            },
            { timeout: 20_000, interval: 25 },
        );

        expect(processImageFormatsMock).toHaveBeenCalled();
        expect(detectColorSignalsMock).toHaveBeenCalled();
        expect(deleteImageVariantsMock).not.toHaveBeenCalled();

        const state = readAdminBackfillState();
        expect(state.deletedMidReencode).toBe(0);
        expect(state.processed).toBe(0);
        expect(state.detectionFailures).toBe(1);
        expect(state.errors).toBe(0);
        expect(state.lastRunHadFailures).toBe(true);
        expect(state.running).toBe(false);
        expectImageUpdateBumpsUpdatedAt();
    });
});
