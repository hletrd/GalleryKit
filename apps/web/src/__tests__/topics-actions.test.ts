import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    selectMock,
    insertMock,
    updateMock,
    deleteMock,
    transactionMock,
    executeMock,
    getConnectionMock,
    lockQueryMock,
    releaseLockQueryMock,
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
    executeMock: vi.fn(),
    getConnectionMock: vi.fn(),
    lockQueryMock: vi.fn(),
    releaseLockQueryMock: vi.fn(),
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
        execute: executeMock,
    },
    connection: {
        getConnection: getConnectionMock,
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

// C2R-02: mock the same-origin guard so topic-action unit tests don't need a
// live request scope. Production callers still enforce the check.
vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn(async () => null),
}));

import { createTopic, createTopicAlias, deleteTopicAlias, updateTopic } from '@/app/actions/topics';

describe('topic actions', () => {
    beforeEach(() => {
        selectMock.mockReset();
        insertMock.mockReset();
        updateMock.mockReset();
        deleteMock.mockReset();
        transactionMock.mockReset();
        executeMock.mockReset();
        getConnectionMock.mockReset();
        lockQueryMock.mockReset();
        releaseLockQueryMock.mockReset();
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
        const queryMock = vi.fn(async (sql: string) => {
            if (sql.includes('GET_LOCK')) {
                return [[{ acquired: 1 }]];
            }
            if (sql.includes('RELEASE_LOCK')) {
                return [[{ released: 1 }]];
            }
            return [[]];
        });
        lockQueryMock.mockImplementation(queryMock);
        releaseLockQueryMock.mockImplementation(queryMock);
        getConnectionMock.mockResolvedValue({
            query: vi.fn(async (sql: string) => {
                if (sql.includes('GET_LOCK')) {
                    return lockQueryMock(sql);
                }
                if (sql.includes('RELEASE_LOCK')) {
                    return releaseLockQueryMock(sql);
                }
                return [[]];
            }),
            release: vi.fn(),
        });
    });

    it('rejects createTopic when the requested slug already exists as an alias route', async () => {
        // C3L-CR-02: topicRouteSegmentExists now uses db.execute with UNION query
        executeMock.mockResolvedValueOnce([{ found: 1 }]);

        const formData = new FormData();
        formData.set('label', 'Travel');
        formData.set('slug', 'travel');
        formData.set('order', '0');

        await expect(createTopic(formData)).resolves.toEqual({ error: 'slugConflictsWithRoute' });
        expect(processTopicImageMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
        expect(lockQueryMock).toHaveBeenCalled();
    });

    it('rejects createTopic with invalidLabel when the label contains control characters', async () => {
        const formData = new FormData();
        formData.set('label', 'Travel\u0000');
        formData.set('slug', 'travel');
        formData.set('order', '0');

        await expect(createTopic(formData)).resolves.toEqual({ error: 'invalidLabel' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    // C5L-SEC-01: parity with topic-alias (C3L-SEC-01) and tag-name
    // (C4L-SEC-01) Unicode-formatting rejection. Labels render in admin
    // tables, public navigation, and OG previews; bidi/invisible chars
    // would otherwise enable visual spoofing.
    it('rejects createTopic with invalidLabel when the label contains a Unicode bidi override', async () => {
        const formData = new FormData();
        formData.set('label', 'Travel‮2026'); // RLO override
        formData.set('slug', 'travel');
        formData.set('order', '0');

        await expect(createTopic(formData)).resolves.toEqual({ error: 'invalidLabel' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects createTopic with invalidLabel when the label contains a zero-width space', async () => {
        const formData = new FormData();
        formData.set('label', 'Travel​2026'); // ZWSP
        formData.set('slug', 'travel');
        formData.set('order', '0');

        await expect(createTopic(formData)).resolves.toEqual({ error: 'invalidLabel' });
        expect(selectMock).not.toHaveBeenCalled();
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

        // C3L-CR-02: topicRouteSegmentExists now uses db.execute with UNION query
        // First call: topicRouteSegmentExists('new-topic') → no conflict (empty array)
        executeMock.mockResolvedValueOnce([]);
        selectMock
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'old-topic.webp' }]))
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

    it('reports aliasNotFound when deleting a stale alias affects no rows', async () => {
        deleteMock.mockReturnValueOnce(makeWriteChain([{ affectedRows: 0 }]));

        await expect(deleteTopicAlias('travel', 'stale-alias')).resolves.toEqual({ error: 'aliasNotFound' });
    });

    it('serializes alias creation behind the shared route lock before inserting', async () => {
        // C3L-CR-02: topicRouteSegmentExists now uses db.execute with UNION query
        executeMock.mockResolvedValueOnce([]);
        insertMock.mockReturnValueOnce(makeWriteChain([{ insertId: 1 }]));

        await expect(createTopicAlias('travel', 'night')).resolves.toEqual({ success: true });
        expect(lockQueryMock).toHaveBeenCalled();
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(releaseLockQueryMock).toHaveBeenCalled();
    });

    it('rejects updateTopic with invalidLabel when the label contains control characters', async () => {
        const formData = new FormData();
        formData.set('label', 'Updated\u0000');
        formData.set('slug', 'travel');
        formData.set('order', '0');

        await expect(updateTopic('travel', formData)).resolves.toEqual({ error: 'invalidLabel' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
    });

    // C5L-SEC-01: updateTopic must reject Unicode bidi/invisible chars in
    // labels for parity with createTopic.
    it('rejects updateTopic with invalidLabel when the label contains a Unicode bidi override', async () => {
        const formData = new FormData();
        formData.set('label', 'Updated‮Reversed'); // RLO override
        formData.set('slug', 'travel');
        formData.set('order', '0');

        await expect(updateTopic('travel', formData)).resolves.toEqual({ error: 'invalidLabel' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(updateMock).not.toHaveBeenCalled();
    });

    it('rejects createTopicAlias when the alias matches a reserved locale segment', async () => {
        await expect(createTopicAlias('travel', 'ko')).resolves.toEqual({ error: 'reservedRouteSegment' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });
});
