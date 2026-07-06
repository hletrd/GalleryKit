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
} = vi.hoisted(() => {
    const selectLimitResults: Array<unknown[]> = [];
    // C2-02 (run-10 c2): a bare `.where(...)` awaited WITHOUT a further
    // `.limit()` call (used by the requiresBackfill diff's inArray fetch)
    // must resolve on its own — real Drizzle query builders are thenable at
    // every step. Model that by returning a promise that ALSO exposes
    // `.limit()` for chains that still want a single row.
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
    };
});

vi.mock('@/db', () => ({
    db: {
        transaction: transactionMock,
        select: dbSelectMock,
        insert: vi.fn(),
        delete: vi.fn(),
    },
    adminSettings: {
        key: 'admin_settings.key',
        value: 'admin_settings.value',
    },
    images: {
        id: 'images.id',
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

describe('updateGallerySettings semantic_search_mode', () => {
    let persistedRows: Array<{ key: string; value: string }>;
    let releaseUploadContractLockMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        persistedRows = [];
        selectLimitResults.length = 0;
        selectWhereResults.length = 0;
        vi.clearAllMocks();
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

    it('rejects production writes from the Settings action before persistence', async () => {
        await expect(updateGallerySettings({ semantic_search_mode: 'production' })).resolves.toEqual({
            error: 'semanticSearchProductionUiUnsupported',
        });

        expect(transactionMock).not.toHaveBeenCalled();
        expect(txInsertMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it.each(['disabled', 'stub'] as const)('persists the UI-supported %s mode', async (mode) => {
        await expect(updateGallerySettings({ semantic_search_mode: mode })).resolves.toEqual({
            success: true,
            settings: { semantic_search_mode: mode },
            requiresBackfill: false,
        });

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(persistedRows).toEqual([{ key: 'semantic_search_mode', value: mode }]);
        expect(txOnDuplicateKeyUpdateMock).toHaveBeenCalledTimes(1);
        expect(revalidateAllAppDataMock).toHaveBeenCalledTimes(1);
        expect(logAuditEventMock).toHaveBeenCalledTimes(1);
    });

    it('canonicalizes scalar setting values before persistence', async () => {
        await expect(updateGallerySettings({ image_quality_jpeg: ' 95 ' })).resolves.toEqual({
            success: true,
            settings: { image_quality_jpeg: '95' },
            // No stored current value and no processed image row in this fixture,
            // so the fresh diff detects a change but there is nothing to re-encode.
            requiresBackfill: false,
        });

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(persistedRows).toEqual([{ key: 'image_quality_jpeg', value: '95' }]);
        expect(txOnDuplicateKeyUpdateMock).toHaveBeenCalledTimes(1);
        expect(revalidateAllAppDataMock).toHaveBeenCalledTimes(1);
        expect(logAuditEventMock).toHaveBeenCalledTimes(1);
    });

    it('ignores semantically unchanged image sizes before active-upload checks', async () => {
        selectLimitResults.push([{ value: '640,1536' }]);
        hasActiveUploadClaimsMock.mockReturnValue(true);

        await expect(updateGallerySettings({ image_sizes: '1536, 640' })).resolves.toEqual({
            success: true,
            settings: {},
            requiresBackfill: false,
        });

        expect(hasActiveUploadClaimsMock).not.toHaveBeenCalled();
        expect(acquireUploadProcessingContractLockMock).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it('keeps changed image sizes locked once any image row exists', async () => {
        selectLimitResults.push([{ value: '640,1536' }], [{ id: 42 }]);

        await expect(updateGallerySettings({ image_sizes: '640,2048' })).resolves.toEqual({
            error: 'imageSizesLocked',
        });

        expect(hasActiveUploadClaimsMock).toHaveBeenCalledTimes(1);
        expect(acquireUploadProcessingContractLockMock).toHaveBeenCalledTimes(1);
        expect(releaseUploadContractLockMock).toHaveBeenCalledTimes(1);
        expect(transactionMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
    });

    it('ignores semantically unchanged strip-gps payloads before active-upload checks', async () => {
        selectLimitResults.push([{ value: 'false' }]);
        hasActiveUploadClaimsMock.mockReturnValue(true);

        await expect(updateGallerySettings({ strip_gps_on_upload: 'false' })).resolves.toEqual({
            success: true,
            settings: {},
            requiresBackfill: false,
        });

        expect(hasActiveUploadClaimsMock).not.toHaveBeenCalled();
        expect(acquireUploadProcessingContractLockMock).not.toHaveBeenCalled();
        expect(transactionMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it.each([
        { current: 'false', requested: 'true' },
        { current: 'true', requested: 'false' },
    ])('keeps changed strip-gps locked once any image row exists ($current -> $requested)', async ({ current, requested }) => {
        selectLimitResults.push([{ value: current }], [{ id: 42 }]);

        await expect(updateGallerySettings({ strip_gps_on_upload: requested })).resolves.toEqual({
            error: 'uploadSettingsLocked',
        });

        expect(hasActiveUploadClaimsMock).toHaveBeenCalledTimes(1);
        expect(acquireUploadProcessingContractLockMock).toHaveBeenCalledTimes(1);
        expect(releaseUploadContractLockMock).toHaveBeenCalledTimes(1);
        expect(transactionMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });
});
