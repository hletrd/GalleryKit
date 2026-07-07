import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * C1-24: behavior-level coverage for the CLIP embedding backfill server
 * action (apps/web/src/app/actions/embeddings.ts). Mirrors the mocking
 * pattern used by apps/web/src/__tests__/topics-actions.test.ts (advisory
 * lock via `connection.getConnection()`) and
 * apps/web/src/__tests__/settings-semantic-mode-action.test.ts (toggleable
 * `requireSameOriginAdmin` mock).
 *
 * Each test uses a distinct admin user id so the module-level backfill rate
 * limiter (keyed per-user, one attempt per hour) never straddles tests.
 */

const {
    selectMock,
    insertMock,
    getConnectionMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    requireSameOriginAdminMock,
    maintenanceMessageMock,
    getGalleryConfigMock,
    embedImageStubMock,
    embedImageRealMock,
    resolveOriginalUploadPathMock,
} = vi.hoisted(() => ({
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    getConnectionMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    requireSameOriginAdminMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    embedImageStubMock: vi.fn(),
    embedImageRealMock: vi.fn(),
    resolveOriginalUploadPathMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        select: selectMock,
        insert: insertMock,
    },
    connection: {
        getConnection: getConnectionMock,
    },
    images: {
        id: 'images.id',
        filename_original: 'images.filename_original',
        processed: 'images.processed',
    },
    imageEmbeddings: {
        imageId: 'image_embeddings.image_id',
        modelVersion: 'image_embeddings.model_version',
    },
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: getCurrentUserMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: requireSameOriginAdminMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('@/lib/clip-inference', () => ({
    embedImageStub: embedImageStubMock,
}));

vi.mock('@/lib/clip-model', () => ({
    embedImageReal: embedImageRealMock,
}));

vi.mock('@/lib/clip-embeddings', () => ({
    embeddingToBuffer: vi.fn(() => Buffer.from('stub-embedding')),
    STUB_MODEL_VERSION: 'stub-v1',
    PRODUCTION_MODEL_VERSION: 'prod-v1',
    SEMANTIC_SCAN_LIMIT: 2000,
}));

vi.mock('@/lib/upload-paths', () => ({
    resolveOriginalUploadPath: resolveOriginalUploadPathMock,
}));

import { backfillClipEmbeddings } from '@/app/actions/embeddings';

function makePendingSelectChain<T>(result: T) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(result),
            }),
        }),
    };
}

function makeLockConnection(acquired: number) {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes('GET_LOCK')) return [[{ acquired }]];
            if (sql.includes('RELEASE_LOCK')) return [[{ released: 1 }]];
            return [[]];
        }),
        release: vi.fn(),
    };
}

let nextUserId = 1;
function freshUser() {
    // Distinct id per test so the module-level hourly rate limiter never
    // straddles two tests.
    return { id: nextUserId++ };
}

describe('backfillClipEmbeddings', () => {
    beforeEach(() => {
        selectMock.mockReset();
        insertMock.mockReset();
        getConnectionMock.mockReset();
        isAdminMock.mockReset();
        getCurrentUserMock.mockReset();
        getTranslationsMock.mockReset();
        requireSameOriginAdminMock.mockReset();
        maintenanceMessageMock.mockReset();
        getGalleryConfigMock.mockReset();
        embedImageStubMock.mockReset();
        embedImageRealMock.mockReset();
        resolveOriginalUploadPathMock.mockReset();

        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue(freshUser());
        getTranslationsMock.mockResolvedValue((key: string) => key);
        requireSameOriginAdminMock.mockResolvedValue(null);
        maintenanceMessageMock.mockReturnValue(null);
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'disabled' });
        embedImageStubMock.mockReturnValue(new Float32Array([1, 2, 3]));
    });

    it('rejects when the restore maintenance message is present', async () => {
        maintenanceMessageMock.mockReturnValueOnce('restoreInProgress');

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'error', message: 'restoreInProgress' });
        expect(getConnectionMock).not.toHaveBeenCalled();
    });

    it('rejects when requireSameOriginAdmin returns a failure', async () => {
        requireSameOriginAdminMock.mockResolvedValueOnce('crossOriginRejected');

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'unauthorized', message: 'crossOriginRejected' });
        expect(getConnectionMock).not.toHaveBeenCalled();
    });

    it('rejects when the caller is not an admin', async () => {
        isAdminMock.mockResolvedValueOnce(false);

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'unauthorized', message: 'unauthorized' });
        expect(getConnectionMock).not.toHaveBeenCalled();
    });

    it('is a no-op when semantic search mode is disabled (happy path)', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'disabled' });

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'ok', processed: 0, skipped: 0 });
        expect(getConnectionMock).not.toHaveBeenCalled();
        expect(selectMock).not.toHaveBeenCalled();
    });

    it('fails closed when the semantic embedding backfill advisory lock is already held', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'stub' });
        const conn = makeLockConnection(0);
        getConnectionMock.mockResolvedValue(conn);

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'error', message: 'restoreInProgress' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('returns a localized error when the advisory-lock connection cannot be acquired', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'stub' });
        getConnectionMock.mockRejectedValue(new Error('pool exhausted'));

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'error', message: 'embeddingBackfillFailed' });
        expect(selectMock).not.toHaveBeenCalled();

        errorSpy.mockRestore();
    });

    it('embeds pending rows with the stub encoder and upserts the stub model version (happy path)', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'stub' });
        const conn = makeLockConnection(1);
        getConnectionMock.mockResolvedValue(conn);
        selectMock.mockReturnValue(makePendingSelectChain([{ id: 10, filenameOriginal: 'orig.jpg' }]));
        const valuesMock = vi.fn().mockReturnValue({ onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });
        insertMock.mockReturnValue({ values: valuesMock });

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'ok', processed: 1, skipped: 0 });

        expect(embedImageStubMock).toHaveBeenCalledWith(10);
        expect(embedImageRealMock).not.toHaveBeenCalled();
        expect(valuesMock).toHaveBeenCalledWith(expect.objectContaining({ imageId: 10, modelVersion: 'stub-v1' }));
        expect(conn.release).toHaveBeenCalledTimes(1);
    });

    it('skips a production-mode row whose original upload path cannot be resolved (failure path)', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'production' });
        const conn = makeLockConnection(1);
        getConnectionMock.mockResolvedValue(conn);
        selectMock.mockReturnValue(makePendingSelectChain([{ id: 20, filenameOriginal: 'orig2.jpg' }]));
        resolveOriginalUploadPathMock.mockResolvedValue(null);

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'ok', processed: 0, skipped: 1 });

        expect(embedImageRealMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('counts a row as skipped when the real encoder throws (failure path)', async () => {
        getGalleryConfigMock.mockResolvedValue({ semanticSearchMode: 'production' });
        const conn = makeLockConnection(1);
        getConnectionMock.mockResolvedValue(conn);
        selectMock.mockReturnValue(makePendingSelectChain([{ id: 30, filenameOriginal: 'orig3.jpg' }]));
        resolveOriginalUploadPathMock.mockResolvedValue('/data/uploads/original/orig3.jpg');
        embedImageRealMock.mockRejectedValue(new Error('onnx inference failed'));

        await expect(backfillClipEmbeddings()).resolves.toEqual({ status: 'ok', processed: 0, skipped: 1 });
        expect(insertMock).not.toHaveBeenCalled();
    });
});
