import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    transactionMock,
    txInsertMock,
    txInsertValuesMock,
    txOnDuplicateKeyUpdateMock,
    txDeleteMock,
    txDeleteWhereMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    revalidateAllAppDataMock,
    logAuditEventMock,
    maintenanceMessageMock,
    requireSameOriginAdminMock,
    hasActiveUploadClaimsMock,
    acquireUploadProcessingContractLockMock,
} = vi.hoisted(() => ({
    transactionMock: vi.fn(),
    txInsertMock: vi.fn(),
    txInsertValuesMock: vi.fn(),
    txOnDuplicateKeyUpdateMock: vi.fn(),
    txDeleteMock: vi.fn(),
    txDeleteWhereMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    revalidateAllAppDataMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
    requireSameOriginAdminMock: vi.fn(),
    hasActiveUploadClaimsMock: vi.fn(),
    acquireUploadProcessingContractLockMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        transaction: transactionMock,
        select: vi.fn(),
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

    beforeEach(() => {
        persistedRows = [];
        vi.clearAllMocks();
        getTranslationsMock.mockResolvedValue((key: string) => key);
        maintenanceMessageMock.mockReturnValue(null);
        requireSameOriginAdminMock.mockResolvedValue(null);
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 7 });
        logAuditEventMock.mockResolvedValue(undefined);
        revalidateAllAppDataMock.mockReset();
        hasActiveUploadClaimsMock.mockReturnValue(false);
        acquireUploadProcessingContractLockMock.mockResolvedValue(null);
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
        });

        expect(transactionMock).toHaveBeenCalledTimes(1);
        expect(persistedRows).toEqual([{ key: 'semantic_search_mode', value: mode }]);
        expect(txOnDuplicateKeyUpdateMock).toHaveBeenCalledTimes(1);
        expect(revalidateAllAppDataMock).toHaveBeenCalledTimes(1);
        expect(logAuditEventMock).toHaveBeenCalledTimes(1);
    });
});
