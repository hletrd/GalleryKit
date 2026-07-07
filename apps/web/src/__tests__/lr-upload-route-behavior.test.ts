import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
    acquireUploadProcessingContractLockMock,
    dbInsertMock,
    dbSelectMock,
    deleteOriginalUploadFileMock,
    enqueueImageProcessingMock,
    getAdminAuthTokenMock,
    getClientIpMock,
    getGalleryConfigStrictMock,
    getUploadTrackerMock,
    lockReleaseMock,
    logAuditEventMock,
    saveOriginalAndGetMetadataMock,
    settleUploadTrackerClaimMock,
    statfsMock,
    uploadTracker,
} = vi.hoisted(() => {
    const tracker = new Map<string, { count: number; bytes: number; windowStart: number }>();
    return {
        acquireUploadProcessingContractLockMock: vi.fn(),
        dbInsertMock: vi.fn(),
        dbSelectMock: vi.fn(),
        deleteOriginalUploadFileMock: vi.fn(),
        enqueueImageProcessingMock: vi.fn(),
        getAdminAuthTokenMock: vi.fn(),
        getClientIpMock: vi.fn(),
        getGalleryConfigStrictMock: vi.fn(),
        getUploadTrackerMock: vi.fn(() => tracker),
        lockReleaseMock: vi.fn(),
        logAuditEventMock: vi.fn(async () => undefined),
        saveOriginalAndGetMetadataMock: vi.fn(),
        settleUploadTrackerClaimMock: vi.fn(),
        statfsMock: vi.fn(),
        uploadTracker: tracker,
    };
});

vi.mock('fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs/promises')>();
    return { ...actual, statfs: statfsMock };
});

vi.mock('@/lib/api-auth', () => ({
    getAdminAuthToken: getAdminAuthTokenMock,
    withAdminAuth: (handler: unknown) => handler,
}));

vi.mock('@/db', () => ({
    db: {
        select: dbSelectMock,
        insert: dbInsertMock,
    },
    topics: { slug: 'topics.slug' },
    images: {},
}));

vi.mock('@/lib/process-image', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/process-image')>();
    return {
        ...actual,
        extractExifForDb: vi.fn(() => ({})),
        saveOriginalAndGetMetadata: saveOriginalAndGetMetadataMock,
        stripGpsFromOriginal: vi.fn(async () => true),
    };
});

vi.mock('@/lib/upload-paths', () => ({
    ensureUploadDirectories: vi.fn(async () => undefined),
    deleteOriginalUploadFile: deleteOriginalUploadFileMock,
    UPLOAD_DIR_ORIGINAL: '/tmp/originals',
}));

vi.mock('@/lib/image-queue', () => ({
    createProcessingSettingsSnapshot: vi.fn((config) => ({
        quality: { webp: config.imageQualityWebp, avif: config.imageQualityAvif, jpeg: config.imageQualityJpeg },
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
    serializeProcessingSettingsSnapshot: vi.fn(() => '{}'),
}));

vi.mock('@/lib/upload-processing-contract-lock', () => ({
    acquireUploadProcessingContractLock: acquireUploadProcessingContractLockMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    getClientIp: getClientIpMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfigStrict: getGalleryConfigStrictMock,
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateAllAppData: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: vi.fn(() => false),
    cleanupOriginalIfRestoreMaintenanceBegan: vi.fn(async () => false),
}));

vi.mock('@/lib/upload-tracker-state', () => ({
    getUploadTracker: getUploadTrackerMock,
    pruneUploadTracker: vi.fn(),
    resetUploadTrackerWindowIfExpired: vi.fn(),
}));

vi.mock('@/lib/upload-tracker', () => ({
    settleUploadTrackerClaim: settleUploadTrackerClaimMock,
}));

vi.mock('@/app/actions/auth', () => ({
    getCurrentUser: vi.fn(async () => null),
}));

describe('Lightroom upload route behavior', () => {
    beforeEach(() => {
        uploadTracker.clear();
        vi.clearAllMocks();
        getAdminAuthTokenMock.mockReturnValue({ userId: 42 });
        getClientIpMock.mockReturnValue('203.0.113.42');
        acquireUploadProcessingContractLockMock.mockResolvedValue({ release: lockReleaseMock });
        dbSelectMock.mockReturnValue({
            from: vi.fn(() => ({
                where: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([{ slug: 'seoul' }]) })),
            })),
        });
        dbInsertMock.mockReturnValue({ values: vi.fn().mockResolvedValue([{ insertId: 9 }]) });
        getGalleryConfigStrictMock.mockResolvedValue({
            allowHdrIngest: false,
            autoAltTextEnabled: false,
            avifEffort: 6,
            forceSrgbDerivatives: false,
            imageQualityAvif: 85,
            imageQualityJpeg: 90,
            imageQualityWebp: 90,
            imageSizes: [640],
            sdrJpegChroma: '4:2:0',
            semanticSearchMode: 'disabled',
            stripGpsOnUpload: false,
            wideGamutJpegChroma: '4:4:4',
            wideGamutMaxSourcePixels: 50_000_000,
        });
        statfsMock.mockResolvedValue({ bavail: 2_000_000, bsize: 1024 });
        saveOriginalAndGetMetadataMock.mockResolvedValue({
            bitDepth: 8,
            blurDataUrl: 'data:image/jpeg;base64,abcd',
            colorPipelineDecision: 'srgb',
            colorSignals: { isHdr: true },
            exifData: {},
            filenameAvif: 'img.avif',
            filenameJpeg: 'img.jpg',
            filenameOriginal: 'orig.jpg',
            filenameWebp: 'img.webp',
            height: 10,
            iccProfileName: null,
            originalHeight: 10,
            originalWidth: 10,
            width: 10,
        });
    });

    it('cleans up and releases all claims on late HDR policy rejection', async () => {
        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const form = new FormData();
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'hdr.jpg', { type: 'image/jpeg' }));
        form.set('topic', 'seoul');

        const response = await POST(new NextRequest('https://gallery.test/api/admin/lr/upload', {
            method: 'POST',
            headers: { 'content-length': '1024' },
            body: form,
        }));

        await expect(response.json()).resolves.toEqual({ error: 'HDR ingest is disabled' });
        expect(response.status).toBe(422);
        expect(saveOriginalAndGetMetadataMock).toHaveBeenCalledOnce();
        expect(deleteOriginalUploadFileMock).toHaveBeenCalledWith('orig.jpg');
        expect(settleUploadTrackerClaimMock).toHaveBeenCalledWith(
            uploadTracker,
            'lr:42',
            1,
            1024,
            0,
            0,
        );
        expect(lockReleaseMock).toHaveBeenCalledOnce();
        expect(dbInsertMock).not.toHaveBeenCalled();
        expect(enqueueImageProcessingMock).not.toHaveBeenCalled();
    });

    it('uses the PAT actor for quota, row ownership, audit, and queue success work', async () => {
        getGalleryConfigStrictMock.mockResolvedValueOnce({
            allowHdrIngest: true,
            autoAltTextEnabled: true,
            avifEffort: 7,
            forceSrgbDerivatives: true,
            imageQualityAvif: 86,
            imageQualityJpeg: 91,
            imageQualityWebp: 92,
            imageSizes: [640, 1536],
            sdrJpegChroma: '4:2:0',
            semanticSearchMode: 'stub',
            stripGpsOnUpload: false,
            wideGamutJpegChroma: '4:4:4',
            wideGamutMaxSourcePixels: 50_000_000,
        });
        saveOriginalAndGetMetadataMock.mockResolvedValueOnce({
            bitDepth: 8,
            blurDataUrl: 'data:image/jpeg;base64,abcd',
            colorPipelineDecision: 'srgb',
            colorSignals: { isHdr: false, colorPrimaries: 'srgb' },
            exifData: { cameraModel: 'TestCam' },
            filenameAvif: 'img.avif',
            filenameJpeg: 'img.jpg',
            filenameOriginal: 'orig.jpg',
            filenameWebp: 'img.webp',
            height: 10,
            iccProfileName: 'sRGB IEC61966-2.1',
            originalHeight: 10,
            originalWidth: 10,
            width: 10,
        });

        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const form = new FormData();
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'pat-upload.jpg', { type: 'image/jpeg' }));
        form.set('topic', 'seoul');
        form.set('title', 'PAT upload');

        const response = await POST(new NextRequest('https://gallery.test/api/admin/lr/upload', {
            method: 'POST',
            headers: { 'content-length': '1024' },
            body: form,
        }));

        await expect(response.json()).resolves.toEqual({ success: true, id: 9 });
        expect(response.status).toBe(201);
        expect(settleUploadTrackerClaimMock).toHaveBeenCalledWith(
            uploadTracker,
            'lr:42',
            1,
            1024,
            1,
            3,
        );
        expect(enqueueImageProcessingMock).toHaveBeenCalledWith(expect.objectContaining({
            id: 9,
            filenameOriginal: 'orig.jpg',
            topic: 'seoul',
            autoAltTextEnabled: true,
            semanticSearchMode: 'stub',
        }));
        expect(logAuditEventMock).toHaveBeenCalledWith(
            42,
            'lr_token_used',
            'image',
            '9',
            '203.0.113.42',
            { topic: 'seoul', filename: 'pat-upload.jpg' },
        );
        expect(lockReleaseMock).toHaveBeenCalledOnce();
    });
});
