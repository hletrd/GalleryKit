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
        delete process.env.HEALTH_CHECK_DB;
        executeMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReset();
        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        executeMock.mockResolvedValue([{ ok: 1 }]);
    });

    it('returns a generic unavailable status during restore maintenance', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        const response = await GET();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ status: 'unavailable' });
        expect(executeMock).not.toHaveBeenCalled();
    });

    it('returns ok when the database is reachable outside maintenance mode', async () => {
        process.env.HEALTH_CHECK_DB = 'true';

        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it('returns a generic unavailable status when the database probe fails', async () => {
        process.env.HEALTH_CHECK_DB = 'true';
        executeMock.mockRejectedValueOnce(new Error('db offline'));

        const response = await GET();

        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ status: 'unavailable' });
        expect(executeMock).toHaveBeenCalledTimes(1);
    });

    it('defaults to a liveness-only response without probing the database', async () => {
        const response = await GET();

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ status: 'ok' });
        expect(executeMock).not.toHaveBeenCalled();
    });
});
