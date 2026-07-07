/**
 * C2-02 (run-10 c2, TRC-01): the 8 unfenced byte-impacting settings (every
 * DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS entry except image_sizes, which is
 * hard-locked once any image exists) have no admission fence — an admin can
 * change encoder quality/gamut settings even with photos already on disk.
 * `updateGallerySettings` now returns `requiresBackfill: true` when such a
 * key's value actually changes (verified against a fresh DB read, not just
 * the caller's own diff) AND at least one image has already been processed.
 *
 * These tests pin that contract independently of the client-side warning
 * banner (see settings-backfill-warning.test.ts / -source.test.ts), which
 * only reasons from a page-load `hasExistingImages` prop that can go stale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    transactionMock,
    txInsertMock,
    txInsertValuesMock,
    txOnDuplicateKeyUpdateMock,
    txDeleteMock,
    txDeleteWhereMock,
    dbSelectMock,
    selectLimitResults,
    selectWhereResults,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    revalidateAllAppDataMock,
    logAuditEventMock,
    maintenanceMessageMock,
    requireSameOriginAdminMock,
    hasActiveUploadClaimsMock,
    acquireUploadProcessingContractLockMock,
    getConnectionMock,
} = vi.hoisted(() => {
    // Two queues model the two chain shapes the action actually issues:
    // `.where(...).limit(1)` (single-row lookups) and a bare `.where(...)`
    // await with no further `.limit()` (the requiresBackfill inArray fetch).
    // A real Drizzle query builder is thenable at every step, so `.where()`
    // must resolve on its own AND still expose `.limit()` for chains that
    // want a single row.
    const selectLimitResults: Array<unknown[]> = [];
    const selectWhereResults: Array<unknown[]> = [];
    const dbSelectMock = vi.fn(() => ({
        from: vi.fn(() => ({
            where: vi.fn(() => {
                const limit = vi.fn(() => Promise.resolve(selectLimitResults.shift() ?? []));
                const wherePromise = Promise.resolve(selectWhereResults.shift() ?? []) as Promise<unknown[]> & { limit: typeof limit };
                wherePromise.limit = limit;
                return wherePromise;
            }),
            limit: vi.fn(() => Promise.resolve(selectLimitResults.shift() ?? [])),
        })),
    }));

    return {
        transactionMock: vi.fn(),
        txInsertMock: vi.fn(),
        txInsertValuesMock: vi.fn(),
        txOnDuplicateKeyUpdateMock: vi.fn(),
        txDeleteMock: vi.fn(),
        txDeleteWhereMock: vi.fn(),
        dbSelectMock,
        selectLimitResults,
        selectWhereResults,
        isAdminMock: vi.fn(),
        getCurrentUserMock: vi.fn(),
        getTranslationsMock: vi.fn(),
        revalidateAllAppDataMock: vi.fn(),
        logAuditEventMock: vi.fn(),
        maintenanceMessageMock: vi.fn(),
        requireSameOriginAdminMock: vi.fn(),
        hasActiveUploadClaimsMock: vi.fn(),
        acquireUploadProcessingContractLockMock: vi.fn(),
        getConnectionMock: vi.fn(),
    };
});

vi.mock('@/db', () => ({
    db: {
        transaction: transactionMock,
        select: dbSelectMock,
        insert: vi.fn(),
        delete: vi.fn(),
    },
    connection: {
        getConnection: getConnectionMock,
    },
    adminSettings: {
        key: 'admin_settings.key',
        value: 'admin_settings.value',
    },
    images: {
        id: 'images.id',
        processed: 'images.processed',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field: unknown, value: unknown) => ({ field, value })),
    inArray: vi.fn((field: unknown, values: unknown[]) => ({ field, values })),
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: getCurrentUserMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateAllAppData: revalidateAllAppDataMock,
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: requireSameOriginAdminMock,
}));

vi.mock('@/lib/upload-tracker-state', () => ({
    hasActiveUploadClaims: hasActiveUploadClaimsMock,
}));

vi.mock('@/lib/upload-processing-contract-lock', () => ({
    acquireUploadProcessingContractLock: acquireUploadProcessingContractLockMock,
}));

import { updateGallerySettings } from '@/app/actions/settings';

function makeColorBackfillLockConnection(acquired: number) {
    const conn = {
        query: vi.fn(async (sql: string) => {
            if (sql.includes('GET_LOCK')) return [[{ acquired }]];
            if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        }),
        release: vi.fn(),
        destroy: vi.fn(),
    };
    return conn;
}

describe('updateGallerySettings requiresBackfill (C2-02 run-10 c2)', () => {
    let persistedRows: Array<{ key: string; value: string }>;
    let releaseUploadContractLockMock: ReturnType<typeof vi.fn>;
    let colorBackfillLockConn: ReturnType<typeof makeColorBackfillLockConnection>;

    beforeEach(() => {
        persistedRows = [];
        selectLimitResults.length = 0;
        selectWhereResults.length = 0;
        vi.clearAllMocks();
        colorBackfillLockConn = makeColorBackfillLockConnection(1);
        getConnectionMock.mockResolvedValue(colorBackfillLockConn);
        releaseUploadContractLockMock = vi.fn().mockResolvedValue(undefined);
        getTranslationsMock.mockResolvedValue((key: string) => key);
        maintenanceMessageMock.mockReturnValue(null);
        requireSameOriginAdminMock.mockResolvedValue(null);
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 7 });
        logAuditEventMock.mockResolvedValue(undefined);
        revalidateAllAppDataMock.mockReset();
        hasActiveUploadClaimsMock.mockReturnValue(false);
        acquireUploadProcessingContractLockMock.mockResolvedValue({ release: releaseUploadContractLockMock });
        txOnDuplicateKeyUpdateMock.mockResolvedValue(undefined);
        txInsertValuesMock.mockImplementation((row: { key: string; value: string }) => {
            persistedRows.push(row);
            return { onDuplicateKeyUpdate: txOnDuplicateKeyUpdateMock };
        });
        txInsertMock.mockReturnValue({ values: txInsertValuesMock });
        txDeleteWhereMock.mockResolvedValue(undefined);
        txDeleteMock.mockReturnValue({ where: txDeleteWhereMock });
        transactionMock.mockImplementation(async (callback: (tx: {
            insert: typeof txInsertMock;
            delete: typeof txDeleteMock;
        }) => unknown) => callback({
            insert: txInsertMock,
            delete: txDeleteMock,
        }));
    });

    it('reports requiresBackfill=true when a changed quality key meets an existing processed image', async () => {
        // Bare-where fetch: current image_quality_avif is the default (85), no stored row.
        selectWhereResults.push([]);
        // .limit(1) processed-image existence check: one processed row found.
        selectLimitResults.push([{ id: 11 }]);

        await expect(updateGallerySettings({ image_quality_avif: '70' })).resolves.toEqual({
            success: true,
            settings: { image_quality_avif: '70' },
            requiresBackfill: true,
        });

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(persistedRows).toEqual([{ key: 'image_quality_avif', value: '70' }]);
        expect(colorBackfillLockConn.query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', ['gallerykit_color_pipeline_backfill']);
        expect(colorBackfillLockConn.release).toHaveBeenCalledTimes(1);
    });

    it('reports requiresBackfill=false when a changed quality key has zero images', async () => {
        selectWhereResults.push([]);
        // .limit(1) processed-image check: no rows.
        selectLimitResults.push([]);

        await expect(updateGallerySettings({ image_quality_avif: '70' })).resolves.toEqual({
            success: true,
            settings: { image_quality_avif: '70' },
            requiresBackfill: false,
        });

        expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('reports requiresBackfill=false when the requested value matches the stored value', async () => {
        // Current stored value for avif_effort already equals the requested one,
        // so hasBackfillRelevantDifference is false and the processed-image
        // check must never even run.
        selectWhereResults.push([{ key: 'avif_effort', value: '6' }]);

        await expect(updateGallerySettings({ avif_effort: '6' })).resolves.toEqual({
            success: true,
            settings: { avif_effort: '6' },
            requiresBackfill: false,
        });

        // Only the bare-where diff fetch ran; the processed-image .limit(1)
        // check was never reached, so selectLimitResults stays fully unconsumed.
        expect(selectLimitResults).toHaveLength(0);
        expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('rejects a byte-impacting settings change while color backfill holds the coordination lock', async () => {
        colorBackfillLockConn = makeColorBackfillLockConnection(0);
        getConnectionMock.mockResolvedValue(colorBackfillLockConn);
        selectWhereResults.push([]);
        selectLimitResults.push([{ id: 11 }]);

        await expect(updateGallerySettings({ image_quality_avif: '70' })).resolves.toEqual({
            error: 'colorBackfillSettingsLocked',
        });

        expect(transactionMock).not.toHaveBeenCalled();
        expect(colorBackfillLockConn.query).toHaveBeenCalledTimes(1);
        expect(colorBackfillLockConn.release).toHaveBeenCalledTimes(1);
    });

    it('releases the color backfill coordination lock when persistence fails after acquisition', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        selectWhereResults.push([]);
        selectLimitResults.push([{ id: 11 }]);
        transactionMock.mockRejectedValueOnce(new Error('deadlock'));

        await expect(updateGallerySettings({ image_quality_avif: '70' })).resolves.toEqual({
            error: 'failedToUpdateGallerySettings',
        });

        expect(colorBackfillLockConn.query).toHaveBeenCalledWith('SELECT RELEASE_LOCK(?)', ['gallerykit_color_pipeline_backfill']);
        expect(colorBackfillLockConn.release).toHaveBeenCalledTimes(1);
        errorSpy.mockRestore();
    });

    it('reports requiresBackfill=false for a non-byte-impacting change even with existing images', async () => {
        // slideshow_interval_seconds is not in SETTINGS_BACKFILL_WARNING_KEYS,
        // so no diff/existence queries should run at all.
        await expect(updateGallerySettings({ slideshow_interval_seconds: '10' })).resolves.toEqual({
            success: true,
            settings: { slideshow_interval_seconds: '10' },
            requiresBackfill: false,
        });

        expect(selectWhereResults).toHaveLength(0);
        expect(selectLimitResults).toHaveLength(0);
        expect(transactionMock).toHaveBeenCalledTimes(1);
    });

    it('keeps the image_sizes contract fence intact alongside a changed quality key', async () => {
        // Order of DB reads inside updateGallerySettings: image_sizes current
        // value lookup (.where().limit(1)), then the existingImage lock check
        // (.limit(1) only) — both fenced-key checks happen BEFORE the
        // requiresBackfill diff, and the imageSizesLocked error short-circuits
        // before that diff ever runs.
        selectLimitResults.push([{ value: '640,1536' }], [{ id: 42 }]);

        await expect(updateGallerySettings({
            image_sizes: '640,2048',
            image_quality_avif: '70',
        })).resolves.toEqual({
            error: 'imageSizesLocked',
        });

        expect(transactionMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
    });

    it('keeps the strip_gps_on_upload contract fence intact alongside a changed quality key', async () => {
        selectLimitResults.push([{ value: 'false' }], [{ id: 42 }]);

        await expect(updateGallerySettings({
            strip_gps_on_upload: 'true',
            image_quality_avif: '70',
        })).resolves.toEqual({
            error: 'uploadSettingsLocked',
        });

        expect(transactionMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
    });
});
