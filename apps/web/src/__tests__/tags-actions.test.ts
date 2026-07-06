import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    selectMock,
    updateMock,
    insertMock,
    deleteMock,
    executeMock,
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
    updateMock: vi.fn(),
    insertMock: vi.fn(),
    deleteMock: vi.fn(),
    executeMock: vi.fn(),
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

// C2-17 (run-10 c2): `drizzle-orm` is NOT mocked in this file, so `sql\`...\``
// calls in tags.ts produce real drizzle SQL objects with a public
// `queryChunks` array (StringChunk pieces interleaved with raw interpolated
// values). These helpers let tests assert on the join-UPDATE's shape and
// bound tag id without needing to mock the `sql` tag itself.
function collectSqlChunks(value: unknown): unknown[] {
    return (value as { queryChunks: unknown[] }).queryChunks;
}

function sqlKeywords(value: unknown): string {
    return collectSqlChunks(value)
        .filter((chunk): chunk is { value: string[] } => (
            !!chunk && typeof chunk === 'object' && Array.isArray((chunk as { value?: unknown }).value)
        ))
        .map((chunk) => chunk.value.join(''))
        .join('');
}

vi.mock('@/db', () => ({
    db: {
        select: selectMock,
        update: updateMock,
        insert: insertMock,
        delete: deleteMock,
        execute: executeMock,
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
        updated_at: 'images.updated_at',
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

// C2R-02: mock the same-origin guard so tag-action unit tests don't need a
// live request scope. Production callers still enforce the check.
vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn(async () => null),
}));

import { addTagToImage, batchAddTags, batchUpdateImageTags, deleteTag, updateTag } from '@/app/actions/tags';

describe('tag actions', () => {
    beforeEach(() => {
        selectMock.mockReset();
        updateMock.mockReset();
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
        updateMock.mockReturnValue({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]),
            }),
        });
    });

    it('returns imageNotFound before tagging when the target image no longer exists', async () => {
        selectMock.mockReturnValueOnce(makeSelectChain([]));

        await expect(addTagToImage(42, 'Nature')).resolves.toEqual({ error: 'imageNotFound' });
        expect(insertMock).not.toHaveBeenCalled();
    });

    it('updates a tag with audit, dashboard revalidation, and a join-UPDATE timestamp touch', async () => {
        const txTagUpdateWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
        const txExecute = vi.fn().mockResolvedValue([{}]);
        selectMock.mockReturnValueOnce(makeSelectChain([{ id: 7 }]));
        transactionMock.mockImplementation(async (callback: (tx: {
            update: typeof updateMock;
            execute: typeof executeMock;
        }) => Promise<void>) => {
            const txUpdate = vi.fn().mockReturnValueOnce({
                set: vi.fn().mockReturnValue({
                    where: txTagUpdateWhere,
                }),
            });

            await callback({
                update: txUpdate,
                execute: txExecute,
            });
        });

        await expect(updateTag(7, 'Night Sky')).resolves.toEqual({ success: true });

        expect(logAuditEventMock).toHaveBeenCalledWith(1, 'tag_update', 'tag', '7', undefined, {
            name: 'Night Sky',
            slug: 'night-sky',
        });
        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/admin/tags', '/admin/dashboard', '/');
        expect(txTagUpdateWhere).toHaveBeenCalled();

        // C2-17 (run-10 c2): a single join-UPDATE replaces the SELECT-all-tagged
        // image ids + UPDATE ... IN pair — assert the join-UPDATE ran with the
        // right shape and tag id binding instead of a second .update() call.
        expect(txExecute).toHaveBeenCalledTimes(1);
        const [sqlArg] = txExecute.mock.calls[0];
        expect(sqlKeywords(sqlArg)).toMatch(/UPDATE[\s\S]*JOIN[\s\S]*SET[\s\S]*WHERE/);
        expect(collectSqlChunks(sqlArg)).toContain(7);
    });

    it('skips the join-UPDATE when the tag row was not actually updated', async () => {
        const txTagUpdateWhere = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
        const txExecute = vi.fn().mockResolvedValue([{}]);
        selectMock.mockReturnValueOnce(makeSelectChain([{ id: 7 }]));
        transactionMock.mockImplementation(async (callback: (tx: {
            update: typeof updateMock;
            execute: typeof executeMock;
        }) => Promise<void>) => {
            const txUpdate = vi.fn().mockReturnValueOnce({
                set: vi.fn().mockReturnValue({
                    where: txTagUpdateWhere,
                }),
            });

            await callback({
                update: txUpdate,
                execute: txExecute,
            });
        });

        await expect(updateTag(7, 'Night Sky')).resolves.toEqual({ error: 'tagNotFound' });

        expect(txExecute).not.toHaveBeenCalled();
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it('does not audit or revalidate updateTag failures before mutation', async () => {
        selectMock.mockReturnValueOnce(makeSelectChain([]));

        await expect(updateTag(7, 'Night Sky')).resolves.toEqual({ error: 'tagNotFound' });

        expect(transactionMock).not.toHaveBeenCalled();
        expect(logAuditEventMock).not.toHaveBeenCalled();
        expect(revalidateLocalizedPathsMock).not.toHaveBeenCalled();
    });

    it('touches images via a join-UPDATE BEFORE deleting image_tags rows, then audits and revalidates', async () => {
        const callOrder: string[] = [];
        const txExecute = vi.fn().mockImplementation(async () => {
            callOrder.push('execute');
            return [{}];
        });
        const txImageTagsDeleteWhere = vi.fn().mockImplementation(async () => {
            callOrder.push('delete-image-tags');
            return [{ affectedRows: 3 }];
        });
        const txTagDeleteWhere = vi.fn().mockImplementation(async () => {
            callOrder.push('delete-tag');
            return [{ affectedRows: 1 }];
        });
        transactionMock.mockImplementation(async (callback: (tx: {
            execute: typeof executeMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            const txDelete = vi.fn()
                .mockReturnValueOnce({ where: txImageTagsDeleteWhere })
                .mockReturnValueOnce({ where: txTagDeleteWhere });

            await callback({
                execute: txExecute,
                delete: txDelete,
            });
        });

        await expect(deleteTag(7)).resolves.toEqual({ success: true });

        // C2-17 (run-10 c2): the join-UPDATE reads image_tags as its row
        // source, so it MUST run before those rows are deleted below.
        expect(callOrder).toEqual(['execute', 'delete-image-tags', 'delete-tag']);

        const [sqlArg] = txExecute.mock.calls[0];
        expect(sqlKeywords(sqlArg)).toMatch(/UPDATE[\s\S]*JOIN[\s\S]*SET[\s\S]*WHERE/);
        expect(collectSqlChunks(sqlArg)).toContain(7);

        expect(logAuditEventMock).toHaveBeenCalledWith(1, 'tag_delete', 'tag', '7');
        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/admin/tags', '/admin/dashboard', '/');
    });

    it('reports tagNotFound and skips audit when deleteTag affects no rows', async () => {
        const txExecute = vi.fn().mockResolvedValue([{}]);
        const txImageTagsDeleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
        const txTagDeleteWhere = vi.fn().mockResolvedValue([{ affectedRows: 0 }]);
        transactionMock.mockImplementation(async (callback: (tx: {
            execute: typeof executeMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            const txDelete = vi.fn()
                .mockReturnValueOnce({ where: txImageTagsDeleteWhere })
                .mockReturnValueOnce({ where: txTagDeleteWhere });

            await callback({
                execute: txExecute,
                delete: txDelete,
            });
        });

        await expect(deleteTag(7)).resolves.toEqual({ error: 'tagNotFound' });

        expect(logAuditEventMock).not.toHaveBeenCalled();
        expect(revalidateLocalizedPathsMock).not.toHaveBeenCalled();
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

    it('rejects malformed batchUpdateImageTags payloads before starting a transaction', async () => {
        const result = await batchUpdateImageTags(
            5,
            'not-an-array' as unknown as string[],
            ['valid'],
        );

        expect(result).toEqual({
            success: false,
            added: 0,
            removed: 0,
            warnings: ['invalidInput'],
        });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    it('rejects batchUpdateImageTags when removeTagNames is a string', async () => {
        const result = await batchUpdateImageTags(
            5,
            ['valid'],
            'not-an-array' as unknown as string[],
        );

        expect(result).toEqual({
            success: false,
            added: 0,
            removed: 0,
            warnings: ['invalidInput'],
        });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    // AGG13-01: verify that batchUpdateImageTags does NOT log a tags_batch_update
    // audit event when all tag operations are no-ops (added === 0 && removed === 0).
    // This is the same class as AGG10-01 (addTagToImage), AGG11-01
    // (removeTagFromImage), and AGG12-01 (batchAddTags) but the batch-update
    // counterpart was not gated. The audit event should only fire when at least
    // one tag was actually added or removed.
    it('does not log tags_batch_update audit event when added === 0 && removed === 0', async () => {
        // Simulate a transaction where all tag names are rejected by requireCleanInput
        // (e.g., they contain control characters), so added === 0 && removed === 0.
        transactionMock.mockImplementation(async (callback: (tx: {
            select: typeof selectMock;
            insert: typeof insertMock;
            delete: typeof deleteMock;
        }) => Promise<void>) => {
            const txSelect = vi.fn()
                .mockReturnValueOnce(makeSelectChain([{ topic: 'travel' }]));
            // No insert or delete calls because all tag names are invalid and skipped
            const txInsert = vi.fn();
            const txDelete = vi.fn();

            await callback({
                select: txSelect,
                insert: txInsert,
                delete: txDelete,
            });
        });

        // Pass tag names with control characters that requireCleanInput will reject
        const result = await batchUpdateImageTags(5, ['\x00evil'], []);

        expect(result.success).toBe(true);
        expect(result.added).toBe(0);
        expect(result.removed).toBe(0);
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });
});
