import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    selectMock,
    insertMock,
    deleteMock,
    transactionMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    revalidateLocalizedPathsMock,
    revalidateAllAppDataMock,
    logAuditEventMock,
    maintenanceMessageMock,
} = vi.hoisted(() => ({
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    deleteMock: vi.fn(),
    transactionMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    revalidateLocalizedPathsMock: vi.fn(),
    revalidateAllAppDataMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
}));

function makeAwaitable<T>(result: T) {
    return {
        then: Promise.resolve(result).then.bind(Promise.resolve(result)),
    };
}

function makeSelectChain<T>(result: T) {
    const query = {
        limit: vi.fn().mockResolvedValue(result),
        ...makeAwaitable(result),
    };

    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(query),
        }),
    };
}

function makeInsertChain<T>(result: T) {
    return {
        ignore: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue(result),
        }),
        values: vi.fn().mockResolvedValue(result),
    };
}

function makeDeleteChain<T>(result: T) {
    return {
        where: vi.fn().mockResolvedValue(result),
    };
}

vi.mock('@/db', () => ({
    db: {
        select: selectMock,
        insert: insertMock,
        delete: deleteMock,
        transaction: transactionMock,
    },
    tags: {
        id: 'tags.id',
        name: 'tags.name',
        slug: 'tags.slug',
    },
    imageTags: {
        imageId: 'image_tags.image_id',
        tagId: 'image_tags.tag_id',
    },
    images: {
        id: 'images.id',
        topic: 'images.topic',
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
    revalidateLocalizedPaths: revalidateLocalizedPathsMock,
    revalidateAllAppData: revalidateAllAppDataMock,
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

import { addTagToImage, batchAddTags, batchUpdateImageTags } from '@/app/actions/tags';

describe('tag actions', () => {
    beforeEach(() => {
        selectMock.mockReset();
        insertMock.mockReset();
        deleteMock.mockReset();
        transactionMock.mockReset();
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 1 });
        getTranslationsMock.mockResolvedValue((key: string, values?: Record<string, string>) => (
            values ? `${key}:${JSON.stringify(values)}` : key
        ));
        revalidateLocalizedPathsMock.mockReset();
        revalidateAllAppDataMock.mockReset();
        logAuditEventMock.mockReset();
        logAuditEventMock.mockResolvedValue(undefined);
        maintenanceMessageMock.mockReturnValue(null);
    });

    it('returns imageNotFound before tagging when the target image no longer exists', async () => {
        selectMock.mockReturnValueOnce(makeSelectChain([]));

        await expect(addTagToImage(42, 'Nature')).resolves.toEqual({ error: 'imageNotFound' });
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects batchAddTags when the requested tag collides with another tag slug', async () => {
        insertMock.mockReturnValueOnce(makeInsertChain([{ affectedRows: 0 }]));
        selectMock
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([{ id: 7, name: 'c', slug: 'c' }]));

        const result = await batchAddTags([1], 'C++');

        expect(result.error).toContain('tagSlugCollision');
    });

    it('warns and skips colliding tag additions in batchUpdateImageTags instead of linking the wrong tag', async () => {
        transactionMock.mockImplementation(async (callback: (tx: {
            select: typeof selectMock;
            insert: typeof insertMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            const txSelect = vi.fn()
                .mockReturnValueOnce(makeSelectChain([{ topic: 'travel' }]))
                .mockReturnValueOnce(makeSelectChain([]))
                .mockReturnValueOnce(makeSelectChain([{ id: 7, name: 'c', slug: 'c' }]));
            const txInsert = vi.fn()
                .mockReturnValueOnce(makeInsertChain([{ affectedRows: 0 }]));
            const txDelete = vi.fn().mockReturnValue(makeDeleteChain([{ affectedRows: 0 }]));

            await callback({
                select: txSelect,
                insert: txInsert,
                delete: txDelete,
            });
        });

        const result = await batchUpdateImageTags(5, ['C++'], []);

        expect(result.success).toBe(true);
        expect(result.added).toBe(0);
        expect(result.warnings.join(' ')).toContain('tagSlugCollision');
    });
});
