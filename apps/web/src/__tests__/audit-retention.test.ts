/**
 * R4C6 COR-R4C6-10: purgeOldAuditLog retention validation.
 *
 * A negative AUDIT_LOG_RETENTION_DAYS (or negative explicit maxAgeMs)
 * previously produced a FUTURE cutoff — `created_at < cutoff` matched
 * every row and purged the entire audit log. Both inputs must require a
 * finite positive value and fall back to the 90-day default otherwise.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { whereMock, deleteMock, ltMock } = vi.hoisted(() => {
    const whereMock = vi.fn(async () => undefined);
    return {
        whereMock,
        deleteMock: vi.fn(() => ({ where: whereMock })),
        ltMock: vi.fn((col: unknown, cutoff: Date) => ({ col, cutoff })),
    };
});

vi.mock('@/db', () => ({
    db: { insert: vi.fn(), delete: deleteMock },
    auditLog: { created_at: 'audit_log.created_at' },
}));
vi.mock('drizzle-orm', () => ({
    lt: ltMock,
}));

import { purgeOldAuditLog } from '@/lib/audit';

const DAY_MS = 24 * 60 * 60 * 1000;

function lastCutoff(): Date {
    const call = ltMock.mock.calls.at(-1);
    if (!call) throw new Error('lt was not called');
    return call[1] as Date;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T00:00:00Z'));
    whereMock.mockClear();
    deleteMock.mockClear();
    ltMock.mockClear();
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
});

afterEach(() => {
    vi.useRealTimers();
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
});

describe('purgeOldAuditLog retention validation (COR-R4C6-10)', () => {
    it('negative env value falls back to 90 days — cutoff in the PAST, not the future', async () => {
        process.env.AUDIT_LOG_RETENTION_DAYS = '-1';
        await purgeOldAuditLog();
        const cutoff = lastCutoff();
        expect(cutoff.getTime()).toBe(Date.now() - 90 * DAY_MS);
        expect(cutoff.getTime()).toBeLessThan(Date.now());
    });

    it('zero / garbage env values fall back to 90 days', async () => {
        process.env.AUDIT_LOG_RETENTION_DAYS = '0';
        await purgeOldAuditLog();
        expect(lastCutoff().getTime()).toBe(Date.now() - 90 * DAY_MS);

        process.env.AUDIT_LOG_RETENTION_DAYS = 'soon';
        await purgeOldAuditLog();
        expect(lastCutoff().getTime()).toBe(Date.now() - 90 * DAY_MS);
    });

    it('valid positive env value is honored', async () => {
        process.env.AUDIT_LOG_RETENTION_DAYS = '30';
        await purgeOldAuditLog();
        expect(lastCutoff().getTime()).toBe(Date.now() - 30 * DAY_MS);
    });

    it('negative explicit maxAgeMs param falls back to the default (symmetry)', async () => {
        await purgeOldAuditLog(-5_000);
        expect(lastCutoff().getTime()).toBe(Date.now() - 90 * DAY_MS);
    });

    it('positive explicit maxAgeMs param is honored', async () => {
        await purgeOldAuditLog(7 * DAY_MS);
        expect(lastCutoff().getTime()).toBe(Date.now() - 7 * DAY_MS);
    });
});
