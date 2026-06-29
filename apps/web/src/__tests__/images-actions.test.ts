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
    unlink: vi.fn().mockResolvedValue(undefined),
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
    IMAGE_PIPELINE_VERSION: 5,
}));

vi.mock('@/lib/image-queue', () => ({
    createProcessingSettingsSnapshot: vi.fn((config) => ({
        quality: {
            webp: config.imageQualityWebp,
            avif: config.imageQualityAvif,
            jpeg: config.imageQualityJpeg,
        },
        imageSizes: config.imageSizes,
        forceSrgbDerivatives: config.forceSrgbDerivatives,
        wideGamutJpegChroma: config.wideGamutJpegChroma,
        avifEffort: config.avifEffort,
        sdrJpegChroma: config.sdrJpegChroma,
        wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
        autoAltTextEnabled: config.autoAltTextEnabled,
        semanticSearchMode: config.semanticSearchMode,
    })),
    enqueueImageProcessing: enqueueImageProcessingMock,
    getProcessingQueueState: vi.fn(() => ({ enqueued: new Set<number>() })),
    serializeProcessingSettingsSnapshot: vi.fn(() => '{"quality":{"webp":90,"avif":85,"jpeg":90}}'),
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateLocalizedPaths: revalidateLocalizedPathsMock,
    revalidateAllAppData: vi.fn(),
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
    getGalleryConfigStrict: getGalleryConfigMock,
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
        // R14C14 / TE-02: drive the mock with the field the code actually reads
        // (`bavail`, NOT `bfree`). The prior `bfree`-only mock made the happy
        // path pass by accident — `stats.bavail` was undefined → NaN → NaN <
        // threshold is false — so the bavail fix had no real coverage.
        statfsMock.mockResolvedValue({ bavail: 2_000_000, bsize: 1024 });
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
        getGalleryConfigMock.mockResolvedValueOnce({
            stripGpsOnUpload: false,
            imageQualityWebp: 91,
            imageQualityAvif: 86,
            imageQualityJpeg: 92,
            imageSizes: [640, 1536, 2048, 4096],
            forceSrgbDerivatives: true,
            wideGamutJpegChroma: '4:4:4',
            avifEffort: 7,
            sdrJpegChroma: '4:2:2',
            wideGamutMaxSourcePixels: 42_000_000,
            autoAltTextEnabled: true,
            semanticSearchMode: 'production',
        });

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toMatchObject({ success: true, count: 1 });
        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/', '/admin/dashboard', '/travel');
        expect(uploadContractReleaseMock).toHaveBeenCalled();
        expect(enqueueImageProcessingMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 9,
            topic: 'travel',
            quality: { webp: 91, avif: 86, jpeg: 92 },
            imageSizes: [640, 1536, 2048, 4096],
            forceSrgbDerivatives: true,
            wideGamutJpegChroma: '4:4:4',
            avifEffort: 7,
            sdrJpegChroma: '4:2:2',
            wideGamutMaxSourcePixels: 42_000_000,
            autoAltTextEnabled: true,
            semanticSearchMode: 'production',
        }));
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

    it('rejects upload tags when sanitization would change the submitted input', async () => {
        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', 'night\u200bsky');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'invalidTagNames' });
        expect(acquireUploadProcessingContractLockMock).not.toHaveBeenCalled();
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects upload topic when sanitization would change the submitted slug', async () => {
        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'tra\u0000vel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'invalidTopicFormat' });
        expect(acquireUploadProcessingContractLockMock).not.toHaveBeenCalled();
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

    it('rejects the upload when available (non-root) disk space is below the 1 GiB threshold (R14C14 / TE-02)', async () => {
        // Drive the mock with the field the code actually reads (`bavail`, NOT
        // `bfree`). With `bavail` below the 1 GiB floor the pre-check must fail
        // closed. This LOCKS the cycle-13 bfree→bavail contract: if the code is
        // reverted to `stats.bfree`, the mock's missing `bfree` yields
        // `undefined * bsize = NaN`, `NaN < 1GiB` is false, the upload proceeds,
        // and this assertion fails — exactly the regression the prior bfree-only
        // happy-path mock could not catch.
        statfsMock.mockResolvedValue({ bavail: 1, bsize: 1024 });

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'insufficientDiskSpace' });
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
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

    // R8-TEST P0-1: rejects PQ HDR upload when allow_hdr_ingest is false
    it('rejects HDR upload when allowHdrIngest is disabled', async () => {
        saveOriginalAndGetMetadataMock.mockResolvedValueOnce({
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
            colorSignals: {
                isHdr: true,
                transferFunction: 'pq',
                colorPrimaries: 'bt2020',
                iccProfileName: 'PQ HDR',
            },
        });
        getGalleryConfigMock.mockResolvedValueOnce({
            stripGpsOnUpload: false,
            imageQualityWebp: 90,
            imageQualityAvif: 85,
            imageQualityJpeg: 90,
            imageSizes: [640, 1536, 2048, 4096],
            allowHdrIngest: false,
        });

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'hdr-photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toEqual({ error: 'hdrNotSupported' });
        expect(insertMock).not.toHaveBeenCalled();
        expect(enqueueImageProcessingMock).not.toHaveBeenCalled();
    });

    // R8-TEST P0-1: accepts HDR upload with warning when allow_hdr_ingest is true
    it('accepts HDR upload with warning when allowHdrIngest is enabled', async () => {
        insertMock.mockImplementation(() => makeInsertChain([{ insertId: 9 }]));
        saveOriginalAndGetMetadataMock.mockResolvedValueOnce({
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
            colorSignals: {
                isHdr: true,
                transferFunction: 'pq',
                colorPrimaries: 'bt2020',
                iccProfileName: 'PQ HDR',
            },
        });
        getGalleryConfigMock.mockResolvedValueOnce({
            stripGpsOnUpload: false,
            imageQualityWebp: 90,
            imageQualityAvif: 85,
            imageQualityJpeg: 90,
            imageSizes: [640, 1536, 2048, 4096],
            allowHdrIngest: true,
        });

        const formData = new FormData();
        formData.append('files', new File(['binary'], 'hdr-photo.jpg', { type: 'image/jpeg' }));
        formData.set('topic', 'travel');
        formData.set('tags', '');

        await expect(uploadImages(formData)).resolves.toMatchObject({
            success: true,
            count: 1,
            hdrWarningCount: 1,
        });
        expect(insertMock).toHaveBeenCalled();
        expect(enqueueImageProcessingMock).toHaveBeenCalled();
    });
});
