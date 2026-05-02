import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const advisoryLocksSource = readFileSync(resolve(__dirname, '..', 'lib', 'advisory-locks.ts'), 'utf8');
const adminUsersSource = readFileSync(resolve(__dirname, '..', 'app', 'actions', 'admin-users.ts'), 'utf8');

describe('admin delete advisory lock source contract', () => {
    it('uses one global lock for the table-wide last-admin invariant', () => {
        expect(advisoryLocksSource).toContain("export const LOCK_ADMIN_DELETE = 'gallerykit_admin_delete'");
        expect(advisoryLocksSource).not.toContain('gallerykit_admin_delete:${userId}');
        expect(advisoryLocksSource).not.toContain('getAdminDeleteLockName');

        expect(adminUsersSource).toContain('const lockName = LOCK_ADMIN_DELETE');
        expect(adminUsersSource).not.toContain('getAdminDeleteLockName(id)');
    });
});
