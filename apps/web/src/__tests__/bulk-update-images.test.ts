/**
 * US-P41: Tests for bulkUpdateImages server action.
 * Covers:
 *  - tri-state diff applier (leave / set / clear per field)
 *  - transactional rollback path (any DB error rolls back all changes)
 *  - validation guards (IDs, field lengths, enum values)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    isAdminMock,
    getTranslationsMock,
    requireSameOriginAdminMock,
    dbUpdateMock,
    dbInsertMock,
    dbDeleteMock,
    dbSelectMock,
    transactionMock,
    revalidateAllAppDataMock,
    logAuditEventMock,
    getCurrentUserMock,
    ensureTagRecordMock,
    findTagRecordByNameOrSlugMock,
} = vi.hoisted(() => ({
    isAdminMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    requireSameOriginAdminMock: vi.fn(),
    dbUpdateMock: vi.fn(),
    dbInsertMock: vi.fn(),
    dbDeleteMock: vi.fn(),
    dbSelectMock: vi.fn(),
    transactionMock: vi.fn(),
    revalidateAllAppDataMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    ensureTagRecordMock: vi.fn(),
    findTagRecordByNameOrSlugMock: vi.fn(),
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

vi.mock('@/lib/revalidation', () => ({
    revalidateAllAppData: revalidateAllAppDataMock,
    revalidateLocalizedPaths: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/tag-records', () => ({
    ensureTagRecord: ensureTagRecordMock,
    findTagRecordByNameOrSlug: findTagRecordByNameOrSlugMock,
    getTagSlug: (name: string) => name.toLowerCase().replace(/\s+/g, '-'),
}));

// Build a chainable Drizzle mock for update().set().where()
function makeUpdateChain(affectedRows = 1) {
    const whereMock = vi.fn().mockResolvedValue([{ affectedRows }]);
    const setMock = vi.fn().mockReturnValue({ where: whereMock });
    return { set: setMock, _where: whereMock };
}

// Build a chainable mock for select().from().where().limit()
function makeSelectChain(result: unknown[]) {
    const limitMock = vi.fn().mockResolvedValue(result);
    const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
    const fromMock = vi.fn().mockReturnValue({ where: whereMock });
    return { from: fromMock };
}

vi.mock('@/db', () => ({
    db: {
        update: dbUpdateMock,
        insert: dbInsertMock,
        delete: dbDeleteMock,
        select: dbSelectMock,
        transaction: transactionMock,
    },
    images: { id: 'images.id', topic: 'images.topic' },
    imageTags: { imageId: 'image_tags.image_id', tagId: 'image_tags.tag_id' },
    topics: { slug: 'topics.slug' },
    sharedGroups: {},
    sharedGroupImages: {},
}));

import { bulkUpdateImages } from '@/app/actions/images';
import type { BulkUpdateImagesInput } from '@/lib/bulk-edit-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<BulkUpdateImagesInput> = {}): BulkUpdateImagesInput {
    return {
        ids: [1, 2, 3],
        topic: { mode: 'leave' },
        titlePrefix: { mode: 'leave' },
        description: { mode: 'leave' },
        licenseTier: { mode: 'leave' },
        addTagNames: [],
        removeTagNames: [],
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
    isAdminMock.mockReset();
    getCurrentUserMock.mockReset();
    requireSameOriginAdminMock.mockReset();
    getTranslationsMock.mockReset();
    revalidateAllAppDataMock.mockReset();
    logAuditEventMock.mockReset();
    transactionMock.mockReset();
    dbSelectMock.mockReset();
    ensureTagRecordMock.mockReset();
    findTagRecordByNameOrSlugMock.mockReset();

    isAdminMock.mockResolvedValue(true);
    getCurrentUserMock.mockResolvedValue({ id: 1 });
    requireSameOriginAdminMock.mockResolvedValue(null);
    getTranslationsMock.mockResolvedValue((key: string) => key);
    revalidateAllAppDataMock.mockReturnValue(undefined);
    logAuditEventMock.mockResolvedValue(undefined);
    ensureTagRecordMock.mockResolvedValue({ kind: 'found', tag: { id: 10, name: 'nature', slug: 'nature' } });
    findTagRecordByNameOrSlugMock.mockResolvedValue({ kind: 'found', tag: { id: 10, name: 'nature', slug: 'nature' } });

    // Default: transaction executes the callback
    transactionMock.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
        const updateChain = makeUpdateChain();
        const tx = {
            update: vi.fn(() => updateChain),
            insert: vi.fn(() => ({ ignore: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })) })),
            delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([{ affectedRows: 1 }]) })),
            select: vi.fn(() => makeSelectChain([{ slug: 'travel' }])),
        };
        await cb(tx);
    });

    // Default select for topic existence check
    dbSelectMock.mockReturnValue(makeSelectChain([{ slug: 'travel' }]));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('bulkUpdateImages — auth guards', () => {
    it('returns error when requireSameOriginAdmin fails', async () => {
        requireSameOriginAdminMock.mockResolvedValue('cross-origin');
        const res = await bulkUpdateImages(makeInput());
        expect(res).toEqual({ error: 'cross-origin' });
        expect(transactionMock).not.toHaveBeenCalled();
    });

    it('returns unauthorized when isAdmin returns false', async () => {
        isAdminMock.mockResolvedValue(false);
        const res = await bulkUpdateImages(makeInput());
        expect(res).toEqual({ error: 'unauthorized' });
        expect(transactionMock).not.toHaveBeenCalled();
    });
});

describe('bulkUpdateImages — input validation', () => {
    it('rejects empty ids array', async () => {
        const res = await bulkUpdateImages(makeInput({ ids: [] }));
        expect(res).toEqual({ error: 'noImagesSelected' });
    });

    it('rejects ids array exceeding 100', async () => {
        const res = await bulkUpdateImages(makeInput({ ids: Array.from({ length: 101 }, (_, i) => i + 1) }));
        expect(res).toEqual({ error: 'tooManyImages' });
    });

    it('rejects non-positive integer id', async () => {
        const res = await bulkUpdateImages(makeInput({ ids: [1, -1] }));
        expect(res).toEqual({ error: 'invalidImageId' });
    });

    it('rejects title prefix exceeding 255 code points', async () => {
        const res = await bulkUpdateImages(makeInput({
            titlePrefix: { mode: 'set', value: 'a'.repeat(256) },
        }));
        expect(res).toEqual({ error: 'titleTooLong' });
    });

    it('rejects description exceeding 5000 code points', async () => {
        const res = await bulkUpdateImages(makeInput({
            description: { mode: 'set', value: 'a'.repeat(5001) },
        }));
        expect(res).toEqual({ error: 'descriptionTooLong' });
    });

    it('rejects invalid license tier value', async () => {
        const res = await bulkUpdateImages(makeInput({
            // @ts-expect-error — intentionally passing invalid value
            licenseTier: { mode: 'set', value: 'piracy' },
        }));
        expect(res).toEqual({ error: 'invalidInput' });
    });

    it('rejects invalid topic slug format', async () => {
        const res = await bulkUpdateImages(makeInput({
            topic: { mode: 'set', value: 'INVALID SLUG!' },
        }));
        expect(res).toEqual({ error: 'invalidTopicFormat' });
    });

    it('rejects topic not found in DB', async () => {
        dbSelectMock.mockReturnValueOnce(makeSelectChain([]));
        const res = await bulkUpdateImages(makeInput({
            topic: { mode: 'set', value: 'nonexistent' },
        }));
        expect(res).toEqual({ error: 'topicNotFound' });
    });
});

describe('bulkUpdateImages — tri-state diff applier', () => {
    it('calls transaction and returns success when all fields are leave', async () => {
        const res = await bulkUpdateImages(makeInput());
        expect(res).toEqual({ success: true, count: 3 });
        expect(transactionMock).toHaveBeenCalledOnce();
    });

    it('passes set topic value into the transaction UPDATE', async () => {
        let capturedSetClause: Record<string, unknown> | null = null;
        transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
            const updateChain = { set: vi.fn() };
            updateChain.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
            const tx = {
                update: vi.fn(() => updateChain),
                insert: vi.fn(() => ({ ignore: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })) })),
                delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
                select: vi.fn(() => makeSelectChain([{ slug: 'travel' }])),
            };
            await cb(tx);
            capturedSetClause = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
        });

        dbSelectMock.mockReturnValueOnce(makeSelectChain([{ slug: 'travel' }]));

        const res = await bulkUpdateImages(makeInput({
            topic: { mode: 'set', value: 'travel' },
            licenseTier: { mode: 'set', value: 'commercial' },
        }));

        expect(res).toEqual({ success: true, count: 3 });
        expect(capturedSetClause).toMatchObject({ topic: 'travel', license_tier: 'commercial' });
    });

    it('passes null for clear title and description', async () => {
        let capturedSetClause: Record<string, unknown> | null = null;
        transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
            const updateChain = { set: vi.fn() };
            updateChain.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
            const tx = {
                update: vi.fn(() => updateChain),
                insert: vi.fn(() => ({ ignore: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })) })),
                delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
                select: vi.fn(() => makeSelectChain([{ slug: 'travel' }])),
            };
            await cb(tx);
            capturedSetClause = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
        });

        const res = await bulkUpdateImages(makeInput({
            titlePrefix: { mode: 'clear' },
            description: { mode: 'clear' },
        }));

        expect(res).toEqual({ success: true, count: 3 });
        expect(capturedSetClause).toMatchObject({ title: null, description: null });
    });

    it('does NOT include topic key in setClause when mode is leave', async () => {
        let capturedSetClause: Record<string, unknown> | null = null;
        transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
            const updateChain = { set: vi.fn() };
            updateChain.set.mockReturnValue({ where: vi.fn().mockResolvedValue([]) });
            const tx = {
                update: vi.fn(() => updateChain),
                insert: vi.fn(() => ({ ignore: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })) })),
                delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
                select: vi.fn(() => makeSelectChain([])),
            };
            await cb(tx);
            if (updateChain.set.mock.calls.length > 0) {
                capturedSetClause = updateChain.set.mock.calls[0]?.[0] as Record<string, unknown>;
            }
        });

        const res = await bulkUpdateImages(makeInput({ titlePrefix: { mode: 'set', value: 'hello' } }));
        expect(res).toEqual({ success: true, count: 3 });
        // topic is leave — must not appear in the set clause
        expect(capturedSetClause).not.toHaveProperty('topic');
        expect(capturedSetClause).toHaveProperty('title', 'hello');
    });

    it('skips the UPDATE entirely when all scalar fields are leave', async () => {
        let updateCalled = false;
        transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
            const tx = {
                update: vi.fn(() => { updateCalled = true; return { set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) }; }),
                insert: vi.fn(() => ({ ignore: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })) })),
                delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
                select: vi.fn(() => makeSelectChain([])),
            };
            await cb(tx);
        });

        const res = await bulkUpdateImages(makeInput());
        expect(res).toEqual({ success: true, count: 3 });
        expect(updateCalled).toBe(false);
    });
});

describe('bulkUpdateImages — transactional rollback', () => {
    it('returns error and does not call revalidateAllAppData when transaction throws', async () => {
        transactionMock.mockRejectedValueOnce(new Error('DB connection lost'));

        const res = await bulkUpdateImages(makeInput({
            titlePrefix: { mode: 'set', value: 'hello' },
        }));

        expect(res).toEqual({ error: 'failedToUpdateImage' });
        expect(revalidateAllAppDataMock).not.toHaveBeenCalled();
    });

    it('does not call logAuditEvent when transaction throws', async () => {
        transactionMock.mockRejectedValueOnce(new Error('FK violation'));

        await bulkUpdateImages(makeInput({ licenseTier: { mode: 'set', value: 'editorial' } }));

        expect(logAuditEventMock).not.toHaveBeenCalled();
    });
});

describe('bulkUpdateImages — tag mutations', () => {
    it('calls ensureTagRecord and batch-inserts imageTags for addTagNames', async () => {
        let insertValuesCalled = false;
        transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
            const valuesMock = vi.fn().mockResolvedValue([]);
            insertValuesCalled = false;
            const tx = {
                update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
                insert: vi.fn(() => ({ ignore: vi.fn(() => ({ values: vi.fn(() => { insertValuesCalled = true; return Promise.resolve([]); }) })) })),
                delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })),
                select: vi.fn(() => makeSelectChain([])),
            };
            void valuesMock;
            await cb(tx);
        });

        const res = await bulkUpdateImages(makeInput({ addTagNames: ['nature'] }));
        expect(res).toEqual({ success: true, count: 3 });
        expect(ensureTagRecordMock).toHaveBeenCalledOnce();
        expect(insertValuesCalled).toBe(true);
    });

    it('calls findTagRecordByNameOrSlug and deletes imageTags for removeTagNames', async () => {
        let deleteCalled = false;
        transactionMock.mockImplementationOnce(async (cb: (tx: unknown) => Promise<void>) => {
            const tx = {
                update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
                insert: vi.fn(() => ({ ignore: vi.fn(() => ({ values: vi.fn().mockResolvedValue([]) })) })),
                delete: vi.fn(() => ({ where: vi.fn(() => { deleteCalled = true; return Promise.resolve([{ affectedRows: 3 }]); }) })),
                select: vi.fn(() => makeSelectChain([])),
            };
            await cb(tx);
        });

        const res = await bulkUpdateImages(makeInput({ removeTagNames: ['nature'] }));
        expect(res).toEqual({ success: true, count: 3 });
        expect(findTagRecordByNameOrSlugMock).toHaveBeenCalledOnce();
        expect(deleteCalled).toBe(true);
    });
});
