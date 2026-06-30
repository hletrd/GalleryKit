/**
 * Cycle 46 C46-F1: sidecar backfill encode failures must not leave rollback-
 * restored derivatives behind when the row was deleted mid-reencode.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { processImageFormatsMock, deleteImageVariantsMock } = vi.hoisted(() => ({
    processImageFormatsMock: vi.fn(),
    deleteImageVariantsMock: vi.fn(
        async (_dir: string, _baseFilename: string, _sizes?: number[]) => undefined,
    ),
}));

vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/process-image')>();
    return {
        ...actual,
        processImageFormats: processImageFormatsMock,
        deleteImageVariants: deleteImageVariantsMock,
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
        access: vi.fn(async () => undefined),
        default: {
            ...(actual.default as object),
            access: vi.fn(async () => undefined),
        },
    };
});

import { reprocessRow, type ImageRow } from '../../scripts/backfill-color-pipeline';

describe('C46-F1: sidecar reprocessRow cleans rollback-restored variants after encode failure on a deleted row', () => {
    const row: ImageRow = {
        id: 46,
        filename_original: 'original.jpg',
        filename_avif: 'deleted-row.avif',
        filename_webp: 'deleted-row.webp',
        filename_jpeg: 'deleted-row.jpeg',
        icc_profile_name: null,
        color_primaries: null,
        width: 100,
    };

    beforeEach(() => {
        processImageFormatsMock.mockReset();
        processImageFormatsMock.mockRejectedValue(new Error('encode failed after rollback'));
        deleteImageVariantsMock.mockClear();
    });

    it('returns deleted-mid-reencode and cleans all derivative formats with directory scan', async () => {
        const outcome = await reprocessRow(row, undefined, async () => false);

        expect(outcome.outcome).toBe('deleted-mid-reencode');
        expect(deleteImageVariantsMock).toHaveBeenCalledTimes(3);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith('/uploads/webp', 'deleted-row.webp', []);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith('/uploads/avif', 'deleted-row.avif', []);
        expect(deleteImageVariantsMock).toHaveBeenCalledWith('/uploads/jpeg', 'deleted-row.jpeg', []);
    });

    it('preserves encode-failed behavior when the row still exists', async () => {
        const outcome = await reprocessRow(row, undefined, async () => true);

        expect(outcome.outcome).toBe('error');
        expect(deleteImageVariantsMock).not.toHaveBeenCalled();
    });
});
