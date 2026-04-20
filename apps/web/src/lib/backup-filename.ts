import { randomUUID } from 'crypto';

export const BACKUP_FILENAME_PATTERN = /^backup-\d{4}-\d{2}-\d{2}T[\d-]+Z(?:-[0-9a-f]{8})?\.sql$/i;

export function createBackupFilename(now: Date = new Date(), suffix: string = randomUUID().slice(0, 8)) {
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    return `backup-${timestamp}-${suffix}.sql`;
}

export function isValidBackupFilename(filename: string) {
    return BACKUP_FILENAME_PATTERN.test(filename);
}
