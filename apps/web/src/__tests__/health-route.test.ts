import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    executeMock,
    isRestoreMaintenanceActiveMock,
} = vi.hoisted(() => ({
    executeMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(),
}));

vi.mock('@/db', () => ({
    db: {
        execute: executeMock,
    },
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

import { GET } from '@/app/api/health/route';

describe('/api/health', () => {
    beforeEach(() => {
        executeMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        executeMock.mockResolvedValue([{ ok: 1 }]);
    });

    it('returns degraded during restore maintenance even when the database is reachable', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        const response = await GET();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ status: 'restore-maintenance' });
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('returns ok when the database is reachable outside maintenance mode', async () => {
        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it('returns degraded when the database probe fails outside maintenance mode', async () => {
        executeMock.mockRejectedValueOnce(new Error('db offline'));

        const response = await GET();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ status: 'degraded' });
        expect(executeMock).toHaveBeenCalledTimes(1);
    });
});
