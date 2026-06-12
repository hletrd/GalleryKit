/**
 * TRC-R5C1-18: retryFailedImage must require an admin session.
 *
 * Prior to this fix the function only called requireSameOriginAdmin() and
 * skipped the isAdmin() check, meaning any same-origin request (e.g. a
 * crafted POST from an authenticated page on the same domain that is NOT
 * logged in as an admin) could clear processing_error and re-enqueue images.
 *
 * This test asserts that:
 *  - A same-origin request that fails isAdmin() returns { error: … } and
 *    makes zero DB calls.
 *  - A valid admin session proceeds past the auth gate.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// caption-generator (imported transitively via image-queue → images) pulls in
// 'server-only'. Mock it so vitest doesn't reject the import outside Next.js.
vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    isAdminMock,
    requireSameOriginAdminMock,
    getTranslationsMock,
    dbSelectMock,
    dbUpdateMock,
    getProcessingQueueStateMock,
    enqueueImageProcessingMock,
    revalidateAllAppDataMock,
} = vi.hoisted(() => ({
    isAdminMock: vi.fn(),
    requireSameOriginAdminMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    dbSelectMock: vi.fn(),
    dbUpdateMock: vi.fn(),
    getProcessingQueueStateMock: vi.fn(),
    enqueueImageProcessingMock: vi.fn(),
    revalidateAllAppDataMock: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: requireSameOriginAdminMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

vi.mock('@/db', () => ({
    db: {
        select: dbSelectMock,
        update: dbUpdateMock,
        insert: vi.fn(),
        delete: vi.fn(),
        transaction: vi.fn(),
    },
    images: { id: 'images.id', processed: 'images.processed', processing_error: 'images.processing_error' },
    imageTags: {},
    topics: {},
    sharedGroups: {},
    sharedGroupImages: {},
}));

vi.mock('@/lib/image-queue', () => ({
    enqueueImageProcessing: enqueueImageProcessingMock,
    getProcessingQueueState: getProcessingQueueStateMock,
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateAllAppData: revalidateAllAppDataMock,
    revalidateLocalizedPaths: vi.fn(),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: vi.fn().mockReturnValue(null),
    isRestoreMaintenanceActive: vi.fn().mockReturnValue(false),
    cleanupOriginalIfRestoreMaintenanceBegan: vi.fn(),
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: vi.fn(),
}));

vi.mock('@/lib/upload-paths', () => ({
    UPLOAD_DIR_ORIGINAL: '/tmp/uploads/original',
    UPLOAD_DIR_WEBP: '/tmp/uploads/webp',
    UPLOAD_DIR_AVIF: '/tmp/uploads/avif',
    UPLOAD_DIR_JPEG: '/tmp/uploads/jpeg',
    deleteOriginalUploadFile: vi.fn(),
    ensureUploadDirectories: vi.fn(),
}));

vi.mock('@/lib/upload-tracker', () => ({
    settleUploadTrackerClaim: vi.fn(),
}));

vi.mock('@/lib/upload-tracker-state', () => ({
    getUploadTracker: vi.fn(),
    pruneUploadTracker: vi.fn(),
    resetUploadTrackerWindowIfExpired: vi.fn(),
}));

vi.mock('@/lib/upload-processing-contract-lock', () => ({
    acquireUploadProcessingContractLock: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: vi.fn(),
}));

vi.mock('next/headers', () => ({
    headers: vi.fn(async () => ({ get: () => null })),
}));

import { retryFailedImage } from '@/app/actions/images';

describe('retryFailedImage auth gate (TRC-R5C1-18)', () => {
    beforeEach(() => {
        isAdminMock.mockReset();
        requireSameOriginAdminMock.mockReset();
        getTranslationsMock.mockReset();
        dbSelectMock.mockReset();
        dbUpdateMock.mockReset();
        getProcessingQueueStateMock.mockReset();
        enqueueImageProcessingMock.mockReset();

        getTranslationsMock.mockResolvedValue((key: string) => `T:${key}`);
    });

    it('returns { error } and makes zero DB calls when isAdmin() returns false', async () => {
        requireSameOriginAdminMock.mockResolvedValue(null); // same-origin OK
        isAdminMock.mockResolvedValue(false); // but not an admin

        const result = await retryFailedImage(1);

        expect(result).toEqual({ error: 'T:unauthorized' });
        // No DB select should have been called
        expect(dbSelectMock).not.toHaveBeenCalled();
        expect(dbUpdateMock).not.toHaveBeenCalled();
        expect(enqueueImageProcessingMock).not.toHaveBeenCalled();
    });

    it('returns { error } and makes zero DB calls when requireSameOriginAdmin() returns an error', async () => {
        requireSameOriginAdminMock.mockResolvedValue('T:unauthorized'); // origin check fails
        isAdminMock.mockResolvedValue(true); // admin, but shouldn't reach here

        const result = await retryFailedImage(1);

        expect(result).toEqual({ error: 'T:unauthorized' });
        expect(dbSelectMock).not.toHaveBeenCalled();
        expect(isAdminMock).not.toHaveBeenCalled();
    });
});
