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
        // `.from(x)` is awaitable directly (e.g. the DBG-16-03 smart-collections
        // scan does `await tx.select({...}).from(smartCollections)` with no
        // `.where()`), and still chains `.where().limit()` for filtered reads.
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(query),
            ...makeAwaitable(result),
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
        map_visible: 'topics.map_visible',
    },
    topicAliases: {
        alias: 'topic_aliases.alias',
        topicSlug: 'topic_aliases.topic_slug',
    },
    images: {
        topic: 'images.topic',
    },
    topicViews: {
        topic: 'topic_views.topic',
    },
    smartCollections: {
        id: 'smart_collections.id',
        query_json: 'smart_collections.query_json',
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

import { createTopic, createTopicAlias, deleteTopic, deleteTopicAlias, setTopicMapVisible, updateTopic } from '@/app/actions/topics';

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
        // C3L-CR-02: topicRouteSegmentExists now uses db.execute with UNION query.
        // COR-R4C19-01: the mock MUST be the runtime-accurate mysql2
        // `[rows, fields]` tuple — drizzle's raw db.execute never returns a
        // bare rows array. Bare-array mocks previously green-lit code that
        // failed on every real request.
        executeMock.mockResolvedValueOnce([[{ found: 1 }], []]);

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
        const insertedPayloads: unknown[] = [];

        // C3L-CR-02: topicRouteSegmentExists now uses db.execute with UNION query
        // First call: topicRouteSegmentExists('new-topic') → no conflict.
        // COR-R4C19-01: runtime-accurate mysql2 tuple — zero rows is
        // `[[], []]`, NOT `[]`. This assertion failed pre-fix (the tuple's
        // length 2 was read as a conflict).
        executeMock.mockResolvedValueOnce([[], []]);
        selectMock
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'old-topic.webp' }]))
            .mockReturnValueOnce(makeSelectChain([]));

        transactionMock.mockImplementation(async (callback: (tx: {
            select: typeof selectMock;
            insert: typeof insertMock;
            update: typeof updateMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            // COR-R4C13-01: the authoritative pre-rename row is read INSIDE
            // the transaction and must carry map_visible + image_filename
            // into the replacement insert.
            const txSelect = vi.fn().mockReturnValue(makeSelectChain([{
                slug: 'old-topic',
                image_filename: 'old-topic.webp',
                map_visible: true,
            }]));
            const txInsert = vi.fn(() => {
                steps.push('insert-topic');
                return {
                    values: vi.fn((payload: unknown) => {
                        insertedPayloads.push(payload);
                        return Promise.resolve([{ insertId: 12 }]);
                    }),
                };
            });
            const txUpdate = vi.fn((table: { topic?: string }) => {
                if (table.topic === 'images.topic') {
                    steps.push('update-images');
                } else if (table.topic === 'topic_views.topic') {
                    steps.push('update-views');
                } else {
                    steps.push('update-aliases');
                }
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
        // DBG-16-01: topic_views is re-pointed (update-views) BEFORE the delete so
        // the ON DELETE CASCADE never wipes the analytics history.
        expect(steps).toEqual(['insert-topic', 'update-images', 'update-aliases', 'update-views', 'delete-topic']);
        // COR-R4C13-01: the replacement row must carry EVERY non-form topics
        // column from the authoritative transaction-selected row. This is an
        // exact-object assertion on purpose: when a new topics column is
        // added to the schema, this test must be updated consciously — a
        // silent DEFAULT reset (the map_visible bug) can never ship again.
        expect(insertedPayloads).toEqual([{
            label: 'New Topic',
            slug: 'new-topic',
            order: 5,
            image_filename: 'old-topic.webp',
            map_visible: true,
        }]);
    });

    it('re-points smart-collection topic predicates to the new slug inside the rename transaction (DBG-16-03)', async () => {
        // Gap identified in cycle-17 TE audit: the txSelect mock in the existing
        // rename test returns objects without `query_json`, so the for-loop body
        // `typeof collection.query_json !== 'string'` always triggers `continue`
        // and the tx.update(smartCollections) write-back is NEVER reached.
        // Removing the entire loop from topics.ts would not fail any prior test.
        // This test puts a real query_json string through the loop and verifies
        // the updated AST (with the new slug) is written back inside the transaction.
        const collectionUpdates: Array<{ query_json: string }> = [];

        executeMock.mockResolvedValueOnce([[], []]);
        selectMock
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'old-topic.webp' }]))
            .mockReturnValueOnce(makeSelectChain([]));

        transactionMock.mockImplementation(async (callback: (tx: {
            select: typeof selectMock;
            insert: typeof insertMock;
            update: typeof updateMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            // Use mockReturnValueOnce to return different results for the two
            // tx.select() calls inside the rename transaction:
            //   1st call: read the authoritative topic row (for the replacement insert)
            //   2nd call: scan smart_collections for rules that reference the old slug
            const txSelect = vi.fn()
                .mockReturnValueOnce(makeSelectChain([{
                    slug: 'old-topic',
                    image_filename: 'old-topic.webp',
                    map_visible: false,
                }]))
                .mockReturnValueOnce(makeSelectChain([{
                    id: 99,
                    // This is the key: a string query_json that references the old slug.
                    // The existing rename test used an object without query_json, so
                    // `typeof collection.query_json !== 'string'` was always true and
                    // the write-back was never reached.
                    query_json: JSON.stringify({
                        type: 'predicate',
                        column: 'topic',
                        operator: 'eq',
                        value: 'old-topic',
                    }),
                }]));

            const txInsert = vi.fn(() => ({
                values: vi.fn(() => Promise.resolve([{ insertId: 20 }])),
            }));

            // Capture smart-collection updates; delegate everything else to the
            // standard makeUpdateChain helper.
            const txUpdate = vi.fn((table: { topic?: string; id?: string }) => {
                if (table.id === 'smart_collections.id') {
                    return {
                        set: vi.fn((payload: { query_json: string }) => {
                            collectionUpdates.push({ query_json: payload.query_json });
                            return { where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) };
                        }),
                    };
                }
                return makeUpdateChain([{ affectedRows: 1 }]);
            });
            const txDelete = vi.fn(() => makeWriteChain([{ affectedRows: 1 }]));

            await callback({ select: txSelect, insert: txInsert, update: txUpdate, delete: txDelete });
        });

        const formData = new FormData();
        formData.set('label', 'New Topic');
        formData.set('slug', 'new-topic');
        formData.set('order', '5');

        await expect(updateTopic('old-topic', formData)).resolves.toEqual({ success: true });

        // DBG-16-03: exactly one collection write-back was issued with the new slug.
        // A revert that removes the for-loop or the tx.update(smartCollections) call
        // would leave collectionUpdates empty and this assertion would fail.
        expect(collectionUpdates).toHaveLength(1);
        expect(JSON.parse(collectionUpdates[0].query_json)).toEqual({
            type: 'predicate',
            column: 'topic',
            operator: 'eq',
            value: 'new-topic',
        });
    });

    it('carries map_visible while applying a newly uploaded image during a rename', async () => {
        const insertedPayloads: unknown[] = [];

        // COR-R4C19-01: runtime-accurate mysql2 tuple (zero conflict rows).
        executeMock.mockResolvedValueOnce([[], []]);
        selectMock
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'old-topic.webp' }]))
            .mockReturnValueOnce(makeSelectChain([]));
        processTopicImageMock.mockResolvedValue('new-cover.webp');

        transactionMock.mockImplementation(async (callback: (tx: {
            select: typeof selectMock;
            insert: typeof insertMock;
            update: typeof updateMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            const txSelect = vi.fn().mockReturnValue(makeSelectChain([{
                slug: 'old-topic',
                image_filename: 'old-topic.webp',
                map_visible: true,
            }]));
            const txInsert = vi.fn(() => ({
                values: vi.fn((payload: unknown) => {
                    insertedPayloads.push(payload);
                    return Promise.resolve([{ insertId: 13 }]);
                }),
            }));
            const txUpdate = vi.fn(() => makeUpdateChain([{ affectedRows: 1 }]));
            const txDelete = vi.fn(() => makeWriteChain([{ affectedRows: 1 }]));

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
        formData.set('image', new File(['x'], 'cover.jpg', { type: 'image/jpeg' }));

        await expect(updateTopic('old-topic', formData)).resolves.toEqual({ success: true });
        // The NEW image wins over the carried one; map_visible still carries.
        expect(insertedPayloads).toEqual([{
            label: 'New Topic',
            slug: 'new-topic',
            order: 5,
            image_filename: 'new-cover.webp',
            map_visible: true,
        }]);
        // The replaced previous image is cleaned up after the rename commits.
        expect(deleteTopicImageMock).toHaveBeenCalledWith('old-topic.webp');
    });

    it('deletes the locked-row replaced image when the pre-lock cover read is stale', async () => {
        executeMock.mockResolvedValueOnce([[], []]);
        selectMock
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'old-topic.webp' }]))
            .mockReturnValueOnce(makeSelectChain([]));
        processTopicImageMock.mockResolvedValue('new-cover.webp');

        transactionMock.mockImplementation(async (callback: (tx: {
            select: typeof selectMock;
            insert: typeof insertMock;
            update: typeof updateMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            const txSelect = vi.fn().mockReturnValue(makeSelectChain([{
                slug: 'old-topic',
                image_filename: 'concurrent-cover.webp',
                map_visible: true,
            }]));
            await callback({
                select: txSelect,
                insert: vi.fn(() => makeWriteChain([{ insertId: 13 }])),
                update: vi.fn(() => makeUpdateChain([{ affectedRows: 1 }])),
                delete: vi.fn(() => makeWriteChain([{ affectedRows: 1 }])),
            });
        });

        const formData = new FormData();
        formData.set('label', 'New Topic');
        formData.set('slug', 'new-topic');
        formData.set('order', '5');
        formData.set('image', new File(['x'], 'cover.jpg', { type: 'image/jpeg' }));

        await expect(updateTopic('old-topic', formData)).resolves.toEqual({ success: true });
        expect(deleteTopicImageMock).toHaveBeenCalledWith('concurrent-cover.webp');
        expect(deleteTopicImageMock).not.toHaveBeenCalledWith('old-topic.webp');
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
        // C3L-CR-02: topicRouteSegmentExists now uses db.execute with UNION query.
        // COR-R4C19-01: runtime-accurate mysql2 tuple (zero conflict rows) —
        // this assertion failed pre-fix (tuple length 2 read as a conflict).
        executeMock.mockResolvedValueOnce([[], []]);
        insertMock.mockReturnValueOnce(makeWriteChain([{ insertId: 1 }]));

        await expect(createTopicAlias('travel', 'night')).resolves.toEqual({ success: true });
        expect(lockQueryMock).toHaveBeenCalled();
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(releaseLockQueryMock).toHaveBeenCalled();
    });

    it('serializes topic deletion behind the shared route lock before deleting', async () => {
        const txSelectMock = vi
            .fn()
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([{ image_filename: null }]));
        const txDeleteMock = vi.fn().mockReturnValueOnce(makeWriteChain([{ affectedRows: 1 }]));
        transactionMock.mockImplementationOnce(async (callback: (tx: {
            select: typeof txSelectMock;
            delete: typeof txDeleteMock;
        }) => Promise<void>) => callback({
            select: txSelectMock,
            delete: txDeleteMock,
        }));

        await expect(deleteTopic('travel')).resolves.toEqual({ success: true });
        expect(lockQueryMock).toHaveBeenCalled();
        expect(txDeleteMock).toHaveBeenCalledTimes(1);
        expect(releaseLockQueryMock).toHaveBeenCalled();
        expect(lockQueryMock.mock.invocationCallOrder[0]).toBeLessThan(txDeleteMock.mock.invocationCallOrder[0]);
        expect(txDeleteMock.mock.invocationCallOrder[0]).toBeLessThan(releaseLockQueryMock.mock.invocationCallOrder[0]);
    });

    it('blocks topic deletion when a smart collection references the slug', async () => {
        const txSelectMock = vi
            .fn()
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([{
                id: 7,
                query_json: JSON.stringify({
                    type: 'predicate',
                    column: 'topic',
                    operator: 'eq',
                    value: 'travel',
                }),
            }]));
        const txDeleteMock = vi.fn().mockReturnValueOnce(makeWriteChain([{ affectedRows: 1 }]));
        transactionMock.mockImplementationOnce(async (callback: (tx: {
            select: typeof txSelectMock;
            delete: typeof txDeleteMock;
        }) => Promise<void>) => callback({
            select: txSelectMock,
            delete: txDeleteMock,
        }));

        await expect(deleteTopic('travel')).resolves.toEqual({ error: 'cannotDeleteCategoryReferencedByCollection' });
        expect(txDeleteMock).not.toHaveBeenCalled();
    });

    it('blocks topic deletion when a smart collection topic-in predicate includes the slug', async () => {
        const txSelectMock = vi
            .fn()
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([{
                id: 8,
                query_json: JSON.stringify({
                    type: 'predicate',
                    column: 'topic',
                    operator: 'in',
                    values: ['travel', 'street'],
                }),
            }]));
        const txDeleteMock = vi.fn().mockReturnValueOnce(makeWriteChain([{ affectedRows: 1 }]));
        transactionMock.mockImplementationOnce(async (callback: (tx: {
            select: typeof txSelectMock;
            delete: typeof txDeleteMock;
        }) => Promise<void>) => callback({
            select: txSelectMock,
            delete: txDeleteMock,
        }));

        await expect(deleteTopic('travel')).resolves.toEqual({ error: 'cannotDeleteCategoryReferencedByCollection' });
        expect(txDeleteMock).not.toHaveBeenCalled();
    });

    it('blocks topic deletion when a smart collection query cannot be parsed', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const txSelectMock = vi
            .fn()
            .mockReturnValueOnce(makeSelectChain([]))
            .mockReturnValueOnce(makeSelectChain([{
                id: 9,
                query_json: '{not valid json',
            }]));
        const txDeleteMock = vi.fn().mockReturnValueOnce(makeWriteChain([{ affectedRows: 1 }]));
        transactionMock.mockImplementationOnce(async (callback: (tx: {
            select: typeof txSelectMock;
            delete: typeof txDeleteMock;
        }) => Promise<void>) => callback({
            select: txSelectMock,
            delete: txDeleteMock,
        }));

        await expect(deleteTopic('travel')).resolves.toEqual({ error: 'cannotDeleteCategoryDueToInvalidCollectionQuery' });
        expect(txDeleteMock).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('blocking topic deletion'),
            expect.anything(),
        );
        warnSpy.mockRestore();
    });

    it('creates a topic when the route segment is free (COR-R4C19-01)', async () => {
        // Regression lock for the six-week production breakage: drizzle's raw
        // db.execute returns the mysql2 `[rows, fields]` tuple, and the
        // pre-fix `.length > 0` check on the TUPLE reported every segment as
        // conflicting, so createTopic could never succeed. Proven failing
        // against the pre-fix source.
        executeMock.mockResolvedValueOnce([[], []]);
        insertMock.mockReturnValueOnce(makeWriteChain([{ insertId: 7 }]));

        const formData = new FormData();
        formData.set('label', 'Astro');
        formData.set('slug', 'astro');
        formData.set('order', '0');

        await expect(createTopic(formData)).resolves.toEqual({ success: true });
        expect(insertMock).toHaveBeenCalledTimes(1);
        expect(lockQueryMock).toHaveBeenCalled();
        expect(releaseLockQueryMock).toHaveBeenCalled();
    });

    it('parses a scientific-notation order with Number(), not parseInt() (R21C21 T2 / DBG21-01)', async () => {
        // parseInt('1e3', 10) stops at 'e' and returns 1, silently storing the
        // wrong sort order; Number('1e3') === 1000, which the clamp preserves.
        // Discriminator: this assertion FAILS against the pre-fix parseInt source
        // (order would be 1). Same fix lands in updateTopic.
        executeMock.mockResolvedValueOnce([[], []]);
        const writeChain = makeWriteChain([{ insertId: 8 }]);
        insertMock.mockReturnValueOnce(writeChain);

        const formData = new FormData();
        formData.set('label', 'Astro');
        formData.set('slug', 'astro');
        formData.set('order', '1e3');

        await expect(createTopic(formData)).resolves.toEqual({ success: true });
        expect(writeChain.values).toHaveBeenCalledWith(
            expect.objectContaining({ order: 1000 }),
        );
    });

    it('falls back to order 0 for a non-numeric order, rejecting Infinity (R21C21 T2)', async () => {
        // Number('abc') is NaN → !Number.isFinite → 0. Number('1e999') is
        // Infinity → !Number.isFinite → 0 (the old Number.isNaN guard let
        // Infinity through; the clamp masked it, but !Number.isFinite is correct).
        executeMock.mockResolvedValueOnce([[], []]);
        const writeChain = makeWriteChain([{ insertId: 9 }]);
        insertMock.mockReturnValueOnce(writeChain);

        const formData = new FormData();
        formData.set('label', 'Nebula');
        formData.set('slug', 'nebula');
        formData.set('order', 'abc');

        await expect(createTopic(formData)).resolves.toEqual({ success: true });
        expect(writeChain.values).toHaveBeenCalledWith(
            expect.objectContaining({ order: 0 }),
        );
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

    it('parses a scientific-notation order with Number() in updateTopic in-place path (R21C21 T2 / DBG21-01)', async () => {
        // GAP identified in cycle-22 TE audit: the T2 test (line 534) covered
        // createTopic only. The comment said "Same fix lands in updateTopic" but
        // no test called updateTopic with order='1e3'. This closes that gap.
        //
        // Discriminator: parseInt('1e3', 10) === 1, so reverting the
        // Number(orderStr) call in updateTopic would store order=1, not 1000,
        // and the expect.objectContaining({ order: 1000 }) assertion below fails.
        //
        // Uses the in-place update path (slug unchanged): just two db.select
        // calls followed by a db.update — no rename transaction needed.
        const setPayloads: unknown[] = [];
        selectMock
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'cover.webp' }]))
            .mockReturnValueOnce(makeSelectChain([{ slug: 'travel' }]))
            .mockReturnValueOnce(makeSelectChain([{ image_filename: 'cover.webp' }]));
        updateMock.mockReturnValue({
            set: vi.fn((payload: unknown) => {
                setPayloads.push(payload);
                return { where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) };
            }),
        });

        const formData = new FormData();
        formData.set('label', 'Travel');
        formData.set('slug', 'travel'); // same slug → in-place update, no transaction
        formData.set('order', '1e3');

        await expect(updateTopic('travel', formData)).resolves.toEqual({ success: true });
        expect(setPayloads).toHaveLength(1);
        expect(setPayloads[0]).toEqual(expect.objectContaining({ order: 1000 }));
    });

    it('rejects createTopicAlias when the alias matches a reserved locale segment', async () => {
        await expect(createTopicAlias('travel', 'ko')).resolves.toEqual({ error: 'reservedRouteSegment' });
        expect(selectMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('rejects malformed map visibility values before persistence or audit logging', async () => {
        await expect(setTopicMapVisible('travel', 'true' as unknown as boolean)).resolves.toEqual({ error: 'invalidInput' });

        expect(updateMock).not.toHaveBeenCalled();
        expect(logAuditEventMock).not.toHaveBeenCalled();
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
    });
});
