/**
 * C2-09 (run-10 c2): logAuditEvent is a fire-and-forget writer whose callers
 * use `.catch(console.debug)` — so a failed audit write during a
 * security-relevant action (login, password change, restore) was invisible
 * in production logs. logAuditEvent must now catch internally, report via
 * `console.error`, and never reject.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { dbInsertMock, valuesMock } = vi.hoisted(() => ({
    dbInsertMock: vi.fn(),
    valuesMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        insert: dbInsertMock,
    },
    auditLog: { table: 'audit_log' },
}));

import { logAuditEvent } from '@/lib/audit';

describe('logAuditEvent failure visibility (C2-09)', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        dbInsertMock.mockReset();
        valuesMock.mockReset();
        dbInsertMock.mockReturnValue({ values: valuesMock });
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    it('logs console.error with the action name when the DB insert rejects', async () => {
        const dbError = new Error('connection lost');
        valuesMock.mockRejectedValue(dbError);

        await expect(logAuditEvent(1, 'admin_login', undefined, undefined, '203.0.113.5')).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const [message, err] = errorSpy.mock.calls[0];
        expect(message).toContain('[audit]');
        expect(message).toContain('admin_login');
        expect(err).toBe(dbError);
    });

    it('does not log an error on the success path', async () => {
        valuesMock.mockResolvedValue(undefined);

        await logAuditEvent(1, 'admin_login', undefined, undefined, '203.0.113.5');

        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('never rejects, even when the DB insert repeatedly fails', async () => {
        valuesMock.mockRejectedValue(new Error('db down'));

        await expect(
            Promise.all([
                logAuditEvent(1, 'password_change'),
                logAuditEvent(2, 'restore_db'),
            ]),
        ).resolves.toEqual([undefined, undefined]);

        expect(errorSpy).toHaveBeenCalledTimes(2);
    });
});
