'use server';

import { db, connection } from "@/db";
import type { RowDataPacket } from "mysql2/promise";
import { images, imageTags, tags } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { isAdmin, getCurrentUser } from "@/app/actions";
import { logAuditEvent } from "@/lib/audit";
import { getTranslations } from 'next-intl/server';
import { revalidateAllAppData } from "@/lib/revalidation";
import { appendSqlScanChunk, containsDangerousSql } from "@/lib/sql-restore-scan";
import { createBackupFilename } from "@/lib/backup-filename";
import { requireSameOriginAdmin } from "@/lib/action-guards";
import { flushBufferedSharedGroupViewCounts } from "@/lib/data";
import { quiesceImageProcessingQueueForRestore, resumeImageProcessingQueueAfterRestore } from "@/lib/image-queue";
import { drainBackgroundDbWritesForRestore } from "@/lib/background-db-writes";
import { getRestoreMaintenanceMessage } from "@/lib/restore-maintenance";
import { drainAdminMutationsForRestore, releaseAdminMutationExclusive } from "@/lib/admin-mutation-barrier";
import { beginDurableRestoreMaintenance, endDurableRestoreMaintenance } from "@/lib/restore-maintenance-durable";
import { hasPlausibleSqlDumpHeader, isIgnorableRestoreStdinError, MAX_RESTORE_SIZE_BYTES, isMysqldumpArtifactHeader, hasMysqldumpCompletionTrailer, MYSQLDUMP_TRAILER_SCAN_BYTES } from "@/lib/db-restore";
import { getMysqlCliSslArgs } from "@/lib/mysql-cli-ssl";
import { acquireUploadProcessingContractLock } from "@/lib/upload-processing-contract-lock";
import { sanitizeStderr } from "@/lib/sanitize";
import { LOCK_COLOR_PIPELINE_BACKFILL, LOCK_DB_RESTORE, LOCK_SEMANTIC_EMBEDDING_BACKFILL, isAdvisoryLockAcquired } from "@/lib/advisory-locks";

// escapeCsvField moved to `@/lib/csv-escape` so it can be unit-tested
// without the `'use server'` async-only constraint (C6R-RPL-06 / AGG6R-11).
// Re-import here to keep the existing call site unchanged.
import { escapeCsvField } from "@/lib/csv-escape";

const DB_CHILD_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const DB_CHILD_PROCESS_KILL_GRACE_MS = 5000;

function armDbChildProcessWatchdog(
    child: ChildProcessWithoutNullStreams,
    label: string,
    onTimeout: (err: Error) => void,
): () => void {
    let fired = false;
    let childSettled = false;
    let forceKill: ReturnType<typeof setTimeout> | null = null;
    const markSettled = () => {
        childSettled = true;
        if (forceKill) {
            clearTimeout(forceKill);
            forceKill = null;
        }
    };
    child.once('exit', markSettled);
    child.once('close', markSettled);
    const timeout = setTimeout(() => {
        fired = true;
        const err = new Error(`${label} timed out after ${DB_CHILD_PROCESS_TIMEOUT_MS}ms`);
        onTimeout(err);
        child.stdin.destroy(err);
        child.stdout.destroy(err);
        child.stderr.destroy(err);
        child.kill('SIGTERM');
        forceKill = setTimeout(() => {
            if (!childSettled) child.kill('SIGKILL');
        }, DB_CHILD_PROCESS_KILL_GRACE_MS);
        forceKill.unref?.();
    }, DB_CHILD_PROCESS_TIMEOUT_MS);
    timeout.unref?.();

    return () => {
        if (!fired) clearTimeout(timeout);
        markSettled();
        child.off('exit', markSettled);
        child.off('close', markSettled);
    };
}

export async function exportImagesCsv(): Promise<{ data?: string; error?: string; warning?: string }> {
    // C3-F01: Memory profile — materializes up to 50K rows as a CSV string
    // (~15-25MB peak heap). The DB results array is released before the final
    // join, but the csvLines array and joined string coexist briefly. For
    // galleries approaching the 50K row cap, consider a streaming API route
    // instead of the current in-memory builder.
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    // C2R-02: defense-in-depth same-origin check for mutating/exporting server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }

    // group_concat_max_len is already set to 65535 on every pool connection
    // via poolConnection.on('connection', ...) in db/index.ts — no per-session
    // SET needed here (and a per-session SET would be unreliable in a pooled
    // environment where the SET and the SELECT may use different connections).

    const results = await db
        .select({
            id: images.id,
            filename: images.user_filename,
            title: images.title,
            width: images.width,
            height: images.height,
            captureDate: images.capture_date,
            topic: images.topic,
            tags: sql<string>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name} SEPARATOR CHAR(1))`
        })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .limit(50000); // Cap to prevent OOM on very large galleries

    const headers = ["ID", "Filename", "Title", "Width", "Height", "Capture Date", "Topic", "Tags"];

    // Build CSV incrementally to avoid holding both the DB results array
    // and the full CSV string in memory simultaneously. Process rows into
    // CSV lines, then release the results array before joining.
    const csvLines: string[] = [headers.join(",")];
    for (const row of results) {
        csvLines.push([
            escapeCsvField(String(row.id)),
            escapeCsvField(row.filename || ""),
            escapeCsvField(row.title || ""),
            escapeCsvField(String(row.width)),
            escapeCsvField(String(row.height)),
            escapeCsvField(row.captureDate ? String(row.captureDate) : ""),
            escapeCsvField(row.topic || ""),
            // C21-AGG-02: split on \x01 (matching SEPARATOR CHAR(1) in the
            // GROUP_CONCAT above) and rejoin with comma+space for a
            // human-readable CSV value. The \x01 separator is robust
            // against tag names containing commas (currently rejected by
            // isValidTagName, but defensive against future changes).
            escapeCsvField(row.tags ? row.tags.split('\x01').join(', ') : ""),
        ].join(","));
    }

    // Release the DB results array before materializing the full CSV string
    const rowCount = results.length;
    // C22-01: Release element references for GC without type-unsafe reassignment.
    // `results.length = 0` clears the array in place, preserving the correct type
    // so any accidental downstream access gets an empty array of the right shape.
    // The prior `results = [] as typeof results` was a type lie that could confuse
    // future maintainers.
    results.length = 0;

    const csvContent = csvLines.join("\n");

    const warning = rowCount >= 50000 ? t('csvTruncated') : undefined;

    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'csv_export', 'images', undefined, undefined, { rowCount }).catch(console.debug);

    return { data: csvContent, warning };
}

export async function dumpDatabase() {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { success: false as const, error: maintenanceError };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { success: false as const, error: originError };
    if (!(await isAdmin())) {
        return { success: false as const, error: t('unauthorized') };
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
        return { success: false as const, error: t('missingDbConfig') };
    }

    const filename = createBackupFilename();

    const backupsDir = path.join(process.cwd(), 'data', 'backups');
    const outputPath = path.join(backupsDir, filename);
    // C1-02 (run-10 cycle-1, DBG-03): the dump streams to a .tmp sibling and is
    // atomically rename()d to the canonical filename ONLY after every
    // completeness check passes. A mid-write process kill (OOM, docker stop
    // past the grace window, host power loss) therefore can never leave a
    // truncated file at a real, listed backup filename — the worst case is an
    // orphaned .tmp that the next successful backup run ignores.
    const tmpOutputPath = `${outputPath}.tmp`;

    // C2L2-08: create the backups directory owner-only so its mode aligns with
    // the per-file `0o600` mode applied below. Operators on multi-user hosts
    // benefit from defense-in-depth even though CLAUDE.md accepts plaintext
    // backups at rest as the personal-gallery threat model.
    await fs.mkdir(backupsDir, { recursive: true, mode: 0o700 });

    let sslArgs: string[];
    try {
        sslArgs = getMysqlCliSslArgs(DB_HOST);
    } catch (err) {
        console.error('Database backup TLS configuration is incomplete:', err);
        return { success: false as const, error: t('backupFailed') };
    }

    const conn = await connection.getConnection();
    let dbRestoreLockHeld = false;
    try {
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            "SELECT GET_LOCK(?, 0) AS acquired",
            [LOCK_DB_RESTORE],
        );
        const acquired = lockRows[0]?.acquired;
        if (!isAdvisoryLockAcquired(acquired)) {
            return { success: false as const, error: t('restoreInProgress') };
        }
        dbRestoreLockHeld = true;

        return await new Promise<{ success: boolean, filename?: string, url?: string, error?: string }>((resolve) => {
            // Use MYSQL_USER/MYSQL_HOST/MYSQL_TCP_PORT env vars instead of CLI flags
            // to avoid exposing credentials in /proc/<pid>/cmdline
            // Minimal env: HOME excluded (prevents ~/.my.cnf loading), LANG/LC_ALL
            // set to C.UTF-8 for deterministic output regardless of server locale,
            // MYSQL_* vars required for auth (avoid exposing credentials in /proc/cmdline).
            const dump = spawn('mysqldump', [
                '--single-transaction', // Good for InnoDB
                '--quick',
                ...sslArgs,
                DB_NAME
            ], {
                env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, MYSQL_PWD: DB_PASSWORD, MYSQL_USER: DB_USER, MYSQL_HOST: DB_HOST, MYSQL_TCP_PORT: DB_PORT || '3306', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
            });

        const writeStream = createWriteStream(tmpOutputPath, { mode: 0o600 });
        let settled = false;
        let writeStreamHadError = false;
        const clearWatchdog = armDbChildProcessWatchdog(dump, 'mysqldump backup', (err) => {
            if (settled) return;
            settled = true;
            console.error('mysqldump backup timeout:', err);
            writeStream.destroy(err);
            fs.unlink(tmpOutputPath).catch(() => {});
            resolve({ success: false, error: t('backupFailed') });
        });

        dump.stdout.pipe(writeStream);

        writeStream.on('error', (err) => {
            writeStreamHadError = true;
            if (settled) return;
            settled = true;
            clearWatchdog();
            console.error('Backup writeStream error:', err);
            dump.kill();
            fs.unlink(tmpOutputPath).catch(() => {});
            resolve({ success: false, error: t('failedToWriteBackup') });
        });

        dump.stderr.on('data', (data: Buffer) => {
            console.error(`mysqldump stderr: ${sanitizeStderr(data, DB_PASSWORD, [DB_USER, DB_HOST, DB_NAME])}`);
        });

        dump.on('close', async (code: number) => {
            if (settled) return;
            settled = true;
            clearWatchdog();
            if (code === 0) {
                // Wait for writeStream to finish flushing before resolving —
                // the 'close' event fires when the process exits, but the piped
                // writeStream may still be flushing its final buffers to disk.
                await new Promise<void>((resolveFlush) => {
                    if (writeStream.writableFinished) {
                        resolveFlush();
                    } else {
                        writeStream.on('finish', resolveFlush);
                        writeStream.on('error', () => {
                            writeStreamHadError = true;
                            resolveFlush();
                        });
                    }
                });

                // If the writeStream had an error during flush, the backup file
                // may be truncated or corrupt. Report failure instead of success.
                if (writeStreamHadError) {
                    console.error('Backup writeStream error during flush — file may be corrupt');
                    fs.unlink(tmpOutputPath).catch(() => {});
                    resolve({ success: false, error: t('failedToWriteBackup') });
                    return;
                }

                // Verify the backup file is non-empty and contains the expected
                // mysqldump header. An empty file would indicate mysqldump exited
                // 0 without producing output (e.g., permissions issue on some
                // MySQL versions that don't set a non-zero exit code).
                try {
                    const stats = await fs.stat(tmpOutputPath);
                    if (stats.size === 0) {
                        console.error('Backup file is empty despite mysqldump exit code 0');
                        fs.unlink(tmpOutputPath).catch(() => {});
                        resolve({ success: false, error: t('failedToWriteBackup') });
                        return;
                    }
                    const headerBuf = Buffer.alloc(256);
                    const fd = await fs.open(tmpOutputPath, 'r');
                    let headerBytesRead = 0;
                    try {
                        const { bytesRead } = await fd.read(headerBuf, 0, headerBuf.length, 0);
                        headerBytesRead = bytesRead;
                    } finally {
                        await fd.close();
                    }
                    const headerBytes = headerBuf.subarray(0, headerBytesRead).toString('utf8');
                    if (!hasPlausibleSqlDumpHeader(headerBytes)) {
                        console.error('Backup file does not start with a plausible SQL dump header');
                        fs.unlink(tmpOutputPath).catch(() => {});
                        resolve({ success: false, error: t('failedToWriteBackup') });
                        return;
                    }

                    // C1-02 (run-10 cycle-1, DBG-03): completeness check. Our
                    // own mysqldump invocation never passes --skip-comments, so
                    // a COMPLETE dump always ends with the `-- Dump completed`
                    // trailer; its absence means the stream was cut mid-dump
                    // even though the exit code was 0 (e.g. a wedged pipe
                    // flushed late) — never publish such a file as a backup.
                    if (isMysqldumpArtifactHeader(headerBytes)) {
                        const tailStart = Math.max(0, stats.size - MYSQLDUMP_TRAILER_SCAN_BYTES);
                        const tailBuf = Buffer.alloc(Math.min(stats.size, MYSQLDUMP_TRAILER_SCAN_BYTES));
                        const tailFd = await fs.open(tmpOutputPath, 'r');
                        let tailBytesRead = 0;
                        try {
                            const { bytesRead } = await tailFd.read(tailBuf, 0, tailBuf.length, tailStart);
                            tailBytesRead = bytesRead;
                        } finally {
                            await tailFd.close();
                        }
                        const tailBytes = tailBuf.subarray(0, tailBytesRead).toString('utf8');
                        if (!hasMysqldumpCompletionTrailer(tailBytes)) {
                            console.error('Backup file is missing the mysqldump completion trailer — dump is incomplete');
                            fs.unlink(tmpOutputPath).catch(() => {});
                            resolve({ success: false, error: t('failedToWriteBackup') });
                            return;
                        }
                    }

                    // C1-02: every check passed — atomically publish the dump
                    // at its canonical, listable filename.
                    await fs.rename(tmpOutputPath, outputPath);
                } catch {
                    fs.unlink(tmpOutputPath).catch(() => {});
                    resolve({ success: false, error: t('failedToWriteBackup') });
                    return;
                }

                // Audit logging is fire-and-forget; wrap in try-catch so a
                // transient DB error doesn't prevent the success resolve.
                try {
                    const currentUser = await getCurrentUser();
                    logAuditEvent(currentUser?.id ?? null, 'db_backup', 'database', DB_NAME, undefined, { filename }).catch(console.debug);
                } catch (err) {
                    console.debug('Failed to log audit event for backup:', err);
                }

                // Return filename; url points to authenticated admin download route
                resolve({ success: true, filename, url: `/api/admin/db/download?file=${encodeURIComponent(filename)}` });
            } else {
                fs.unlink(tmpOutputPath).catch(() => {});
                resolve({ success: false, error: t('backupExitedWithCode', { code }) });
            }
        });

        dump.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            clearWatchdog();
            console.error('mysqldump spawn error:', err);
            fs.unlink(tmpOutputPath).catch(() => {});
            resolve({ success: false, error: t('backupFailed') });
        });
        });
    } finally {
        if (dbRestoreLockHeld) {
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_DB_RESTORE]).catch((err) => {
                console.debug('RELEASE_LOCK (backup finally) failed:', err);
            });
        }
        conn.release();
    }
}

// Restore intentionally uses a much smaller app-level cap than the generic
// server-action transport budget. Keep the UI/docs explicit about the 250 MB
// restore limit because Next.js may accept a larger request body before this
// action rejects it.
// DB advisory lock: prevents concurrent 250MB uploads filling /tmp.
// GET_LOCK is released automatically on connection close (crash-safe).

export async function restoreDatabase(formData: FormData) {
    const t = await getTranslations('serverActions');
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { success: false, error: originError };
    if (!(await isAdmin())) {
        return { success: false, error: t('unauthorized') };
    }

    // Use a dedicated connection from the pool so GET_LOCK and RELEASE_LOCK
    // execute on the same session. Advisory locks are session-scoped —
    // with pooled connections, GET_LOCK and RELEASE_LOCK may run on
    // different connections, making the lock unreliable.
    const conn = await connection.getConnection();
    let uploadContractLock: Awaited<ReturnType<typeof acquireUploadProcessingContractLock>> = null;
    let dbRestoreLockHeld = false;
    let backfillLockHeld = false;
    let semanticBackfillLockHeld = false;
    let restoreLifecycleVerified = false;
    let keepRestoreMaintenance = false;
    let imageQueueQuiesced = false;
    try {
        // C2R-03: name the column via `AS acquired` and read it by name
        // instead of relying on `Object.values(lockRow)[0]` iteration order.
        // Matches the admin-user delete pattern at admin-users.ts:186-189.
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            "SELECT GET_LOCK(?, 0) AS acquired",
            [LOCK_DB_RESTORE]
        );
        const acquired = lockRows[0]?.acquired;
        if (!isAdvisoryLockAcquired(acquired)) {
            return { success: false, error: t('restoreInProgress') };
        }
        dbRestoreLockHeld = true;

        // Restore rewrites the same database/filesystem contract that uploads
        // depend on. Hold the upload-processing contract lock for the whole
        // restore window so an upload cannot pass its maintenance checks and
        // then insert/enqueue while the DB import is dropping/recreating rows.
        uploadContractLock = await acquireUploadProcessingContractLock(0);
        if (!uploadContractLock) {
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_DB_RESTORE]).catch((err) => {
                console.debug('RELEASE_LOCK (upload-contract early-return) failed:', err);
            });
            dbRestoreLockHeld = false;
            return { success: false, error: t('restoreInProgress') };
        }

        const [backfillLockRows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            "SELECT GET_LOCK(?, 0) AS acquired",
            [LOCK_COLOR_PIPELINE_BACKFILL]
        );
        const backfillLockAcquired = backfillLockRows[0]?.acquired;
        if (!isAdvisoryLockAcquired(backfillLockAcquired)) {
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_DB_RESTORE]).catch((err) => {
                console.debug('RELEASE_LOCK (backfill-lock early-return) failed:', err);
            });
            dbRestoreLockHeld = false;
            await uploadContractLock.release();
            uploadContractLock = null;
            return { success: false, error: t('restoreInProgress') };
        }
        backfillLockHeld = true;

        const [semanticBackfillLockRows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            "SELECT GET_LOCK(?, 0) AS acquired",
            [LOCK_SEMANTIC_EMBEDDING_BACKFILL]
        );
        const semanticBackfillLockAcquired = semanticBackfillLockRows[0]?.acquired;
        if (!isAdvisoryLockAcquired(semanticBackfillLockAcquired)) {
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_COLOR_PIPELINE_BACKFILL]).catch((err) => {
                console.debug('RELEASE_LOCK (semantic-backfill early-return color-lock) failed:', err);
            });
            backfillLockHeld = false;
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_DB_RESTORE]).catch((err) => {
                console.debug('RELEASE_LOCK (semantic-backfill early-return restore-lock) failed:', err);
            });
            dbRestoreLockHeld = false;
            await uploadContractLock.release();
            uploadContractLock = null;
            return { success: false, error: t('restoreInProgress') };
        }
        semanticBackfillLockHeld = true;

        let restoreMaintenanceStarted = false;
        let restoreMaintenanceStartError: unknown = null;
        try {
            restoreMaintenanceStarted = beginDurableRestoreMaintenance({ allowExisting: true });
        } catch (err) {
            restoreMaintenanceStartError = err;
            console.error('Failed to enter durable restore maintenance', err);
        }

        if (!restoreMaintenanceStarted) {
            // C7R-RPL-02 / AGG7R-02: explicitly RELEASE_LOCK on this
            // early-return path. The original code skipped the inner
            // try/finally whose RELEASE_LOCK statement is the only one
            // in the outer flow — without this release, the advisory
            // lock stayed held by the pool connection after it went
            // back to the pool, blocking every subsequent restore
            // attempt until the connection was evicted.
            // C8R-RPL-09 / AGG8R-03: surface catch via console.debug
            // instead of silently swallowing so an operator can see
            // when the release itself fails (connection kill, DB
            // outage, etc.). Matches the sibling pattern at the outer
            // finally below.
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_DB_RESTORE]).catch((err) => {
                console.debug('RELEASE_LOCK (maintenance-begin early-return) failed:', err);
            });
            dbRestoreLockHeld = false;
            if (backfillLockHeld) {
                await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_COLOR_PIPELINE_BACKFILL]).catch((err) => {
                    console.debug('RELEASE_LOCK (backfill maintenance-begin early-return) failed:', err);
                });
                backfillLockHeld = false;
            }
            if (semanticBackfillLockHeld) {
                await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_SEMANTIC_EMBEDDING_BACKFILL]).catch((err) => {
                    console.debug('RELEASE_LOCK (semantic-backfill maintenance-begin early-return) failed:', err);
                });
                semanticBackfillLockHeld = false;
            }
            await uploadContractLock.release();
            uploadContractLock = null;
            return { success: false, error: restoreMaintenanceStartError ? t('restoreFailed') : t('restoreInProgress') };
        }

        try {
            try {
                await flushBufferedSharedGroupViewCounts();
                await quiesceImageProcessingQueueForRestore();
                imageQueueQuiesced = true;
                await drainBackgroundDbWritesForRestore();
                // C1-03 (run-10 cycle-1, closes C77-ARCH-01): drain FOREGROUND
                // admin mutations too. Every mutating admin action holds a
                // shared barrier slot for its whole body; the durable marker
                // (set above) plus the exclusive flag refuse new entrants, and
                // this wait ensures a mutation admitted BEFORE the marker
                // flipped cannot still be mid-body writing into the database
                // while the import replaces it. On timeout the restore ABORTS
                // rather than importing over concurrent writes.
                const mutationsDrained = await drainAdminMutationsForRestore();
                if (!mutationsDrained) {
                    console.error('Restore aborted: in-flight admin mutations did not settle within the drain budget');
                    return { success: false, error: t('restoreFailed') };
                }
            } catch (err) {
                console.error('Failed to prepare restore maintenance window', err);
                return { success: false, error: t('restoreFailed') };
            }

            const restoreResult = await runRestore(formData, t);
            restoreLifecycleVerified = restoreResult.success === true;
            keepRestoreMaintenance = restoreResult.keepMaintenance === true;
            return restoreResult;
        } finally {
            // C1-03: the exclusive barrier side ends with the restore window —
            // released unconditionally (on failure the durable maintenance
            // marker still blocks mutations; a stale exclusive flag must never
            // outlive the restore attempt).
            releaseAdminMutationExclusive();
            if (restoreLifecycleVerified || !keepRestoreMaintenance) {
                try {
                    endDurableRestoreMaintenance();
                } catch (err) {
                    console.error('Failed to clear durable restore maintenance marker', err);
                }
                if (restoreLifecycleVerified || imageQueueQuiesced) {
                    await resumeImageProcessingQueueAfterRestore().catch((err) => {
                        console.error('Failed to resume image-processing queue after restore', err);
                    });
                }
            }
            // C8R-RPL-09 / AGG8R-03: log release failure at debug
            // instead of silencing so the operator has a signal if
            // the release round-trip errors.
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_DB_RESTORE]).catch((err) => {
                console.debug('RELEASE_LOCK (restore finally) failed:', err);
            });
            dbRestoreLockHeld = false;
            if (backfillLockHeld) {
                await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_COLOR_PIPELINE_BACKFILL]).catch((err) => {
                    console.debug('RELEASE_LOCK (backfill restore finally) failed:', err);
                });
                backfillLockHeld = false;
            }
            if (semanticBackfillLockHeld) {
                await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_SEMANTIC_EMBEDDING_BACKFILL]).catch((err) => {
                    console.debug('RELEASE_LOCK (semantic-backfill restore finally) failed:', err);
                });
                semanticBackfillLockHeld = false;
            }
            await uploadContractLock?.release();
            uploadContractLock = null;
        }
    } finally {
        if (uploadContractLock) {
            await uploadContractLock.release().catch((err) => {
                console.debug('upload-processing contract release (setup fallback) failed:', err);
            });
            uploadContractLock = null;
        }
        if (backfillLockHeld) {
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_COLOR_PIPELINE_BACKFILL]).catch((err) => {
                console.debug('RELEASE_LOCK (backfill setup fallback) failed:', err);
            });
        }
        if (semanticBackfillLockHeld) {
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_SEMANTIC_EMBEDDING_BACKFILL]).catch((err) => {
                console.debug('RELEASE_LOCK (semantic-backfill setup fallback) failed:', err);
            });
        }
        if (dbRestoreLockHeld) {
            await conn.query("SELECT RELEASE_LOCK(?)", [LOCK_DB_RESTORE]).catch((err) => {
                console.debug('RELEASE_LOCK (setup fallback) failed:', err);
            });
        }
        conn.release();
    }
}

type RestoreResult = { success: boolean; error?: string; keepMaintenance?: boolean };

async function runRestore(formData: FormData, t: Awaited<ReturnType<typeof getTranslations>>): Promise<RestoreResult> {
    const fileEntry = formData.get('file');
    if (!fileEntry || !(fileEntry instanceof File)) {
        return { success: false, error: t('noFileProvided') };
    }
    const file = fileEntry;

    if (file.size > MAX_RESTORE_SIZE_BYTES) {
        return { success: false, error: t('fileTooLarge') };
    }

    // Stream to disk to avoid holding up to 250MB in Node.js heap.
    const tempPath = path.join(os.tmpdir(), `restore-${randomUUID()}.sql`);
    let cleanupTransferredToRestoreProcess = false;
    const cleanupTempFile = async () => {
        await fs.unlink(tempPath).catch(() => {});
    };
    try {
        try {
            const webStream = file.stream();
            const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream);
            await pipeline(nodeStream, createWriteStream(tempPath, { mode: 0o600 }));
        } catch {
            await cleanupTempFile();
            return { success: false, error: t('failedToSaveUpload') };
        }

        // Validate file header
        const headerBuf = Buffer.alloc(256);
        const fd = await fs.open(tempPath, 'r');
        let headerBytesRead = 0;
        try {
            // C7R-RPL-04 / AGG7R-04: capture bytesRead so files shorter
            // than 256 bytes don't see trailing zeros in the decoded
            // string. Buffer.alloc zeroes memory so the exploit surface
            // is minimal, but decoding only the bytes actually read is
            // the correct behavior and survives any future buffer-pool
            // changes in Node.
            const { bytesRead } = await fd.read(headerBuf, 0, 256, 0);
            headerBytesRead = bytesRead;
        } finally {
            await fd.close();
        }
        const headerBytes = headerBuf.subarray(0, headerBytesRead).toString('utf8');
        const validHeader = hasPlausibleSqlDumpHeader(headerBytes);
        if (!validHeader) {
            await cleanupTempFile();
            return { success: false, error: t('invalidSqlDump') };
        }

        // C1-02 (run-10 cycle-1, DBG-03): completeness check for mysqldump
        // artifacts. A dump truncated at a clean statement boundary imports
        // with exit code 0 and would be reported as a SUCCESSFUL restore while
        // silently missing every table after the truncation point. mysqldump
        // output (this app never passes --skip-comments) always ends with a
        // `-- Dump completed` trailer; when the header identifies a mysqldump
        // artifact, require it. Operator-authored plain SQL (no mysqldump
        // header) is not subject to this check.
        if (isMysqldumpArtifactHeader(headerBytes)) {
            const restoreFileSize = (await fs.stat(tempPath)).size;
            const tailStart = Math.max(0, restoreFileSize - MYSQLDUMP_TRAILER_SCAN_BYTES);
            const tailBuf = Buffer.alloc(Math.min(restoreFileSize, MYSQLDUMP_TRAILER_SCAN_BYTES));
            const tailFd = await fs.open(tempPath, 'r');
            let tailBytesRead = 0;
            try {
                const { bytesRead } = await tailFd.read(tailBuf, 0, tailBuf.length, tailStart);
                tailBytesRead = bytesRead;
            } finally {
                await tailFd.close();
            }
            const tailBytes = tailBuf.subarray(0, tailBytesRead).toString('utf8');
            if (!hasMysqldumpCompletionTrailer(tailBytes)) {
                console.error('Restore rejected: mysqldump-headed file is missing the completion trailer (truncated dump)');
                await cleanupTempFile();
                return { success: false, error: t('truncatedSqlDump') };
            }
        }

        const CHUNK_SIZE = 1024 * 1024;
        const fileSize = (await fs.stat(tempPath)).size;
        const scanFd = await fs.open(tempPath, 'r');
        let dangerousSqlDetected = false;
        try {
            let scanTail = '';
            for (let off = 0; off < fileSize; off += CHUNK_SIZE) {
                const readSize = Math.min(CHUNK_SIZE, fileSize - off);
                const chunkBuf = Buffer.alloc(readSize);
                // C7R-RPL-04 / AGG7R-04: capture bytesRead and decode only
                // the actually-read prefix. Short reads are rare but legal
                // and the current Buffer.alloc zero-fill would otherwise
                // pad the decoded chunk with NULL characters.
                const { bytesRead } = await scanFd.read(chunkBuf, 0, readSize, off);
                if (bytesRead === 0) break;
                const chunk = chunkBuf.subarray(0, bytesRead).toString('utf8');
                const { combined, nextTail } = appendSqlScanChunk(scanTail, chunk);
                if (containsDangerousSql(combined)) {
                    dangerousSqlDetected = true;
                    break;
                }
                scanTail = nextTail;
            }
        } finally {
            await scanFd.close();
        }
        if (dangerousSqlDetected) {
            await cleanupTempFile();
            return { success: false, error: t('disallowedSql') };
        }

        const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

        if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
            await cleanupTempFile();
            return { success: false, error: t('missingDbConfig') };
        }

        let restoreSslArgs: string[];
        try {
            restoreSslArgs = getMysqlCliSslArgs(DB_HOST);
        } catch (err) {
            await cleanupTempFile();
            console.error('Database restore TLS configuration is incomplete:', err);
            return { success: false, error: t('restoreFailed'), keepMaintenance: false };
        }

        cleanupTransferredToRestoreProcess = true;
        return await new Promise<RestoreResult>((resolve) => {
        // Use MYSQL_USER/MYSQL_HOST/MYSQL_TCP_PORT env vars instead of CLI flags
        // to avoid exposing credentials in /proc/<pid>/cmdline
        // Minimal env: HOME excluded (prevents ~/.my.cnf loading), LANG/LC_ALL
        // set to C.UTF-8 for deterministic behavior regardless of server locale,
        // MYSQL_* vars required for auth (avoid exposing credentials in /proc/cmdline).
        const restore = spawn('mysql', [
            '--one-database',
            ...restoreSslArgs,
            DB_NAME
        ], {
            env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, MYSQL_PWD: DB_PASSWORD, MYSQL_USER: DB_USER, MYSQL_HOST: DB_HOST, MYSQL_TCP_PORT: DB_PORT || '3306', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
        });

        const readStream = createReadStream(tempPath);
        let settled = false;
        let clearRestoreWatchdog = () => {};

        const failRestore = (error: string, logLabel: string, reason: unknown) => {
            if (settled) return;
            settled = true;
            clearRestoreWatchdog();
            console.error(logLabel, reason);
            readStream.destroy();
            restore.stdin.destroy();
            restore.kill();
            cleanupTempFile();
            resolve({ success: false, error, keepMaintenance: true });
        };
        clearRestoreWatchdog = armDbChildProcessWatchdog(restore, 'mysql restore import', (err) => {
            failRestore(t('restoreFailed'), 'mysql restore timeout:', err);
        });

        // Register all event handlers BEFORE piping to prevent missed events
        readStream.on('error', (err) => {
            failRestore(t('failedToReadRestore'), 'Failed to read restore file:', err);
        });

        restore.stdin.on('error', (err: NodeJS.ErrnoException) => {
            if (isIgnorableRestoreStdinError(err)) {
                return;
            }

            failRestore(t('restoreFailed'), 'mysql restore stdin error:', err);
        });

        restore.stderr.on('data', (data: Buffer) => {
            console.error(`mysql restore stderr: ${sanitizeStderr(data, DB_PASSWORD, [DB_USER, DB_HOST, DB_NAME])}`);
        });

        restore.on('close', async (code: number) => {
            if (settled) return;
            settled = true;
            clearRestoreWatchdog();
            await cleanupTempFile();
            if (code === 0) {
                let migrationResult: { success: boolean; error?: string };
                try {
                    migrationResult = await runPostRestoreMigrations(t);
                } catch (err) {
                    console.error('post-restore migrate setup error:', err);
                    migrationResult = { success: false, error: t('restoreFailed') };
                }
                if (!migrationResult.success) {
                    resolve({ success: false, error: migrationResult.error ?? t('restoreFailed'), keepMaintenance: true });
                    return;
                }
                // Audit logging is fire-and-forget; wrap in try-catch so a
                // transient DB error doesn't prevent the success resolve.
                try {
                    const currentUser = await getCurrentUser();
                    await logAuditEvent(currentUser?.id ?? null, 'db_restore', 'database', DB_NAME);
                } catch (err) {
                    console.debug('Failed to log audit event for restore:', err);
                }
                revalidateAllAppData();
                resolve({ success: true });
            } else {
                resolve({ success: false, error: t('restoreExitedWithCode', { code }), keepMaintenance: true });
            }
        });

        restore.on('error', (err: Error) => {
            failRestore(t('restoreFailed'), 'mysql restore spawn error:', err);
        });

        // Start piping after all handlers are registered
            readStream.pipe(restore.stdin);
        });
    } finally {
        if (!cleanupTransferredToRestoreProcess) {
            await cleanupTempFile();
        }
    }
}

async function resolveMigrationScriptPath(): Promise<string> {
    const candidates = [
        path.join(process.cwd(), 'scripts', 'migrate.js'),
        path.join(process.cwd(), 'apps', 'web', 'scripts', 'migrate.js'),
    ];
    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            // Try the next layout. Local dev runs from apps/web; standalone
            // production runs from /app with scripts under apps/web/scripts.
        }
    }
    throw new Error(`Unable to locate scripts/migrate.js from ${process.cwd()}`);
}

async function runPostRestoreMigrations(t: Awaited<ReturnType<typeof getTranslations>>) {
    const scriptPath = await resolveMigrationScriptPath();
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
        // C1-12 (run-10 cycle-1, SEC-02): minimal child env, matching the
        // discipline of the sibling mysqldump/mysql spawns. The migrate child
        // needs PATH + NODE_ENV, the DB_* connection vars consumed by
        // scripts/mysql-connection-options.js, and the two vars migrate.js
        // itself reads (ADMIN_PASSWORD for seed reconciliation,
        // UPLOAD_ORIGINAL_ROOT for path reconciliation) — NOT the full
        // process.env, which would leak SESSION_SECRET and every other runtime
        // secret into a child that never uses them.
        const migrateEnvKeys = [
            'PATH',
            'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_SSL', 'DB_SSL_CA',
            'ADMIN_PASSWORD', 'UPLOAD_ORIGINAL_ROOT',
        ] as const;
        // NODE_ENV is set in the initializer (Next's ProcessEnv augmentation
        // marks it readonly, so it cannot go through the keyed loop below).
        const migrateEnv: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
        for (const key of migrateEnvKeys) {
            const value = process.env[key];
            if (value !== undefined) migrateEnv[key] = value;
        }
        const migrate = spawn(process.execPath, [scriptPath], {
            env: migrateEnv,
        });
        let settled = false;
        const clearWatchdog = armDbChildProcessWatchdog(migrate, 'post-restore migration', (err) => {
            if (settled) return;
            settled = true;
            console.error('post-restore migrate timeout:', err);
            resolve({ success: false, error: t('restoreFailed') });
        });

        migrate.stdout.on('data', (data: Buffer) => {
            console.log(`post-restore migrate stdout: ${data.toString('utf8').trimEnd()}`);
        });
        migrate.stderr.on('data', (data: Buffer) => {
            const sensitiveValues = [process.env.DB_USER, process.env.DB_HOST, process.env.DB_NAME]
                .filter((value): value is string => Boolean(value));
            console.error(`post-restore migrate stderr: ${sanitizeStderr(data, process.env.DB_PASSWORD, sensitiveValues)}`);
        });
        migrate.on('close', (code: number) => {
            if (settled) return;
            settled = true;
            clearWatchdog();
            if (code === 0) {
                resolve({ success: true });
            } else {
                resolve({ success: false, error: t('restoreExitedWithCode', { code }) });
            }
        });
        migrate.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            clearWatchdog();
            console.error('post-restore migrate spawn error:', err);
            resolve({ success: false, error: t('restoreFailed') });
        });
    });
}
