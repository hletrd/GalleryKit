import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    selectQueue,
    updateMock,
    transactionMock,
    deleteMock,
    insertMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    headersMock,
    getClientIpMock,
    checkRateLimitMock,
    decrementRateLimitMock,
    getRateLimitBucketStartMock,
    incrementRateLimitMock,
    isRateLimitExceededMock,
    revalidateLocalizedPathsMock,
    logAuditEventMock,
    maintenanceMessageMock,
    generateBase56Mock,
} = vi.hoisted(() => ({
    selectQueue: [] as unknown[][],
    updateMock: vi.fn(),
    transactionMock: vi.fn(),
    deleteMock: vi.fn(),
    insertMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    headersMock: vi.fn(),
    getClientIpMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    decrementRateLimitMock: vi.fn(),
    getRateLimitBucketStartMock: vi.fn(),
    incrementRateLimitMock: vi.fn(),
    isRateLimitExceededMock: vi.fn(),
    revalidateLocalizedPathsMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
    generateBase56Mock: vi.fn(),
}));

function makeSelectChain() {
    return {
        from: vi.fn(() => ({
            where: vi.fn(async () => selectQueue.shift() ?? []),
        })),
    };
}

function makeUpdateChain(result: unknown) {
    return {
        set: vi.fn(() => ({
            where: vi.fn(async () => result),
        })),
    };
}

function makeInsertChain(result: unknown) {
    return {
        values: vi.fn(async () => result),
    };
}

vi.mock('@/db', () => ({
    db: {
        select: vi.fn(makeSelectChain),
        update: updateMock,
        transaction: transactionMock,
        delete: deleteMock,
        insert: insertMock,
    },
    images: {
        id: 'images.id',
        share_key: 'images.share_key',
        processed: 'images.processed',
    },
    sharedGroups: {
        id: 'shared_groups.id',
        key: 'shared_groups.key',
    },
    sharedGroupImages: {
        groupId: 'shared_group_images.group_id',
        imageId: 'shared_group_images.image_id',
        position: 'shared_group_images.position',
    },
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: getCurrentUserMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

vi.mock('next/headers', () => ({
    headers: headersMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    getClientIp: getClientIpMock,
    checkRateLimit: checkRateLimitMock,
    decrementRateLimit: decrementRateLimitMock,
    getRateLimitBucketStart: getRateLimitBucketStartMock,
    incrementRateLimit: incrementRateLimitMock,
    isRateLimitExceeded: isRateLimitExceededMock,
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateLocalizedPaths: revalidateLocalizedPathsMock,
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn(async () => null),
}));

vi.mock('@/lib/base56', () => ({
    generateBase56: generateBase56Mock,
}));

import { createGroupShareLink, createPhotoShareLink, deleteGroupShareLink, revokePhotoShareLink } from '@/app/actions/sharing';

describe('sharing actions behavior', () => {
    beforeEach(() => {
        selectQueue.length = 0;
        updateMock.mockReset();
        transactionMock.mockReset();
        deleteMock.mockReset();
        insertMock.mockReset();
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 1 });
        getTranslationsMock.mockResolvedValue((key: string) => key);
        headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue(null) });
        getClientIpMock.mockReturnValue('203.0.113.5');
        checkRateLimitMock.mockResolvedValue({ count: 1 });
        decrementRateLimitMock.mockResolvedValue(undefined);
        getRateLimitBucketStartMock.mockReturnValue(123);
        incrementRateLimitMock.mockResolvedValue(undefined);
        isRateLimitExceededMock.mockReturnValue(false);
        revalidateLocalizedPathsMock.mockReset();
        logAuditEventMock.mockReset();
        logAuditEventMock.mockResolvedValue(undefined);
        maintenanceMessageMock.mockReturnValue(null);
        generateBase56Mock.mockReturnValue('sharekey01');
    });

    it('rolls back share counters when a concurrent photo-share winner is returned', async () => {
        selectQueue.push(
            [{ id: 9, share_key: null, processed: true }],
            [{ share_key: 'winner-key' }],
        );
        updateMock.mockReturnValueOnce(makeUpdateChain([{ affectedRows: 0 }]));

        await expect(createPhotoShareLink(9)).resolves.toEqual({ success: true, key: 'winner-key' });

        expect(decrementRateLimitMock).toHaveBeenCalledWith('203.0.113.5', 'share_photo', 60_000, 123);
        expect(logAuditEventMock).not.toHaveBeenCalled();
        expect(revalidateLocalizedPathsMock).not.toHaveBeenCalled();
    });

    it('creates a group share transaction with ordered links, audit, and home revalidation', async () => {
        selectQueue.push([{ id: 1, processed: true }, { id: 2, processed: true }]);
        const txInsert = vi.fn()
            .mockReturnValueOnce(makeInsertChain([{ insertId: 77 }]))
            .mockReturnValueOnce(makeInsertChain([{ affectedRows: 2 }]));
        transactionMock.mockImplementationOnce(async (callback: (tx: { insert: typeof txInsert }) => Promise<string>) => (
            callback({ insert: txInsert })
        ));

        await expect(createGroupShareLink([1, 2])).resolves.toEqual({ success: true, key: 'sharekey01' });

        expect(txInsert).toHaveBeenCalledTimes(2);
        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/');
        expect(logAuditEventMock).toHaveBeenCalledWith(1, 'group_share_create', 'shared_group', undefined, undefined, {
            keyFingerprint: expect.any(String),
            keyLength: 10,
            imageCount: 2,
        });
    });

    it('revokes a photo share only when the selected key still matches', async () => {
        selectQueue.push([{ id: 9, share_key: 'old-key' }]);
        updateMock.mockReturnValueOnce(makeUpdateChain([{ affectedRows: 1 }]));

        await expect(revokePhotoShareLink(9)).resolves.toEqual({ success: true });

        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/p/9', '/s/old-key', '/admin/dashboard');
        expect(logAuditEventMock).toHaveBeenCalledWith(1, 'share_revoke', 'image', '9', undefined, {
            keyFingerprint: expect.any(String),
            keyLength: 7,
        });
    });

    it('deletes shared group image rows before the group row and records postconditions', async () => {
        selectQueue.push([{ key: 'group-key' }]);
        const childDeleteWhere = vi.fn(async () => [{ affectedRows: 2 }]);
        const groupDeleteWhere = vi.fn(async () => [{ affectedRows: 1 }]);
        const txDelete = vi.fn()
            .mockReturnValueOnce({ where: childDeleteWhere })
            .mockReturnValueOnce({ where: groupDeleteWhere });
        transactionMock.mockImplementationOnce(async (callback: (tx: { delete: typeof txDelete }) => Promise<void>) => {
            await callback({ delete: txDelete });
        });

        await expect(deleteGroupShareLink(77)).resolves.toEqual({ success: true });

        expect(childDeleteWhere.mock.invocationCallOrder[0]).toBeLessThan(groupDeleteWhere.mock.invocationCallOrder[0]);
        expect(revalidateLocalizedPathsMock).toHaveBeenCalledWith('/', '/g/group-key', '/admin/dashboard');
        expect(logAuditEventMock).toHaveBeenCalledWith(1, 'group_share_delete', 'shared_group', '77', undefined, {
            keyFingerprint: expect.any(String),
            keyLength: 9,
        });
    });
});
