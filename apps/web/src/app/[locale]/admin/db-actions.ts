'use server';

import { db, connection } from "@/db";
import type { RowDataPacket } from "mysql2/promise";
import { images, imageTags, tags } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { spawn } from "child_process";
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
import { beginRestoreMaintenance, endRestoreMaintenance, getRestoreMaintenanceMessage } from "@/lib/restore-maintenance";
import { isIgnorableRestoreStdinError, MAX_RESTORE_SIZE_BYTES } from "@/lib/db-restore";

// escapeCsvField moved to `@/lib/csv-escape` so it can be unit-tested
// without the `'use server'` async-only constraint (C6R-RPL-06 / AGG6R-11).
// Re-import here to keep the existing call site unchanged.
import { escapeCsvField } from "@/lib/csv-escape";

export async function exportImagesCsv(): Promise<{ data?: string; error?: string; warning?: string }> {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }
    // C2R-02: defense-in-depth same-origin check for mutating/exporting server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }

    // group_concat_max_len is already set to 65535 on every pool connection
    // via poolConnection.on('connection', ...) in db/index.ts — no per-session
    // SET needed here (and a per-session SET would be unreliable in a pooled
    // environment where the SET and the SELECT may use different connections).

    let results = await db
        .select({
            id: images.id,
            filename: images.user_filename,
            title: images.title,
            width: images.width,
            height: images.height,
            captureDate: images.capture_date,
            topic: images.topic,
            tags: sql<string>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name} SEPARATOR ', ')`
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
            escapeCsvField(row.tags || ""),
        ].join(","));
    }

    // Release the DB results array before materializing the full CSV string
    const rowCount = results.length;
    // Release reference to allow GC — results are no longer needed
    results = [] as typeof results;

    const csvContent = csvLines.join("\n");

    const warning = rowCount >= 50000 ? t('csvTruncated') : undefined;

    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'csv_export', 'images', undefined, undefined, { rowCount }).catch(console.debug);

    return { data: csvContent, warning };
}

export async function dumpDatabase() {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) {
        return { success: false as const, error: t('unauthorized') };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { success: false as const, error: originError };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { success: false as const, error: maintenanceError };
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
        return { success: false as const, error: t('missingDbConfig') };
    }

    const filename = createBackupFilename();

    const backupsDir = path.join(process.cwd(), 'data', 'backups');
    const outputPath = path.join(backupsDir, filename);

    await fs.mkdir(backupsDir, { recursive: true });

    const isLocalDB = ['127.0.0.1', 'localhost', '::1'].includes(DB_HOST);
    const sslArgs = isLocalDB ? [] : ['--ssl-mode=REQUIRED'];

    return new Promise<{ success: boolean, filename?: string, url?: string, error?: string }>((resolve) => {
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

        const writeStream = createWriteStream(outputPath, { mode: 0o600 });
        let settled = false;
        let writeStreamHadError = false;

        dump.stdout.pipe(writeStream);

        writeStream.on('error', (err) => {
            writeStreamHadError = true;
            if (settled) return;
            settled = true;
            console.error('Backup writeStream error:', err);
            dump.kill();
            fs.unlink(outputPath).catch(() => {});
            resolve({ success: false, error: t('failedToWriteBackup') });
        });

        dump.stderr.on('data', (data: Buffer) => {
            console.error(`mysqldump stderr: ${data}`);
        });

        dump.on('close', async (code: number) => {
            if (settled) return;
            settled = true;
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
                    fs.unlink(outputPath).catch(() => {});
                    resolve({ success: false, error: t('failedToWriteBackup') });
                    return;
                }

                // Verify the backup file is non-empty and contains the expected
                // mysqldump header. An empty file would indicate mysqldump exited
                // 0 without producing output (e.g., permissions issue on some
                // MySQL versions that don't set a non-zero exit code).
                try {
                    const stats = await fs.stat(outputPath);
                    if (stats.size === 0) {
                        console.error('Backup file is empty despite mysqldump exit code 0');
                        fs.unlink(outputPath).catch(() => {});
                        resolve({ success: false, error: t('failedToWriteBackup') });
                        return;
                    }
                } catch {
                    fs.unlink(outputPath).catch(() => {});
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
                fs.unlink(outputPath).catch(() => {});
                resolve({ success: false, error: t('backupExitedWithCode', { code }) });
            }
        });

        dump.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            console.error('mysqldump spawn error:', err);
            fs.unlink(outputPath).catch(() => {});
            resolve({ success: false, error: t('backupFailed') });
        });
    });
}

// Restore intentionally uses a much smaller app-level cap than the generic
// server-action transport budget. Keep the UI/docs explicit about the 250 MB
// restore limit because Next.js may accept a larger request body before this
// action rejects it.
// DB advisory lock: prevents concurrent 250MB uploads filling /tmp.
// GET_LOCK is released automatically on connection close (crash-safe).

export async function restoreDatabase(formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) {
        return { success: false, error: t('unauthorized') };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { success: false, error: originError };

    // Use a dedicated connection from the pool so GET_LOCK and RELEASE_LOCK
    // execute on the same session. Advisory locks are session-scoped —
    // with pooled connections, GET_LOCK and RELEASE_LOCK may run on
    // different connections, making the lock unreliable.
    const conn = await connection.getConnection();
    try {
        // C2R-03: name the column via `AS acquired` and read it by name
        // instead of relying on `Object.values(lockRow)[0]` iteration order.
        // Matches the admin-user delete pattern at admin-users.ts:186-189.
        const [lockRows] = await conn.query<(RowDataPacket & { acquired: number | bigint | null })[]>(
            "SELECT GET_LOCK('gallerykit_db_restore', 0) AS acquired"
        );
        const acquired = lockRows[0]?.acquired;
        if (acquired !== 1 && acquired !== BigInt(1)) {
            return { success: false, error: t('restoreInProgress') };
        }

        if (!beginRestoreMaintenance()) {
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
            await conn.query("SELECT RELEASE_LOCK('gallerykit_db_restore')").catch((err) => {
                console.debug('RELEASE_LOCK (maintenance-begin early-return) failed:', err);
            });
            return { success: false, error: t('restoreInProgress') };
        }

        try {
            try {
                await flushBufferedSharedGroupViewCounts();
                await quiesceImageProcessingQueueForRestore();
            } catch (err) {
                console.error('Failed to prepare restore maintenance window', err);
                return { success: false, error: t('restoreFailed') };
            }

            return await runRestore(formData, t);
        } finally {
            endRestoreMaintenance();
            await resumeImageProcessingQueueAfterRestore().catch((err) => {
                console.error('Failed to resume image-processing queue after restore', err);
            });
            // C8R-RPL-09 / AGG8R-03: log release failure at debug
            // instead of silencing so the operator has a signal if
            // the release round-trip errors.
            await conn.query("SELECT RELEASE_LOCK('gallerykit_db_restore')").catch((err) => {
                console.debug('RELEASE_LOCK (restore finally) failed:', err);
            });
        }
    } finally {
        conn.release();
    }
}

async function runRestore(formData: FormData, t: Awaited<ReturnType<typeof getTranslations>>) {
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
    try {
        const webStream = file.stream();
        const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream);
        await pipeline(nodeStream, createWriteStream(tempPath, { mode: 0o600 }));
    } catch {
        await fs.unlink(tempPath).catch(() => {});
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
    const validHeader = /^(--)|(CREATE\s)|(INSERT\s)|(DROP\s)|(SET\s)|(\/\*!)/.test(headerBytes.trimStart());
    if (!validHeader) {
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: t('invalidSqlDump') };
    }

    const CHUNK_SIZE = 1024 * 1024;
    const fileSize = (await fs.stat(tempPath)).size;
    const scanFd = await fs.open(tempPath, 'r');
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
                // Don't close scanFd here — the finally block handles it
                await fs.unlink(tempPath).catch(() => {});
                return { success: false, error: t('disallowedSql') };
            }
            scanTail = nextTail;
        }
    } finally {
        await scanFd.close();
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: t('missingDbConfig') };
    }

    const isLocalDB = ['127.0.0.1', 'localhost', '::1'].includes(DB_HOST);
    const restoreSslArgs = isLocalDB ? [] : ['--ssl-mode=REQUIRED'];

    return new Promise<{ success: boolean, error?: string }>((resolve) => {
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

        const failRestore = async (error: string, logLabel: string, reason: unknown) => {
            if (settled) return;
            settled = true;
            console.error(logLabel, reason);
            readStream.destroy();
            restore.stdin.destroy();
            restore.kill();
            await fs.unlink(tempPath).catch(() => {});
            resolve({ success: false, error });
        };

        // Register all event handlers BEFORE piping to prevent missed events
        readStream.on('error', async (err) => {
            await failRestore(t('failedToReadRestore'), 'Failed to read restore file:', err);
        });

        restore.stdin.on('error', async (err: NodeJS.ErrnoException) => {
            if (isIgnorableRestoreStdinError(err)) {
                return;
            }

            await failRestore(t('restoreFailed'), 'mysql restore stdin error:', err);
        });

        restore.stderr.on('data', (data: Buffer) => {
            console.error(`mysql restore stderr: ${data}`);
        });

        restore.on('close', async (code: number) => {
            if (settled) return;
            settled = true;
            await fs.unlink(tempPath).catch(() => {});
            if (code === 0) {
                // Audit logging is fire-and-forget; wrap in try-catch so a
                // transient DB error doesn't prevent the success resolve.
                try {
                    const currentUser = await getCurrentUser();
                    logAuditEvent(currentUser?.id ?? null, 'db_restore', 'database', DB_NAME).catch(console.debug);
                } catch (err) {
                    console.debug('Failed to log audit event for restore:', err);
                }
                revalidateAllAppData();
                resolve({ success: true });
            } else {
                resolve({ success: false, error: t('restoreExitedWithCode', { code }) });
            }
        });

        restore.on('error', async (err: Error) => {
            await failRestore(t('restoreFailed'), 'mysql restore spawn error:', err);
        });

        // Start piping after all handlers are registered
        readStream.pipe(restore.stdin);
    });
}
