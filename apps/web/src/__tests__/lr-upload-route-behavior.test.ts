import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { UPLOAD_MAX_FILES_PER_WINDOW } from '@/lib/upload-limits';

const {
    acquireUploadProcessingContractLockMock,
    dbInsertMock,
    dbSelectMock,
    deleteOriginalUploadFileMock,
    enqueueImageProcessingMock,
    ensureUploadDirectoriesMock,
    getAdminAuthTokenMock,
    markAdminAuthTokenUsedMock,
    getClientIpMock,
    getGalleryConfigStrictMock,
    getUploadTrackerMock,
    isRestoreMaintenanceActiveMock,
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
        ensureUploadDirectoriesMock: vi.fn(async () => undefined),
        getAdminAuthTokenMock: vi.fn(),
        markAdminAuthTokenUsedMock: vi.fn(async () => undefined),
        getClientIpMock: vi.fn(),
        getGalleryConfigStrictMock: vi.fn(),
        getUploadTrackerMock: vi.fn(() => tracker),
        isRestoreMaintenanceActiveMock: vi.fn(),
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
    markAdminAuthTokenUsed: markAdminAuthTokenUsedMock,
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
    ensureUploadDirectories: ensureUploadDirectoriesMock,
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
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
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
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
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
        expect(markAdminAuthTokenUsedMock).toHaveBeenCalledOnce();
        expect(lockReleaseMock).toHaveBeenCalledOnce();
    });

    it('releases the multipart parse slot when token finalization fails after acquisition', async () => {
        markAdminAuthTokenUsedMock.mockRejectedValueOnce(new Error('token finalization failed'));

        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const makeRequest = (filename: string) => {
            const form = new FormData();
            form.set('file', new File([new Uint8Array([1, 2, 3])], filename, { type: 'image/jpeg' }));
            form.set('topic', 'seoul');
            return new NextRequest('https://gallery.test/api/admin/lr/upload', {
                method: 'POST',
                headers: { 'content-length': '1024' },
                body: form,
            });
        };

        await expect(POST(makeRequest('first.jpg'))).rejects.toThrow('token finalization failed');
        expect(settleUploadTrackerClaimMock).not.toHaveBeenCalled();

        const response = await POST(makeRequest('second.jpg'));

        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toEqual({ error: 'HDR ingest is disabled' });
        expect(markAdminAuthTokenUsedMock).toHaveBeenCalledTimes(2);
    });

    // C6-11 (run-10 cycle-6): drive the failure branches that were previously
    // pinned only by source-string assertions, asserting the real Response.

    it('rejects with 503 when a restore is in progress (entry guard)', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const form = new FormData();
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
        form.set('topic', 'seoul');

        const response = await POST(new NextRequest('https://gallery.test/api/admin/lr/upload', {
            method: 'POST',
            headers: { 'content-length': '1024' },
            body: form,
        }));

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Restore in progress; retry shortly' });
        // The restore guard runs before any save/insert/queue work.
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(dbInsertMock).not.toHaveBeenCalled();
        expect(enqueueImageProcessingMock).not.toHaveBeenCalled();
        expect(markAdminAuthTokenUsedMock).not.toHaveBeenCalled();
    });

    it('rejects with 411 when Content-Length is absent', async () => {
        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const form = new FormData();
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
        form.set('topic', 'seoul');

        // No content-length header → declaredUploadBytes is NaN → 411.
        const response = await POST(new NextRequest('https://gallery.test/api/admin/lr/upload', {
            method: 'POST',
            body: form,
        }));

        expect(response.status).toBe(411);
        await expect(response.json()).resolves.toEqual({ error: 'Content-Length is required for Lightroom uploads' });
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
    });

    it('rejects with 429 when the per-window file-count cap is already reached', async () => {
        // Pre-seed the actor's tracker (key lr:42) at the cap so count+1 > cap.
        uploadTracker.set('lr:42', {
            count: UPLOAD_MAX_FILES_PER_WINDOW,
            bytes: 0,
            windowStart: Date.now(),
        });

        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const form = new FormData();
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
        form.set('topic', 'seoul');

        const response = await POST(new NextRequest('https://gallery.test/api/admin/lr/upload', {
            method: 'POST',
            headers: { 'content-length': '1024' },
            body: form,
        }));

        expect(response.status).toBe(429);
        await expect(response.json()).resolves.toEqual({ error: 'Upload limit reached; retry later' });
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
    });

    it('rejects with 507 when the upload volume has insufficient free space', async () => {
        // bavail * bsize < 1 GiB → disk-space precheck fails.
        statfsMock.mockResolvedValueOnce({ bavail: 1000, bsize: 1024 });

        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const form = new FormData();
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
        form.set('topic', 'seoul');

        const response = await POST(new NextRequest('https://gallery.test/api/admin/lr/upload', {
            method: 'POST',
            headers: { 'content-length': '1024' },
            body: form,
        }));

        expect(response.status).toBe(507);
        await expect(response.json()).resolves.toEqual({ error: 'Insufficient disk space' });
        // The disk-space precheck runs before saving the original.
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(dbInsertMock).not.toHaveBeenCalled();
    });

    it('settles the quota claim when upload-directory preparation fails', async () => {
        ensureUploadDirectoriesMock.mockRejectedValueOnce(new Error('EACCES'));

        const { POST } = await import('@/app/api/admin/lr/upload/route');
        const form = new FormData();
        form.set('file', new File([new Uint8Array([1, 2, 3])], 'x.jpg', { type: 'image/jpeg' }));
        form.set('topic', 'seoul');

        const response = await POST(new NextRequest('https://gallery.test/api/admin/lr/upload', {
            method: 'POST',
            headers: { 'content-length': '1024' },
            body: form,
        }));

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ error: 'Upload storage unavailable; retry shortly' });
        expect(settleUploadTrackerClaimMock).toHaveBeenCalledWith(
            uploadTracker,
            'lr:42',
            1,
            1024,
            0,
            0,
        );
        expect(saveOriginalAndGetMetadataMock).not.toHaveBeenCalled();
        expect(dbInsertMock).not.toHaveBeenCalled();
        expect(lockReleaseMock).toHaveBeenCalledOnce();
    });
});
