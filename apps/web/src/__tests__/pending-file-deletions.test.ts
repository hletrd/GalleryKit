import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    type Row = {
        id: number;
        image_id: number | null;
        filename_original: string;
        filename_webp: string;
        filename_avif: string;
        filename_jpeg: string;
    };

    const rows: Row[] = [];
    const selectLimit = vi.fn(async () => rows);
    const selectOrderBy = vi.fn(() => ({ limit: selectLimit }));
    const selectFrom = vi.fn(() => ({ orderBy: selectOrderBy }));
    const select = vi.fn(() => ({ from: selectFrom }));
    const deleteWhere = vi.fn(async () => undefined);
    const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
    const updateWhere = vi.fn(async () => undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    const deleteOriginalUploadFileStrict = vi.fn(async () => undefined);
    const deleteImageVariantsStrict = vi.fn(async () => undefined);
    const asc = vi.fn((column: unknown) => ({ kind: 'asc', column }));
    const eq = vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right }));
    const sql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }));

    return {
        rows,
        select,
        selectFrom,
        selectOrderBy,
        selectLimit,
        deleteFrom,
        deleteWhere,
        update,
        updateSet,
        updateWhere,
        deleteOriginalUploadFileStrict,
        deleteImageVariantsStrict,
        asc,
        eq,
        sql,
    };
});

vi.mock('drizzle-orm', () => ({
    asc: mocks.asc,
    eq: mocks.eq,
    sql: mocks.sql,
}));

vi.mock('@/db', () => ({
    db: {
        select: mocks.select,
        delete: mocks.deleteFrom,
        update: mocks.update,
    },
    pendingFileDeletions: {
        id: Symbol('pending_file_deletions.id'),
        image_id: Symbol('pending_file_deletions.image_id'),
        filename_original: Symbol('pending_file_deletions.filename_original'),
        filename_webp: Symbol('pending_file_deletions.filename_webp'),
        filename_avif: Symbol('pending_file_deletions.filename_avif'),
        filename_jpeg: Symbol('pending_file_deletions.filename_jpeg'),
        attempts: Symbol('pending_file_deletions.attempts'),
        last_error: Symbol('pending_file_deletions.last_error'),
        updated_at: Symbol('pending_file_deletions.updated_at'),
    },
}));

vi.mock('@/lib/process-image', () => ({
    deleteImageVariantsStrict: mocks.deleteImageVariantsStrict,
}));

vi.mock('@/lib/upload-paths', () => ({
    deleteOriginalUploadFileStrict: mocks.deleteOriginalUploadFileStrict,
    UPLOAD_DIR_AVIF: 'avif-dir',
    UPLOAD_DIR_JPEG: 'jpeg-dir',
    UPLOAD_DIR_WEBP: 'webp-dir',
}));

import { drainPendingFileDeletions, type PendingFileDeletionRecord } from '@/lib/pending-file-deletions';

function pendingDeletion(overrides: Partial<PendingFileDeletionRecord> = {}): PendingFileDeletionRecord {
    return {
        id: 7,
        image_id: 42,
        filename_original: 'original.jpg',
        filename_webp: 'image.webp',
        filename_avif: 'image.avif',
        filename_jpeg: 'image.jpeg',
        ...overrides,
    };
}

describe('pending file deletion drain', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        mocks.rows.splice(0, mocks.rows.length);
        vi.clearAllMocks();
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    it('removes pending rows once all filesystem cleanup retries succeed', async () => {
        mocks.rows.push(pendingDeletion());

        const result = await drainPendingFileDeletions();

        expect(result).toEqual({ attempted: 1, cleaned: 1, failed: 0 });
        expect(mocks.selectLimit).toHaveBeenCalledWith(25);
        expect(mocks.deleteOriginalUploadFileStrict).toHaveBeenCalledWith('original.jpg');
        expect(mocks.deleteImageVariantsStrict).toHaveBeenCalledWith('webp-dir', 'image.webp', []);
        expect(mocks.deleteImageVariantsStrict).toHaveBeenCalledWith('avif-dir', 'image.avif', []);
        expect(mocks.deleteImageVariantsStrict).toHaveBeenCalledWith('jpeg-dir', 'image.jpeg', []);
        expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('keeps failed rows and records the cleanup failure for a future retry', async () => {
        mocks.rows.push(pendingDeletion({ id: 8, image_id: null }));
        mocks.deleteOriginalUploadFileStrict.mockRejectedValue(new Error('permission denied'));

        const result = await drainPendingFileDeletions();

        expect(result).toEqual({ attempted: 1, cleaned: 0, failed: 1 });
        expect(mocks.deleteWhere).not.toHaveBeenCalled();
        expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
        expect(errorSpy).toHaveBeenCalledWith(
            'Pending file deletion retry failed',
            expect.objectContaining({
                pendingFileDeletionId: 8,
                imageId: null,
                failures: expect.arrayContaining([
                    expect.objectContaining({
                        target: 'original',
                        filename: 'original.jpg',
                        reason: 'permission denied',
                    }),
                ]),
            }),
        );
    });

    it('bounds each maintenance drain batch to avoid monopolizing the sweep', async () => {
        await drainPendingFileDeletions(500);

        expect(mocks.selectOrderBy).toHaveBeenCalledTimes(1);
        expect(mocks.selectLimit).toHaveBeenCalledWith(100);
        expect(mocks.deleteWhere).not.toHaveBeenCalled();
        expect(mocks.updateWhere).not.toHaveBeenCalled();
    });
});
