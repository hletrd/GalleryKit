import { describe, expect, it, vi } from 'vitest';

// `db-actions.ts` is a `'use server'` module. Tests import the pure
// helper directly; the surrounding server actions are mocked via module
// replacement so their side effects don't fire during test collection.

vi.mock('@/db', () => ({
    db: { select: vi.fn(), update: vi.fn(), insert: vi.fn(), delete: vi.fn(), transaction: vi.fn() },
    connection: { getConnection: vi.fn() },
    images: {}, imageTags: {}, tags: {},
}));

vi.mock('next-intl/server', () => ({
    getTranslations: vi.fn().mockResolvedValue((key: string) => key),
}));

vi.mock('@/app/actions', () => ({
    isAdmin: vi.fn(),
    getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
    logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/revalidation', () => ({
    revalidateAllAppData: vi.fn(),
}));

vi.mock('@/lib/action-guards', () => ({
    requireSameOriginAdmin: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/restore-maintenance', () => ({
    beginRestoreMaintenance: vi.fn(), endRestoreMaintenance: vi.fn(),
    getRestoreMaintenanceMessage: vi.fn().mockReturnValue(null),
}));

vi.mock('@/lib/data', () => ({
    flushBufferedSharedGroupViewCounts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/image-queue', () => ({
    quiesceImageProcessingQueueForRestore: vi.fn().mockResolvedValue(undefined),
    resumeImageProcessingQueueAfterRestore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/backup-filename', () => ({
    createBackupFilename: vi.fn().mockReturnValue('backup.sql'),
}));

vi.mock('@/lib/sql-restore-scan', () => ({
    appendSqlScanChunk: vi.fn(),
    containsDangerousSql: vi.fn(),
}));

vi.mock('@/lib/db-restore', () => ({
    isIgnorableRestoreStdinError: vi.fn(),
    MAX_RESTORE_SIZE_BYTES: 256 * 1024 * 1024,
}));

import { escapeCsvField } from '@/app/[locale]/admin/db-actions';

/**
 * C6R-RPL-06 / AGG6R-11 — dedicated unit tests for `escapeCsvField`.
 * Previously tested only via integration; this file locks in:
 * - CRLF collapse into a single space (the fix).
 * - Control-char stripping.
 * - Formula-injection prefixing.
 * - Embedded quote doubling.
 */

describe('escapeCsvField', () => {
    it('wraps plain ASCII values in double quotes', () => {
        expect(escapeCsvField('hello')).toBe('"hello"');
    });

    it('doubles embedded double quotes', () => {
        expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    });

    it('strips null bytes and other C0 control characters', () => {
        expect(escapeCsvField('a\x00b\x01c')).toBe('"abc"');
    });

    it('strips C1 (0x7F-0x9F) control characters', () => {
        expect(escapeCsvField('a\x7Fb\x9Fc')).toBe('"abc"');
    });

    it('collapses CRLF into a single space (not two spaces) — C6R-RPL-06 fix', () => {
        expect(escapeCsvField('title\r\nfoo')).toBe('"title foo"');
    });

    it('collapses consecutive CR/LF into a single space', () => {
        expect(escapeCsvField('a\n\nb')).toBe('"a b"');
        expect(escapeCsvField('a\r\r\nb')).toBe('"a b"');
    });

    it('prefixes formula-injection characters with a single quote', () => {
        expect(escapeCsvField('=SUM(A1)')).toBe('"\'=SUM(A1)"');
        expect(escapeCsvField('+cmd')).toBe('"\'+cmd"');
        expect(escapeCsvField('-cmd')).toBe('"\'-cmd"');
        expect(escapeCsvField('@cmd')).toBe('"\'@cmd"');
    });

    it('strips tab characters (they cause column misalignment in strict parsers)', () => {
        // Tab (0x09) is stripped by the control-char pass. Even though \t is
        // in the formula-prefix check, it never reaches that branch because
        // the strip runs first.
        expect(escapeCsvField('a\tb')).toBe('"ab"');
    });

    it('passes through safe ASCII unchanged', () => {
        expect(escapeCsvField('normal text 123')).toBe('"normal text 123"');
    });

    it('handles empty strings', () => {
        expect(escapeCsvField('')).toBe('""');
    });
});
