import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * COR-R4C10-01 behavioral coverage.
 *
 * `audit_log.user_id → admin_users.id` is ON DELETE NO ACTION, and every
 * successful login writes audit_log(user_id=self), so deleting an admin who
 * has ever logged in failed with MySQL errno 1451 (empirically reproduced
 * against MySQL 8). The fix detaches the target's audit rows
 * (UPDATE audit_log SET user_id = NULL WHERE user_id = ?) INSIDE the
 * advisory-locked transaction, BEFORE the admin-row delete.
 *
 * This test pins the query order: the audit detach must precede the
 * admin_users delete (omitting it reintroduces the FK-1451 break).
 */

const {
    getTranslationsMock,
    getCurrentUserMock,
    requireSameOriginAdminMock,
    maintenanceMessageMock,
    logAuditEventMock,
    revalidateLocalizedPathsMock,
    getConnectionMock,
} = vi.hoisted(() => ({
    getTranslationsMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    requireSameOriginAdminMock: vi.fn(),
    maintenanceMessageMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    revalidateLocalizedPathsMock: vi.fn(),
    getConnectionMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {},
    connection: { getConnection: getConnectionMock },
    adminUsers: {},
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: vi.fn(async () => true),
    getCurrentUser: getCurrentUserMock,
}));

vi.mock('next-intl/server', () => ({ getTranslations: getTranslationsMock }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));
vi.mock('@/lib/audit', () => ({ logAuditEvent: logAuditEventMock }));
vi.mock('@/lib/revalidation', () => ({ revalidateLocalizedPaths: revalidateLocalizedPathsMock }));
vi.mock('@/lib/restore-maintenance', () => ({ getRestoreMaintenanceMessage: maintenanceMessageMock }));
vi.mock('@/lib/action-guards', () => ({ requireSameOriginAdmin: requireSameOriginAdminMock }));

import { deleteAdminUser } from '@/app/actions/admin-users';

const TARGET_ID = 5;

/** A connection mock that records every conn.query SQL and answers the
 *  fixed sequence deleteAdminUser issues (lock → count → target → ...). */
function makeConn() {
    const sqls: string[] = [];
    const params: unknown[][] = [];
    const conn = {
        query: vi.fn(async (sql: string, p?: unknown[]) => {
            sqls.push(sql);
            params.push(p ?? []);
            if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }]];
            if (sql.includes('COUNT(*)')) return [[{ count: 2 }]]; // not the last admin
            if (sql.startsWith('SELECT id FROM admin_users')) return [[{ id: TARGET_ID }]];
            if (sql.startsWith('DELETE FROM admin_users')) return [{ affectedRows: 1 }];
            return [{ affectedRows: 1 }];
        }),
        beginTransaction: vi.fn(async () => {}),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
        release: vi.fn(() => {}),
    };
    return { conn, sqls, params };
}

describe('deleteAdminUser audit detach (COR-R4C10-01)', () => {
    beforeEach(() => {
        getTranslationsMock.mockResolvedValue((key: string) => key);
        getCurrentUserMock.mockResolvedValue({ id: 1 }); // acting admin ≠ target
        requireSameOriginAdminMock.mockResolvedValue(null);
        maintenanceMessageMock.mockReturnValue(null);
        logAuditEventMock.mockResolvedValue(undefined);
        revalidateLocalizedPathsMock.mockReset();
    });

    it('NULLs the target audit_log rows BEFORE deleting the admin row', async () => {
        const { conn, sqls, params } = makeConn();
        getConnectionMock.mockResolvedValue(conn);

        await expect(deleteAdminUser(TARGET_ID)).resolves.toEqual({ success: true });

        const detachIdx = sqls.findIndex((s) => /UPDATE audit_log SET user_id = NULL WHERE user_id = \?/.test(s));
        const deleteIdx = sqls.findIndex((s) => s.startsWith('DELETE FROM admin_users'));

        // The detach must exist and precede the admin delete (without it the
        // real DELETE throws errno 1451 for any admin with audit history).
        expect(detachIdx).toBeGreaterThanOrEqual(0);
        expect(deleteIdx).toBeGreaterThanOrEqual(0);
        expect(detachIdx).toBeLessThan(deleteIdx);

        // Detach is parameterized with the target id (no SQL injection surface).
        expect(params[detachIdx]).toEqual([TARGET_ID]);
        expect(conn.commit).toHaveBeenCalledTimes(1);
        expect(conn.release).toHaveBeenCalledTimes(1);
    });
});
