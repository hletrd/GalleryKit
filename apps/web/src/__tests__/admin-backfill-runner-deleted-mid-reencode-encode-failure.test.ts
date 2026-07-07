/**
 * Cycle 46 C46-F1: encode-failure rollback can restore backed-up derivative
 * files after a row was deleted mid-backfill. The runner must re-check row
 * existence in the encode-failure catch path and clean variants if the row is
 * gone, instead of counting it as an operator-facing encode failure.
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
        processImageFormatsMock: vi.fn(),
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
    getGalleryConfigDetached: vi.fn(async () => ({
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

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: vi.fn(async (n: string) => n),
    UPLOAD_DIR_WEBP: '/uploads/webp',
    UPLOAD_DIR_AVIF: '/uploads/avif',
    UPLOAD_DIR_JPEG: '/uploads/jpeg',
}));

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

describe('C46-F1: admin backfill cleans rollback-restored variants after encode failure on a deleted row', () => {
    beforeEach(() => {
        const sym = Symbol.for('gallerykit.adminBackfillState');
        const g = globalThis as Record<symbol, unknown>;
        g[sym] = { running: false, lastQueuedCount: 0, completedRuns: 0, lastError: null };

        queryMock.mockReset();
        releaseMock.mockReset();
        executeMock.mockReset();
        deleteImageVariantsMock.mockClear();
        processImageFormatsMock.mockReset();
        processImageFormatsMock.mockRejectedValue(new Error('encode failed after rollback'));

        queryMock.mockImplementation(async (sqlText: string) => {
            if (typeof sqlText === 'string' && sqlText.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (typeof sqlText === 'string' && sqlText.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        });

        executeMock.mockImplementation(async (arg: unknown) => {
            const text = staticSqlText(arg);
            if (text.includes('SELECT id FROM images WHERE id')) {
                return [[]];
            }
            if (text.includes('SELECT')) {
                return [
                    [
                        {
                            id: 1,
                            filename_original: 'original-1.jpg',
                            filename_avif: 'deleted-row.avif',
                            filename_webp: 'deleted-row.webp',
                            filename_jpeg: 'deleted-row.jpg',
                            icc_profile_name: null,
                            color_primaries: null,
                            width: 100,
                        },
                    ],
                ];
            }
            return [{ affectedRows: 0 }];
        });
    });

    it('classifies the row as deleted-mid-reencode and does not count encode failure', async () => {
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
        expect(deleteImageVariantsMock).toHaveBeenCalledTimes(3);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith('/uploads/webp', 'deleted-row.webp', []);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith('/uploads/avif', 'deleted-row.avif', []);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith('/uploads/jpeg', 'deleted-row.jpg', []);

        const state = readAdminBackfillState();
        expect(state.deletedMidReencode).toBe(1);
        expect(state.encodeFailures).toBe(0);
        expect(state.lastRunHadFailures).toBe(false);
        expect(state.lastError).toBeNull();
    });
});
