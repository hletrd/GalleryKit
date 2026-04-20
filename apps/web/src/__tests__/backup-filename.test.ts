import { describe, expect, it } from 'vitest';

import { BACKUP_FILENAME_PATTERN, createBackupFilename, isValidBackupFilename } from '@/lib/backup-filename';

describe('backup filename helpers', () => {
    it('generates backup filenames that match the shared route validation pattern', () => {
        const filename = createBackupFilename(new Date('2026-04-20T10:11:12.345Z'), 'deadbeef');

        expect(filename).toBe('backup-2026-04-20T10-11-12-345Z-deadbeef.sql');
        expect(BACKUP_FILENAME_PATTERN.test(filename)).toBe(true);
        expect(isValidBackupFilename(filename)).toBe(true);
    });

    it('rejects filenames outside the approved backup contract', () => {
        expect(isValidBackupFilename('backup-2026-04-20T10-11-12-345Z.sql')).toBe(true);
        expect(isValidBackupFilename('../backup-2026-04-20T10-11-12-345Z-deadbeef.sql')).toBe(false);
        expect(isValidBackupFilename('notes.sql')).toBe(false);
    });
});
