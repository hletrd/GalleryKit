import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    statfsMock,
    insertMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    saveOriginalAndGetMetadataMock,
    extractExifForDbMock,
    enqueueImageProcessingMock,
    revalidateLocalizedPathsMock,
    getGalleryConfigMock,
    getClientIpMock,
    cleanupOriginalIfRestoreMaintenanceBeganMock,
    settleUploadTrackerClaimMock,
    headersMock,
    maintenanceMessageMock,
    logAuditEventMock,
} = vi.hoisted(() => ({
    statfsMock: vi.fn(),
    insertMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    saveOriginalAndGetMetadataMock: vi.fn(),
    extractExifForDbMock: vi.fn(),
    enqueueImageProcessingMock: vi.fn(),
    revalidateLocalizedPathsMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    getClientIpMock: vi.fn(),
    cleanupOriginalIfRestoreMaintenanceBeganMock: vi.fn(),
    settleUploadTrackerClaimMock: vi.fn(),
    headersMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
    logAuditEventMock: vi.fn(),
}));

function makeInsertChain<T>(result: T) {
    return {
        values: vi.fn().mockResolvedValue(result),
    };
}

vi.mock('fs/promises', () => ({
    statfs: statfsMock,
}));

vi.mock('@/db', () => ({
    db: {
        insert: insertMock,
    },
    images: {
        id: 'images.id',
    },
    imageTags: {
        imageId: 'image_tags.image_id',
        tagId: 'image_tags.tag_id',
    },
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: getCurrentUserMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/process-image', () => ({
    saveOriginalAndGetMetadata: saveOriginalAndGetMetadataMock,
    extractExifForDb: extractExifForDbMock,
    deleteImageVariants: vi.fn(),
}));

vi.mock('@/lib/image-queue', () => ({
    enqueueImageProcessing: enqueueImageProcessingMock,
    getProcessingQueueState: vi.fn(() => ({ enqueued: new Set<number>() })),
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateLocalizedPaths: revalidateLocalizedPathsMock,
    revalidateAllAppData: vi.fn(),
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    getClientIp: getClientIpMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    cleanupOriginalIfRestoreMaintenanceBegan: cleanupOriginalIfRestoreMaintenanceBeganMock,
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

// C2R-02: mock the same-origin guard so image-action unit tests don't need a
// live request scope. Production callers still enforce the check.
vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn(async () => null),
}));

vi.mock('@/lib/upload-tracker', () => ({
    settleUploadTrackerClaim: settleUploadTrackerClaimMock,
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

import { uploadImages } from '@/app/actions/images';

describe('uploadImages', () => {
    beforeEach(() => {
        statfsMock.mockResolvedValue({ bfree: 2_000_000, bsize: 1024 });
        insertMock.mockReset();
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 1 });
        getTranslationsMock.mockResolvedValue((key: string) => key);
        saveOriginalAndGetMetadataMock.mockReset();
        saveOriginalAndGetMetadataMock.mockResolvedValue({
            filenameOriginal: 'original.jpg',
            filenameWebp: 'photo.webp',
            filenameAvif: 'photo.avif',
            filenameJpeg: 'photo.jpg',
            width: 1200,
            height: 800,
            originalWidth: 1200,
            originalHeight: 800,
            blurDataUrl: 'data:image/png;base64,abc',
            exifData: {},
        });
        extractExifForDbMock.mockReset();
        extractExifForDbMock.mockReturnValue({});
        enqueueImageProcessingMock.mockReset();
        revalidateLocalizedPathsMock.mockReset();
        getGalleryConfigMock.mockResolvedValue({
            stripGpsOnUpload: false,
            imageQualityWebp: 90,
            imageQualityAvif: 85,
            imageQualityJpeg: 90,
            imageSizes: [640, 1536, 2048, 4096],
        });
        getClientIpMock.mockReturnValue('203.0.113.5');
        cleanupOriginalIfRestoreMaintenanceBeganMock.mockResolvedValue(false);
        settleUploadTrackerClaimMock.mockReset();
        headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue(null) });
        maintenanceMessageMock.mockReturnValue(null);
        logAuditEventMock.mockReset();
        logAuditEventMock.mockResolvedValue(undefined);
    });

    it('revalidates the affected topic path after a successful upload', async () => {
        insertMock.mockReturnValue(makeInsertChain([{ insertId: 9 }]));

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toMatchObject({ success: true, count: 1 });
        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/', '/admin/dashboard', '/travel');
    });

    it('rejects upload tags whose generated slug would be empty', async () => {
        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '!!!');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'invalidTagNames' });
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });
});
