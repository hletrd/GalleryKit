import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    argonVerifyMock,
    argonHashMock,
    cookiesMock,
    headersMock,
    cookieGetMock,
    cookieSetMock,
    cookieDeleteMock,
    redirectMock,
    unstableRethrowMock,
    dbSelectMock,
    dbTransactionMock,
    dbDeleteMock,
    dbDeleteWhereMock,
    dbInsertValuesMock,
    hasTrustedSameOriginMock,
    getTrustedRequestProtocolMock,
    getClientIpMock,
    incrementRateLimitMock,
    checkRateLimitMock,
    verifySessionTokenMock,
    generateSessionTokenMock,
    hashSessionTokenMock,
    getRestoreMaintenanceMessageMock,
    acquireAdminMutationSlotMock,
    enqueuePendingSessionRevocationMock,
    loginRateLimitMap,
    accountLoginRateLimitMap,
} = vi.hoisted(() => ({
    argonVerifyMock: vi.fn(),
    argonHashMock: vi.fn(),
    cookiesMock: vi.fn(),
    headersMock: vi.fn(),
    cookieGetMock: vi.fn(),
    cookieSetMock: vi.fn(),
    cookieDeleteMock: vi.fn(),
    redirectMock: vi.fn(),
    unstableRethrowMock: vi.fn(),
    dbSelectMock: vi.fn(),
    dbTransactionMock: vi.fn(),
    dbDeleteMock: vi.fn(),
    dbDeleteWhereMock: vi.fn(),
    dbInsertValuesMock: vi.fn(),
    hasTrustedSameOriginMock: vi.fn(),
    getTrustedRequestProtocolMock: vi.fn(),
    getClientIpMock: vi.fn(),
    incrementRateLimitMock: vi.fn(),
    checkRateLimitMock: vi.fn(),
    verifySessionTokenMock: vi.fn(),
    generateSessionTokenMock: vi.fn(),
    hashSessionTokenMock: vi.fn(),
    getRestoreMaintenanceMessageMock: vi.fn(),
    acquireAdminMutationSlotMock: vi.fn(),
    enqueuePendingSessionRevocationMock: vi.fn(),
    loginRateLimitMap: new Map<string, { count: number; lastAttempt: number }>(),
    accountLoginRateLimitMap: new Map<string, { count: number; lastAttempt: number }>(),
}));

vi.mock('argon2', () => ({
    default: { hash: argonHashMock, verify: argonVerifyMock },
    argon2id: 2,
    hash: argonHashMock,
    verify: argonVerifyMock,
}));

vi.mock('next/headers', () => ({
    cookies: cookiesMock,
    headers: headersMock,
}));

vi.mock('next/navigation', () => ({
    redirect: redirectMock,
    unstable_rethrow: unstableRethrowMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

vi.mock('@/db', () => ({
    db: {
        select: dbSelectMock,
        transaction: dbTransactionMock,
        delete: dbDeleteMock,
    },
    adminUsers: {
        id: 'admin_users.id',
        username: 'admin_users.username',
        password_hash: 'admin_users.password_hash',
        created_at: 'admin_users.created_at',
    },
    sessions: {
        id: 'sessions.id',
        userId: 'sessions.user_id',
        expiresAt: 'sessions.expires_at',
    },
}));

vi.mock('@/lib/session', () => ({
    COOKIE_NAME: 'admin_session',
    verifySessionToken: verifySessionTokenMock,
    generateSessionToken: generateSessionTokenMock,
    hashSessionToken: hashSessionTokenMock,
}));

vi.mock('@/lib/request-origin', () => ({
    hasTrustedSameOrigin: hasTrustedSameOriginMock,
    getTrustedRequestProtocol: getTrustedRequestProtocolMock,
}));

vi.mock('@/lib/rate-limit', () => ({
    getClientIp: getClientIpMock,
    pruneLoginRateLimit: vi.fn(),
    LOGIN_MAX_ATTEMPTS: 5,
    LOGIN_WINDOW_MS: 900_000,
    checkRateLimit: checkRateLimitMock,
    incrementRateLimit: incrementRateLimitMock,
    loginRateLimit: loginRateLimitMap,
    buildAccountRateLimitKey: (username: string) => `acct:${username}`,
    isRateLimitExceeded: (count: number, max: number, includesCurrent = false) => (
        includesCurrent ? count > max : count >= max
    ),
    getRateLimitBucketStart: vi.fn(() => 1_700_000_000),
}));

vi.mock('@/lib/auth-rate-limit', () => ({
    clearSuccessfulLoginAttempts: vi.fn(async () => undefined),
    getLoginRateLimitEntry: vi.fn((key: string) => loginRateLimitMap.get(key) ?? { count: 0, lastAttempt: 0 }),
    getAccountLoginRateLimitEntry: vi.fn((key: string) => accountLoginRateLimitMap.get(key) ?? { count: 0, lastAttempt: 0 }),
    clearSuccessfulAccountLoginAttempts: vi.fn(async () => undefined),
    accountLoginRateLimit: accountLoginRateLimitMap,
    rollbackLoginRateLimit: vi.fn(async () => undefined),
    rollbackAccountLoginRateLimit: vi.fn(async () => undefined),
    pruneAccountLoginRateLimit: vi.fn(),
    clearSuccessfulPasswordAttempts: vi.fn(async () => undefined),
    getPasswordChangeRateLimitEntry: vi.fn(() => ({ count: 0, lastAttempt: 0 })),
    passwordChangeRateLimit: new Map(),
    prunePasswordChangeRateLimit: vi.fn(),
    PASSWORD_CHANGE_MAX_ATTEMPTS: 10,
    rollbackPasswordChangeRateLimit: vi.fn(async () => undefined),
}));

vi.mock('@/lib/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }));
vi.mock('@/lib/restore-maintenance', () => ({ getRestoreMaintenanceMessage: getRestoreMaintenanceMessageMock }));
vi.mock('@/lib/admin-mutation-barrier', () => ({ acquireAdminMutationSlot: acquireAdminMutationSlotMock }));
vi.mock('@/lib/pending-session-revocations', () => ({ enqueuePendingSessionRevocation: enqueuePendingSessionRevocationMock }));

import { login, logout, updatePassword } from '@/app/actions/auth';

function form(fields: Record<string, string>) {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
}

let selectRows: unknown[][];

function setupSelectQueue(...rows: unknown[][]) {
    selectRows = [...rows];
    dbSelectMock.mockImplementation(() => ({
        from: vi.fn(() => ({
            where: vi.fn(() => {
                const selectedRows = selectRows.shift() ?? [];
                const result = Promise.resolve(selectedRows) as Promise<unknown[]> & {
                    limit: ReturnType<typeof vi.fn>;
                };
                result.limit = vi.fn(async () => selectedRows);
                return result;
            }),
        })),
    }));
}

describe('auth server-action behavior locks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loginRateLimitMap.clear();
        accountLoginRateLimitMap.clear();
        selectRows = [];
        headersMock.mockResolvedValue(new Headers({
            origin: 'https://gallery.example',
            host: 'gallery.example',
            'x-forwarded-proto': 'https',
        }));
        cookiesMock.mockResolvedValue({
            get: cookieGetMock,
            set: cookieSetMock,
            delete: cookieDeleteMock,
        });
        cookieGetMock.mockReturnValue({ value: 'session-token' });
        hasTrustedSameOriginMock.mockReturnValue(true);
        getTrustedRequestProtocolMock.mockReturnValue('https');
        getClientIpMock.mockReturnValue('203.0.113.50');
        incrementRateLimitMock.mockResolvedValue(undefined);
        checkRateLimitMock.mockResolvedValue({ count: 1, limited: false });
        argonVerifyMock.mockResolvedValue(true);
        argonHashMock.mockResolvedValue('$argon2id$dummy');
        generateSessionTokenMock.mockResolvedValue('new-session-token');
        hashSessionTokenMock.mockReturnValue('hashed-session-token');
        verifySessionTokenMock.mockResolvedValue({ userId: 7 });
        getRestoreMaintenanceMessageMock.mockReturnValue(null);
        acquireAdminMutationSlotMock.mockImplementation(() => ({
            acquired: true,
            [Symbol.dispose]: () => {},
        }));
        dbDeleteWhereMock.mockResolvedValue(undefined);
        dbDeleteMock.mockReturnValue({ where: dbDeleteWhereMock });
        dbInsertValuesMock.mockResolvedValue([{ insertId: 1 }]);
        dbTransactionMock.mockImplementation(async (callback: (tx: {
            insert: typeof dbDeleteMock;
            delete: typeof dbDeleteMock;
            update: typeof dbDeleteMock;
        }) => unknown) => callback({
            insert: vi.fn(() => ({ values: dbInsertValuesMock })),
            delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
            update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) })),
        }));
        redirectMock.mockImplementation((target: string) => {
            throw new Error(`NEXT_REDIRECT:${target}`);
        });
        unstableRethrowMock.mockImplementation((err: unknown) => {
            if (err instanceof Error && err.message.startsWith('NEXT_REDIRECT:')) throw err;
        });
    });

    it('login rejects hostile origins before user lookup or Argon2 work', async () => {
        hasTrustedSameOriginMock.mockReturnValue(false);

        await expect(login(null, form({
            username: 'admin',
            password: 'correct horse battery staple',
            locale: 'en',
        }))).resolves.toEqual({ error: 'authFailed' });

        expect(dbSelectMock).not.toHaveBeenCalled();
        expect(argonVerifyMock).not.toHaveBeenCalled();
        expect(incrementRateLimitMock).not.toHaveBeenCalled();
    });

    it('logout rejects hostile origins before session verification or deletion', async () => {
        hasTrustedSameOriginMock.mockReturnValue(false);

        await expect(logout(form({ locale: 'en' }))).rejects.toThrow('NEXT_REDIRECT:/en/admin');

        expect(verifySessionTokenMock).not.toHaveBeenCalled();
        expect(dbDeleteMock).not.toHaveBeenCalled();
        expect(cookieDeleteMock).not.toHaveBeenCalled();
    });

    it('updatePassword rejects hostile origins before password verification or transaction', async () => {
        hasTrustedSameOriginMock.mockReturnValue(false);

        await expect(updatePassword(null, form({
            currentPassword: 'old-password-value',
            newPassword: 'new-password-value',
            confirmPassword: 'new-password-value',
        }))).resolves.toEqual({ error: 'unauthorized' });

        expect(verifySessionTokenMock).not.toHaveBeenCalled();
        expect(dbSelectMock).not.toHaveBeenCalled();
        expect(argonVerifyMock).not.toHaveBeenCalled();
        expect(dbTransactionMock).not.toHaveBeenCalled();
    });

    it('updatePassword short-circuits restore maintenance before session or password DB work', async () => {
        getRestoreMaintenanceMessageMock.mockReturnValue('restore in progress');

        await expect(updatePassword(null, form({
            currentPassword: 'old-password-value',
            newPassword: 'new-password-value',
            confirmPassword: 'new-password-value',
        }))).resolves.toEqual({ error: 'restore in progress' });

        expect(verifySessionTokenMock).not.toHaveBeenCalled();
        expect(dbSelectMock).not.toHaveBeenCalled();
        expect(argonVerifyMock).not.toHaveBeenCalled();
        expect(dbTransactionMock).not.toHaveBeenCalled();
    });

    // AGG8b-21 / TEST8-01 (run-10 c8b): behavioral locks for the C7-01
    // pending-revocation wiring — every skipped/failed DB-side session
    // delete MUST queue the token hash; a successful delete must NOT.
    it('logout during a restore window skips the DB delete and queues the revocation', async () => {
        getRestoreMaintenanceMessageMock.mockReturnValue('restore in progress');

        await expect(logout(form({ locale: 'en' }))).rejects.toThrow('NEXT_REDIRECT:/en/admin');

        expect(dbDeleteMock).not.toHaveBeenCalled();
        expect(enqueuePendingSessionRevocationMock).toHaveBeenCalledWith('hashed-session-token');
        expect(cookieDeleteMock).toHaveBeenCalledWith({ name: 'admin_session', path: '/' });
    });

    it('logout without an admin mutation slot skips the DB delete and queues the revocation', async () => {
        acquireAdminMutationSlotMock.mockImplementation(() => ({
            acquired: false,
            [Symbol.dispose]: () => {},
        }));

        await expect(logout(form({ locale: 'en' }))).rejects.toThrow('NEXT_REDIRECT:/en/admin');

        expect(dbDeleteMock).not.toHaveBeenCalled();
        expect(enqueuePendingSessionRevocationMock).toHaveBeenCalledWith('hashed-session-token');
        expect(cookieDeleteMock).toHaveBeenCalledWith({ name: 'admin_session', path: '/' });
    });

    it('logout queues the revocation when the DB delete itself throws', async () => {
        dbDeleteWhereMock.mockRejectedValue(new Error('connection lost'));

        await expect(logout(form({ locale: 'en' }))).rejects.toThrow('NEXT_REDIRECT:/en/admin');

        expect(dbDeleteMock).toHaveBeenCalledTimes(1);
        expect(enqueuePendingSessionRevocationMock).toHaveBeenCalledWith('hashed-session-token');
        expect(cookieDeleteMock).toHaveBeenCalledWith({ name: 'admin_session', path: '/' });
    });

    it('logout does NOT queue a revocation when the DB delete succeeds', async () => {
        await expect(logout(form({ locale: 'en' }))).rejects.toThrow('NEXT_REDIRECT:/en/admin');

        expect(dbDeleteMock).toHaveBeenCalledTimes(1);
        expect(enqueuePendingSessionRevocationMock).not.toHaveBeenCalled();
        expect(cookieDeleteMock).toHaveBeenCalledWith({ name: 'admin_session', path: '/' });
    });

    it('sets a Secure session cookie for trusted HTTPS login requests', async () => {
        setupSelectQueue([{ id: 7, username: 'admin', password_hash: '$argon2id$real' }]);

        await expect(login(null, form({
            username: 'admin',
            password: 'correct horse battery staple',
            locale: 'en',
        }))).rejects.toThrow('NEXT_REDIRECT:/en/admin/dashboard');

        expect(cookieSetMock).toHaveBeenCalledWith('admin_session', 'new-session-token', expect.objectContaining({
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        }));
    });

    it('advances the account fallback when the durable IP increment rejects', async () => {
        setupSelectQueue([{ id: 7, username: 'admin', password_hash: '$argon2id$real' }]);
        argonVerifyMock.mockResolvedValue(false);
        incrementRateLimitMock
            .mockRejectedValueOnce(new Error('database unavailable'))
            .mockResolvedValueOnce(undefined);

        await expect(login(null, form({
            username: 'admin',
            password: 'wrong password value',
            locale: 'en',
        }))).resolves.toEqual({ error: 'invalidCredentials' });

        expect(accountLoginRateLimitMap.get('acct:admin')?.count).toBe(1);
        expect(incrementRateLimitMock).toHaveBeenCalledTimes(2);
    });
});
