import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    insertMock,
    isAdminMock,
    getCurrentUserMock,
    getTranslationsMock,
    headersMock,
    getClientIpMock,
    checkRateLimitMock,
    incrementRateLimitMock,
    isRateLimitExceededMock,
    resetRateLimitMock,
    logAuditEventMock,
    revalidateLocalizedPathsMock,
    maintenanceMessageMock,
    argon2HashMock,
} = vi.hoisted(() => ({
    insertMock: vi.fn(),
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    headersMock: vi.fn(),
    getClientIpMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    incrementRateLimitMock: vi.fn(),
    isRateLimitExceededMock: vi.fn(),
    resetRateLimitMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    revalidateLocalizedPathsMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
    argon2HashMock: vi.fn(),
}));

function makeInsertChain<T>(result: T) {
    return {
        values: vi.fn().mockResolvedValue(result),
    };
}

vi.mock('argon2', () => ({
    hash: argon2HashMock,
    argon2id: 'argon2id',
}));

vi.mock('@/db', () => ({
    db: {
        insert: insertMock,
    },
    connection: {},
    adminUsers: {},
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
    incrementRateLimit: incrementRateLimitMock,
    isRateLimitExceeded: isRateLimitExceededMock,
    resetRateLimit: resetRateLimitMock,
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateLocalizedPaths: revalidateLocalizedPathsMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    getRestoreMaintenanceMessage: maintenanceMessageMock,
}));

// C2R-02: mock the same-origin guard so admin-user unit tests don't need a
// live request scope. Production callers still enforce the check.
vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn(async () => null),
}));

import { createAdminUser } from '@/app/actions/admin-users';

describe('createAdminUser', () => {
    beforeEach(() => {
        insertMock.mockReset();
        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 1 });
        getTranslationsMock.mockResolvedValue((key: string) => key);
        headersMock.mockResolvedValue({ get: vi.fn().mockReturnValue(null) });
        getClientIpMock.mockReturnValue('203.0.113.5');
        checkRateLimitMock.mockResolvedValue({ count: 1 });
        incrementRateLimitMock.mockResolvedValue(undefined);
        isRateLimitExceededMock.mockReturnValue(false);
        resetRateLimitMock.mockResolvedValue(undefined);
        logAuditEventMock.mockResolvedValue(undefined);
        revalidateLocalizedPathsMock.mockReset();
        maintenanceMessageMock.mockReturnValue(null);
        argon2HashMock.mockResolvedValue('hashed-password');
    });

    it('rejects mismatched password confirmation before hashing or inserting', async () => {
        insertMock.mockReturnValue(makeInsertChain([{ insertId: 1 }]));

        const formData = new FormData();
        formData.set('username', 'new-admin');
        formData.set('password', 'CorrectHorseBatteryStaple!');
        formData.set('confirmPassword', 'CorrectHorseBatteryStaple?');

        await expect(createAdminUser(formData)).resolves.toEqual({ error: 'passwordsDoNotMatch' });
        expect(argon2HashMock).not.toHaveBeenCalled();
        expect(insertMock).not.toHaveBeenCalled();
    });
});
