import { MAX_RESTORE_FILE_BYTES } from '@/lib/upload-limits';

export const MAX_RESTORE_SIZE_BYTES = MAX_RESTORE_FILE_BYTES;

export function formatBinarySize(bytes: number): string {
    const gib = 1024 * 1024 * 1024;
    if (bytes % gib === 0) {
        return `${bytes / gib} GB`;
    }

    const mib = 1024 * 1024;
    if (bytes % mib === 0) {
        return `${bytes / mib} MB`;
    }

    return `${bytes} bytes`;
}

export const MAX_RESTORE_SIZE_LABEL = formatBinarySize(MAX_RESTORE_SIZE_BYTES);

const SQL_DUMP_HEADER_PATTERN = /^(?:--|CREATE\s|INSERT\s|DROP\s|SET\s|\/\*!)/i;

export function hasPlausibleSqlDumpHeader(headerBytes: string): boolean {
    return SQL_DUMP_HEADER_PATTERN.test(headerBytes.trimStart());
}

/**
 * C1-02 (run-10 cycle-1, DBG-03): mysqldump completeness verification.
 *
 * A mysqldump file truncated at a clean statement boundary imports without any
 * error — the mysql client executes every complete statement it is given,
 * reaches EOF, and exits 0 — so exit-code-only validation can report a
 * partially-applied restore as a success. mysqldump (without --skip-comments,
 * which this app never passes) always starts with a `-- MySQL dump` /
 * `-- MariaDB dump` header and always ends with a `-- Dump completed`
 * trailer, so: when the HEADER identifies a mysqldump artifact, the trailer is
 * REQUIRED before the file is trusted (backup finalize + restore accept).
 * Operator-authored plain SQL (no mysqldump header) keeps the existing
 * plausible-header-only behavior and is never rejected by this check.
 */
const MYSQLDUMP_ARTIFACT_HEADER_PATTERN = /^--\s+(?:MySQL|MariaDB)\s+dump/i;

export function isMysqldumpArtifactHeader(headerBytes: string): boolean {
    return MYSQLDUMP_ARTIFACT_HEADER_PATTERN.test(headerBytes.trimStart());
}

const MYSQLDUMP_COMPLETION_TRAILER_PATTERN = /--\s+Dump\s+completed/i;

/** How many bytes from the end of a dump to scan for the completion trailer. */
export const MYSQLDUMP_TRAILER_SCAN_BYTES = 1024;

export function hasMysqldumpCompletionTrailer(tailBytes: string): boolean {
    return MYSQLDUMP_COMPLETION_TRAILER_PATTERN.test(tailBytes);
}

export function isIgnorableRestoreStdinError(error: unknown): boolean {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return false;
    }

    const code = String((error as { code?: unknown }).code ?? '');
    return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED';
}
