import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * C1-23: behavior-level coverage for the smart-collection CRUD actions
 * (apps/web/src/app/actions/collections.ts). Mirrors the mocking pattern
 * used by apps/web/src/__tests__/topics-actions.test.ts and
 * apps/web/src/__tests__/settings-semantic-mode-action.test.ts — mock the
 * `@/db` module and the auth/origin/maintenance guards, then exercise the
 * exported actions directly.
 */

const {
    insertMock,
    updateMock,
    deleteMock,
    isAdminMock,
    getTranslationsMock,
    revalidateAllAppDataMock,
    maintenanceMessageMock,
    requireSameOriginAdminMock,
} = vi.hoisted(() => ({
    insertMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    isAdminMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    revalidateAllAppDataMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
    requireSameOriginAdminMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
    },
    smartCollections: {
        id: 'smart_collections.id',
    },
    // parseSmartCollectionQuery (via '@/lib/smart-collections') builds its
    // ALLOWED_COLUMNS map from `images.*` at module load time, and also
    // statically imports `tags`/`imageTags` for its (unused-by-these-tests)
    // tag-predicate SQL compiler — all three must exist on the mock so the
    // import doesn't throw, even though these actions never touch `tags`/
    // `imageTags` at runtime.
    images: {
        iso: 'images.iso',
        focal_length: 'images.focal_length',
        f_number: 'images.f_number',
        exposure_time: 'images.exposure_time',
        camera_model: 'images.camera_model',
        lens_model: 'images.lens_model',
        capture_date: 'images.capture_date',
        topic: 'images.topic',
    },
    tags: {
        id: 'tags.id',
        name: 'tags.name',
    },
    imageTags: {
        imageId: 'image_tags.image_id',
        tagId: 'image_tags.tag_id',
    },
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateAllAppData: revalidateAllAppDataMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: requireSameOriginAdminMock,
}));

import { createSmartCollection, updateSmartCollection, deleteSmartCollection } from '@/app/actions/collections';

function makeWriteChain<T>(result: T) {
    return {
        values: vi.fn().mockResolvedValue(result),
        where: vi.fn().mockResolvedValue(result),
    };
}

function makeUpdateChain<T>(result: T) {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(result),
        }),
    };
}

const VALID_QUERY_JSON = JSON.stringify({ type: 'predicate', column: 'topic', operator: 'eq', value: 'travel' });

function validFormData(overrides: Partial<Record<'slug' | 'name' | 'query_json' | 'is_public', string>> = {}) {
    const fd = new FormData();
    fd.set('slug', overrides.slug ?? 'travel-2026');
    fd.set('name', overrides.name ?? 'Travel 2026');
    fd.set('query_json', overrides.query_json ?? VALID_QUERY_JSON);
    fd.set('is_public', overrides.is_public ?? 'true');
    return fd;
}

describe('smart collection actions', () => {
    beforeEach(() => {
        insertMock.mockReset();
        updateMock.mockReset();
        deleteMock.mockReset();
        isAdminMock.mockReset();
        getTranslationsMock.mockReset();
        revalidateAllAppDataMock.mockReset();
        maintenanceMessageMock.mockReset();
        requireSameOriginAdminMock.mockReset();

        isAdminMock.mockResolvedValue(true);
        getTranslationsMock.mockResolvedValue((key: string) => key);
        maintenanceMessageMock.mockReturnValue(null);
        requireSameOriginAdminMock.mockResolvedValue(null);
    });

    describe('createSmartCollection', () => {
        it('rejects when the restore maintenance message is present', async () => {
            maintenanceMessageMock.mockReturnValueOnce('restoreInProgress');

            await expect(createSmartCollection(validFormData())).resolves.toEqual({ error: 'restoreInProgress' });
            expect(insertMock).not.toHaveBeenCalled();
        });

        it('rejects when requireSameOriginAdmin returns a failure', async () => {
            requireSameOriginAdminMock.mockResolvedValueOnce('crossOriginRejected');

            await expect(createSmartCollection(validFormData())).resolves.toEqual({ error: 'crossOriginRejected' });
            expect(insertMock).not.toHaveBeenCalled();
        });

        it('rejects when the caller is not an admin', async () => {
            isAdminMock.mockResolvedValueOnce(false);

            await expect(createSmartCollection(validFormData())).resolves.toEqual({ error: 'unauthorized' });
            expect(insertMock).not.toHaveBeenCalled();
        });

        it('rejects an invalid query_json shape without persisting', async () => {
            await expect(
                createSmartCollection(validFormData({ query_json: '{not valid json' })),
            ).resolves.toEqual({ error: 'invalidCollectionQuery' });
            expect(insertMock).not.toHaveBeenCalled();
        });

        it('persists the expected row shape on the happy path', async () => {
            const writeChain = makeWriteChain(undefined);
            insertMock.mockReturnValueOnce(writeChain);

            await expect(createSmartCollection(validFormData())).resolves.toEqual({ success: true });

            expect(writeChain.values).toHaveBeenCalledWith({
                slug: 'travel-2026',
                name: 'Travel 2026',
                query_json: VALID_QUERY_JSON,
                is_public: true,
            });
            expect(revalidateAllAppDataMock).toHaveBeenCalledTimes(1);
        });

        it('reports a localized slug conflict on duplicate-key insert errors', async () => {
            const err = Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
            insertMock.mockReturnValueOnce({ values: vi.fn().mockRejectedValue(err) });

            await expect(createSmartCollection(validFormData())).resolves.toEqual({ error: 'slugAlreadyExists' });
            expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
        });
    });

    describe('updateSmartCollection', () => {
        it('rejects when requireSameOriginAdmin returns a failure', async () => {
            requireSameOriginAdminMock.mockResolvedValueOnce('crossOriginRejected');

            await expect(updateSmartCollection(5, validFormData())).resolves.toEqual({ error: 'crossOriginRejected' });
            expect(updateMock).not.toHaveBeenCalled();
        });

        it('rejects an invalid id before touching the database', async () => {
            await expect(updateSmartCollection(0, validFormData())).resolves.toEqual({ error: 'invalidInput' });
            expect(updateMock).not.toHaveBeenCalled();
        });

        it('updates the row when the id matches', async () => {
            const updateChain = makeUpdateChain([{ affectedRows: 1 }]);
            updateMock.mockReturnValueOnce(updateChain);

            await expect(updateSmartCollection(5, validFormData())).resolves.toEqual({ success: true });
            expect(updateChain.set).toHaveBeenCalledWith({
                slug: 'travel-2026',
                name: 'Travel 2026',
                query_json: VALID_QUERY_JSON,
                is_public: true,
            });
            expect(revalidateAllAppDataMock).toHaveBeenCalledTimes(1);
        });

        it('reports invalidInput when no row matches the id', async () => {
            updateMock.mockReturnValueOnce(makeUpdateChain([{ affectedRows: 0 }]));

            await expect(updateSmartCollection(999, validFormData())).resolves.toEqual({ error: 'invalidInput' });
            expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
        });
    });

    describe('deleteSmartCollection', () => {
        it('rejects when the caller is not an admin', async () => {
            isAdminMock.mockResolvedValueOnce(false);

            await expect(deleteSmartCollection(5)).resolves.toEqual({ error: 'unauthorized' });
            expect(deleteMock).not.toHaveBeenCalled();
        });

        it('deletes the row when it exists', async () => {
            deleteMock.mockReturnValueOnce(makeWriteChain([{ affectedRows: 1 }]));

            await expect(deleteSmartCollection(5)).resolves.toEqual({ success: true });
            expect(revalidateAllAppDataMock).toHaveBeenCalledTimes(1);
        });

        it('returns invalidInput when deleting a nonexistent id, matching actual implementation behavior', async () => {
            deleteMock.mockReturnValueOnce(makeWriteChain([{ affectedRows: 0 }]));

            await expect(deleteSmartCollection(999)).resolves.toEqual({ error: 'invalidInput' });
            expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
        });

        it('rejects a non-positive id before querying the database', async () => {
            await expect(deleteSmartCollection(-1)).resolves.toEqual({ error: 'invalidInput' });
            expect(deleteMock).not.toHaveBeenCalled();
        });
    });
});
