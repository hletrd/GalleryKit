import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    selectMock,
    insertMock,
    updateMock,
    deleteMock,
    transactionMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    processTopicImageMock,
    deleteTopicImageMock,
    revalidateLocalizedPathsMock,
    revalidateAllAppDataMock,
    logAuditEventMock,
    maintenanceMessageMock,
} = vi.hoisted(() => ({
    selectMock: vi.fn(),
    insertMock: vi.fn(),
    updateMock: vi.fn(),
    deleteMock: vi.fn(),
    transactionMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    processTopicImageMock: vi.fn(),
    deleteTopicImageMock: vi.fn(),
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

vi.mock('@/db', () => ({
    db: {
        select: selectMock,
        insert: insertMock,
        update: updateMock,
        delete: deleteMock,
        transaction: transactionMock,
    },
    topics: {
        slug: 'topics.slug',
        image_filename: 'topics.image_filename',
    },
    topicAliases: {
        alias: 'topic_aliases.alias',
        topicSlug: 'topic_aliases.topic_slug',
    },
    images: {
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

vi.mock('@/lib/process-topic-image', () => ({
    processTopicImage: processTopicImageMock,
    deleteTopicImage: deleteTopicImageMock,
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

import { createTopic, createTopicAlias, deleteTopicAlias, updateTopic } from '@/app/actions/topics';

describe('topic actions', () => {
    beforeEach(() => {
        selectMock.mockReset();
        insertMock.mockReset();
        updateMock.mockReset();
        deleteMock.mockReset();
        transactionMock.mockReset();
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 1 });
        getTranslationsMock.mockResolvedValue((key: string) => key);
        processTopicImageMock.mockReset();
        deleteTopicImageMock.mockReset();
        revalidateLocalizedPathsMock.mockReset();
        revalidateAllAppDataMock.mockReset();
        logAuditEventMock.mockReset();
        logAuditEventMock.mockResolvedValue(undefined);
        maintenanceMessageMock.mockReturnValue(null);
    });

    it('rejects createTopic when the requested slug already exists as an alias route', async () => {
        selectMock
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([{ alias: 'travel' }]));

        const formData = new FormData();
        formData.set('label', 'Travel');
        formData.set('slug', 'travel');
        formData.set('order', '0');

        await expect(createTopic(formData)).resolves.toEqual({ error: 'slugConflictsWithRoute' });
        expect(processTopicImageMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects createTopic when the slug matches a reserved locale segment', async () => {
        const formData = new FormData();
        formData.set('label', 'English');
        formData.set('slug', 'en');
        formData.set('order', '0');

        await expect(createTopic(formData)).resolves.toEqual({ error: 'reservedRouteSegment' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('renames topics by inserting the replacement row before moving child references', async () => {
        const steps: string[] = [];

        selectMock
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'old-topic.webp' }]))
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([]));

        transactionMock.mockImplementation(async (callback: (tx: {
            select: typeof selectMock;
            insert: typeof insertMock;
            update: typeof updateMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            const txSelect = vi.fn().mockReturnValue(makeSelectChain([{ slug: 'old-topic' }]));
            const txInsert = vi.fn(() => {
                steps.push('insert-topic');
                return makeWriteChain([{ insertId: 12 }]);
            });
            const txUpdate = vi.fn((table: { topic?: string }) => {
                steps.push(table.topic === 'images.topic' ? 'update-images' : 'update-aliases');
                return makeUpdateChain([{ affectedRows: 1 }]);
            });
            const txDelete = vi.fn(() => {
                steps.push('delete-topic');
                return makeWriteChain([{ affectedRows: 1 }]);
            });

            await callback({
                select: txSelect,
                insert: txInsert,
                update: txUpdate,
                delete: txDelete,
            });
        });

        const formData = new FormData();
        formData.set('label', 'New Topic');
        formData.set('slug', 'new-topic');
        formData.set('order', '5');

        await expect(updateTopic('old-topic', formData)).resolves.toEqual({ success: true });
        expect(steps).toEqual(['insert-topic', 'update-images', 'update-aliases', 'delete-topic']);
    });

    it('allows deleting legacy dotted aliases even though new ones are rejected', async () => {
        deleteMock.mockReturnValueOnce(makeWriteChain([{ affectedRows: 1 }]));

        await expect(deleteTopicAlias('travel', 'tokyo.2026')).resolves.toEqual({ success: true });
        expect(deleteMock).toHaveBeenCalledTimes(1);
    });

    it('rejects createTopicAlias when the alias matches a reserved locale segment', async () => {
        await expect(createTopicAlias('travel', 'ko')).resolves.toEqual({ error: 'reservedRouteSegment' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });
});
