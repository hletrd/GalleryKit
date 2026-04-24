import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
    isAdminMock,
    getCurrentUserMock,
    logAuditEventMock,
    getClientIpMock,
} = vi.hoisted(() => ({
    isAdminMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    logAuditEventMock: vi.fn(),
    getClientIpMock: vi.fn(),
}));

vi.mock('@/app/actions/auth', () => ({
    isAdmin: isAdminMock,
    getCurrentUser: getCurrentUserMock,
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: logAuditEventMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: vi.fn(async () => (key: string) => (
        key === 'unauthorized' ? 'Unauthorized' : key
    )),
}));

vi.mock('@/lib/rate-limit', async () => {
    const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit');
    return {
        ...actual,
        getClientIp: getClientIpMock,
    };
});

import { GET } from '@/app/api/admin/db/download/route';

const originalCwd = process.cwd();
const VALID_BACKUP_FILE = 'backup-2026-04-22T00-00-00-000Z-1234abcd.sql';

describe('backup download route', () => {
    let tempCwd = '';

    beforeEach(async () => {
        tempCwd = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-download-route-'));
        await fsp.mkdir(path.join(tempCwd, 'data', 'backups'), { recursive: true });
        process.chdir(tempCwd);

        isAdminMock.mockReset();
        getCurrentUserMock.mockReset();
        logAuditEventMock.mockReset();
        getClientIpMock.mockReset();

        isAdminMock.mockResolvedValue(true);
        getCurrentUserMock.mockResolvedValue({ id: 7 });
        logAuditEventMock.mockResolvedValue(undefined);
        getClientIpMock.mockReturnValue('203.0.113.10');
    });

    afterEach(async () => {
        process.chdir(originalCwd);
        await fsp.rm(tempCwd, { recursive: true, force: true });
    });

    it('rejects unauthenticated requests before touching the filesystem', async () => {
        isAdminMock.mockResolvedValue(false);

        const response = await GET(new NextRequest(`http://localhost/api/admin/db/download?file=${VALID_BACKUP_FILE}`, {
            headers: {
                host: 'localhost',
                origin: 'http://localhost',
                referer: 'http://localhost/admin/db',
                'x-forwarded-proto': 'http',
            },
        }));

        expect(response.status).toBe(401);
        expect(response.headers.get('Cache-Control')).toContain('no-store');
        expect(response.headers.get('Pragma')).toBe('no-cache');
        await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it('streams an existing backup file to authorized admins', async () => {
        const filePath = path.join(tempCwd, 'data', 'backups', VALID_BACKUP_FILE);
        await fsp.writeFile(filePath, 'backup-data');

        const response = await GET(new NextRequest(`http://localhost/api/admin/db/download?file=${VALID_BACKUP_FILE}`, {
            headers: {
                host: 'localhost',
                origin: 'http://localhost',
                referer: 'http://localhost/admin/db',
                'x-forwarded-proto': 'http',
            },
        }));

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/sql');
        expect(response.headers.get('Content-Disposition')).toContain(VALID_BACKUP_FILE);
        expect(await response.text()).toBe('backup-data');
        expect(logAuditEventMock).toHaveBeenCalledWith(7, 'db_backup_download', 'database_backup', VALID_BACKUP_FILE, '203.0.113.10', {
            size: 'backup-data'.length,
        });
    });

    it('rejects cross-origin download attempts before reading the file', async () => {
        const filePath = path.join(tempCwd, 'data', 'backups', VALID_BACKUP_FILE);
        await fsp.writeFile(filePath, 'backup-data');

        const response = await GET(new NextRequest(`http://localhost/api/admin/db/download?file=${VALID_BACKUP_FILE}`, {
            headers: {
                host: 'localhost',
                origin: 'https://evil.example',
            },
        }));

        expect(response.status).toBe(403);
        expect(await response.text()).toBe('Unauthorized');
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it('rejects download attempts without same-origin provenance headers', async () => {
        const filePath = path.join(tempCwd, 'data', 'backups', VALID_BACKUP_FILE);
        await fsp.writeFile(filePath, 'backup-data');

        const response = await GET(new NextRequest(`http://localhost/api/admin/db/download?file=${VALID_BACKUP_FILE}`));

        expect(response.status).toBe(403);
        expect(await response.text()).toBe('Unauthorized');
        expect(logAuditEventMock).not.toHaveBeenCalled();
    });

    it('returns a 500 for unexpected filesystem failures instead of masking them as 404', async () => {
        const backupsDir = path.join(tempCwd, 'data', 'backups');
        const filePath = path.join(backupsDir, VALID_BACKUP_FILE);
        await fsp.writeFile(filePath, 'backup-data');
        await fsp.chmod(backupsDir, 0o000);

        try {
            const response = await GET(new NextRequest(`http://localhost/api/admin/db/download?file=${VALID_BACKUP_FILE}`, {
                headers: {
                    host: 'localhost',
                    referer: 'http://localhost/admin/db',
                },
            }));

            expect(response.status).toBe(500);
            expect(await response.text()).toBe('Internal Server Error');
        } finally {
            await fsp.chmod(backupsDir, 0o755);
        }
    });
});
