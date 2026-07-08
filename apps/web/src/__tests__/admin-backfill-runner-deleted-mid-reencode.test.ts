/**
 * AGG-R8c3-03 (run-8 c3) — admin-backfill-runner deleted-mid-reencode cleanup.
 *
 * Contract under test: the backfill runner acquires the per-image processing
 * advisory lock for its whole re-encode window, but `deleteImage` does NOT
 * hold that lock. So a delete that races an active backfill re-encode of the
 * SAME image id unlinks the old derivatives mid-encode, then the backfill's
 * `processImageFormats` re-materializes fresh derivatives — orphaning them for
 * a row that no longer exists.
 *
 * The fix mirrors the upload queue worker (image-queue.ts: affectedRows===0 →
 * cleanup): when the version-bump UPDATE matches 0 rows, the runner must
 *   1. delete the just-written webp/avif/jpeg variants, and
 *   2. return outcome `deleted-mid-reencode` — NOT a `pipeline_version` bump
 *      and NOT counted as `encode-failed` (the counter partition stays exact).
 *
 * This test forces the UPDATE to report `affectedRows: 0` and asserts the
 * variant cleanup fired for all three formats and the run is NOT flagged as
 * having failures.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    queryMock,
    releaseMock,
    lockConnection,
    executeMock,
    processImageFormatsMock,
    deleteImageVariantsMock,
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

// Encode succeeds AND detection succeeds, so the runner reaches the
// version-bump UPDATE (the `if (signals)` branch) — the path where the
// deleted-mid-reencode race orphans files.
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
    detectColorSignals: vi.fn(async () => ({
        iccProfileName: null,
        colorPrimaries: 'bt709',
        transferFunction: 'srgb',
        matrixCoefficients: 'identity',
        isHdr: false,
        hasGainMap: false,
    })),
}));

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: vi.fn(async (n: string) => n),
    UPLOAD_DIR_WEBP: '/uploads/webp',
    UPLOAD_DIR_AVIF: '/uploads/avif',
    UPLOAD_DIR_JPEG: '/uploads/jpeg',
}));

// fs.access resolves so reprocessOne proceeds past the existence check. We do
// NOT mock sharp; the real `sharp(fakePath).metadata()` would throw, but
// detectColorSignals is mocked to succeed and the encode is mocked — the only
// real call is `sharp(originalPath).metadata()` inside the detection block.
// Mock it minimally by making detectColorSignals own the result (above) and
// stubbing the sharp metadata via the fs path being irrelevant. To be safe we
// also mock sharp's metadata indirectly: the runner calls
// `sharp(originalPath,...).metadata()` ONLY to feed detectColorSignals, which
// is mocked — but the sharp() call itself must not throw synchronously. The
// real sharp() constructor does not throw on a non-existent path (it defers to
// .metadata()), and .metadata() rejects async — which would land us in the
// detection-failure branch, NOT the success branch we want. So we mock sharp.
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

describe('AGG-R8c3-03: backfill cleans up orphaned variants on delete-mid-reencode', () => {
    beforeEach(() => {
        const sym = Symbol.for('gallerykit.adminBackfillState');
        const g = globalThis as Record<symbol, unknown>;
        g[sym] = { running: false, lastQueuedCount: 0, completedRuns: 0, lastError: null };

        queryMock.mockReset();
        releaseMock.mockReset();
        executeMock.mockReset();
        processImageFormatsMock.mockClear();
        deleteImageVariantsMock.mockClear();
        rowExistsAfterUpdate = false;

        queryMock.mockImplementation(async (sqlText: string) => {
            if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        });

        // SELECT → one candidate row; the version-bump UPDATE → affectedRows 0
        // (simulating the row being deleted mid-re-encode).
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
            // UPDATE matches 0 rows → row was deleted during re-encode.
            return [{ affectedRows: 0 }];
        });
    });

    it('deletes the freshly-written variants and does NOT flag the run as failed', async () => {
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

        // The re-encode ran (we are genuinely on the post-encode UPDATE path).
        expect(processImageFormatsMock).toHaveBeenCalled();

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
        // The row counts as deleted-mid-reencode, not processed, not a failure.
        expect(state.deletedMidReencode).toBe(1);
        expect(state.processed).toBe(0);
        expect(state.encodeFailures).toBe(0);
        expect(state.detectionFailures).toBe(0);
        expect(state.errors).toBe(0);
        // deleted-mid-reencode must NOT flip the WITH-FAILURES banner.
        expect(state.lastRunHadFailures).toBe(false);
        expect(state.running).toBe(false);
        expectImageUpdateBumpsUpdatedAt();
    });

    it('does not delete variants when a same-value UPDATE reports 0 changed rows for a live row', async () => {
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
        expect(deleteImageVariantsMock).not.toHaveBeenCalled();

        const state = readAdminBackfillState();
        expect(state.deletedMidReencode).toBe(0);
        expect(state.processed).toBe(1);
        expect(state.errors).toBe(0);
        expect(state.lastRunHadFailures).toBe(false);
        expect(state.running).toBe(false);
        expectImageUpdateBumpsUpdatedAt();
    });
});
