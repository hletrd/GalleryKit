import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    statfsMock,
    mkdirMock,
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
    ensureTagRecordMock,
    acquireUploadProcessingContractLockMock,
    uploadContractReleaseMock,
    selectResultMock,
} = vi.hoisted(() => ({
    statfsMock: vi.fn(),
    mkdirMock: vi.fn(),
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
    ensureTagRecordMock: vi.fn(),
    acquireUploadProcessingContractLockMock: vi.fn(),
    uploadContractReleaseMock: vi.fn(),
    // C11-MED-01: configurable select result for topic-existence check.
    // Default: topic found (upload proceeds). Individual tests override
    // to return [] (topic not found).
    selectResultMock: vi.fn().mockResolvedValue([{ slug: 'travel' }]),
}));

function makeInsertChain<T>(result: T) {
    return {
        values: vi.fn().mockResolvedValue(result),
    };
}

vi.mock('fs/promises', () => ({
    statfs: statfsMock,
    mkdir: mkdirMock,
}));

vi.mock('@/db', () => ({
    db: {
        insert: insertMock,
        // C11-MED-01: select mock for topic-existence check in uploadImages.
        // Uses selectResultMock so individual tests can override the result.
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: selectResultMock,
                })),
            })),
        })),
    },
    images: {
        id: 'images.id',
    },
    imageTags: {
        imageId: 'image_tags.image_id',
        tagId: 'image_tags.tag_id',
    },
    topics: {
        slug: 'topics.slug',
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

vi.mock('@/lib/upload-processing-contract-lock', () => ({
    acquireUploadProcessingContractLock: acquireUploadProcessingContractLockMock,
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

vi.mock('@/lib/tag-records', () => ({
    getTagSlug: (name: string) => name
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s_]+/gu, '-')
        .replace(/[^\p{Letter}\p{Number}-]+/gu, '')
        .replace(/-{2,}/g, '-')
        .replace(/(^-|-$)/g, ''),
    ensureTagRecord: ensureTagRecordMock,
}));

import { uploadImages } from '@/app/actions/images';

describe('uploadImages', () => {
    beforeEach(() => {
        statfsMock.mockReset();
        statfsMock.mockResolvedValue({ bfree: 2_000_000, bsize: 1024 });
        mkdirMock.mockReset();
        mkdirMock.mockResolvedValue(undefined);
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
        uploadContractReleaseMock.mockReset();
        uploadContractReleaseMock.mockResolvedValue(undefined);
        acquireUploadProcessingContractLockMock.mockReset();
        acquireUploadProcessingContractLockMock.mockResolvedValue({ release: uploadContractReleaseMock });
        ensureTagRecordMock.mockReset();
        ensureTagRecordMock.mockImplementation(async (_writer, cleanName: string, slug: string) => ({
            kind: 'found',
            tag: { id: 7, name: cleanName, slug },
        }));
        // C11-MED-01: reset select result to default (topic found)
        selectResultMock.mockReset();
        selectResultMock.mockResolvedValue([{ slug: 'travel' }]);
    });

    it('revalidates the affected topic path after a successful upload', async () => {
        insertMock.mockReturnValue(makeInsertChain([{ insertId: 9 }]));

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toMatchObject({ success: true, count: 1 });
        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/', '/admin/dashboard', '/travel');
        expect(uploadContractReleaseMock).toHaveBeenCalled();
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

    it('rejects the entire upload batch when any single tag fails validation (C7L-FIX-01 / C7L-TE-01)', async () => {
        // Two candidate tags split from `tagsString`: the first is valid, the
        // second contains an angle bracket that `isValidTagName` rejects.
        // Defense in depth: a single bad tag aborts the whole batch so the
        // admin can correct before persistence. Locks in the single-source
        // split contract introduced by C7L-FIX-01 — if a future edit forgets
        // to compare the candidate count against the validated tag count,
        // this test fails.
        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', 'good-tag, ba<d-tag');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'invalidTagNames' });
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects unsafe original filenames before file I/O', async () => {
        const formData = new FormData();
        formData.append('files', new File(['binary'], `${'a'.repeat(256)}.jpg`, { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'invalidFilename' });
        expect(acquireUploadProcessingContractLockMock).not.toHaveBeenCalled();
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('creates upload directories before inspecting disk space', async () => {
        insertMock.mockReturnValue(makeInsertChain([{ insertId: 9 }]));

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toMatchObject({ success: true, count: 1 });
        expect(mkdirMock).toHaveBeenCalled();
        expect(statfsMock).toHaveBeenCalled();
        expect(mkdirMock.mock.invocationCallOrder[0]).toBeLessThan(statfsMock.mock.invocationCallOrder[0]);
    });

    it('fails closed when upload disk-space inspection fails after directories are ensured', async () => {
        statfsMock.mockRejectedValueOnce(new Error('missing upload volume'));

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'insufficientDiskSpace' });
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects upload when the topic does not exist in the database (C11-MED-01)', async () => {
        // Override the select result to return an empty array (topic not found)
        selectResultMock.mockResolvedValue([]);

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'deleted-topic');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'topicNotFound' });
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('returns a warning when requested upload tags cannot be persisted', async () => {
        insertMock.mockImplementation(() => makeInsertChain([{ insertId: 9 }]));
        ensureTagRecordMock.mockRejectedValueOnce(new Error('tag insert failed'));

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', 'Night Sky');

        await expect(uploadImages(formData)).resolves.toMatchObject({
            success: true,
            count: 1,
            warnings: ['tagPersistenceWarning'],
        });
        expect(enqueueImageProcessingMock).toHaveBeenCalledWith(expect.objectContaining({ id: 9, topic: 'travel' }));
    });
});
