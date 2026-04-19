'use server';

import { db, connection } from "@/db";
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
import { revalidateAllAppData } from "@/lib/revalidation";
import { containsDangerousSql } from "@/lib/sql-restore-scan";

function escapeCsvField(value: string): string {
    // Strip carriage returns and newlines to prevent CSV injection via embedded line breaks
    value = value.replace(/[\r\n]/g, ' ');
    // Prefix formula injection characters with a single quote
    if (value.match(/^[=+\-@\t]/)) {
        value = "'" + value;
    }
    // Wrap in double quotes and escape embedded double quotes by doubling them
    return '"' + value.replace(/"/g, '""') + '"';
}

export async function exportImagesCsv(): Promise<{ data?: string; error?: string; warning?: string }> {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    const results = await db
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
    const rows = results.map(row => [
        escapeCsvField(String(row.id)),
        escapeCsvField(row.filename || ""),
        escapeCsvField(row.title || ""),
        escapeCsvField(String(row.width)),
        escapeCsvField(String(row.height)),
        escapeCsvField(row.captureDate ? String(row.captureDate) : ""),
        escapeCsvField(row.topic || ""),
        escapeCsvField(row.tags || ""),
    ]);

    const csvContent = [
        headers.join(","),
        ...rows.map(r => r.join(","))
    ].join("\n");

    const warning = results.length >= 50000 ? 'Result truncated at 50,000 rows' : undefined;
    return { data: csvContent, warning };
}

export async function dumpDatabase() {
    if (!(await isAdmin())) {
        return { success: false as const, error: 'Unauthorized' };
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
        return { success: false as const, error: 'Missing database configuration' };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}-${randomUUID().slice(0, 8)}.sql`;

    const backupsDir = path.join(process.cwd(), 'data', 'backups');
    const outputPath = path.join(backupsDir, filename);

    await fs.mkdir(backupsDir, { recursive: true });

    const isLocalDB = ['127.0.0.1', 'localhost', '::1'].includes(DB_HOST);
    const sslArgs = isLocalDB ? [] : ['--ssl-mode=REQUIRED'];

    return new Promise<{ success: boolean, filename?: string, url?: string, error?: string }>((resolve) => {
        const dump = spawn('mysqldump', [
            `-h${DB_HOST}`,
            `-P${DB_PORT || '3306'}`,
            `-u${DB_USER}`,
            '--single-transaction', // Good for InnoDB
            '--quick',
            ...sslArgs,
            DB_NAME
        ], {
            env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV, MYSQL_PWD: DB_PASSWORD, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL }
        });

        const writeStream = createWriteStream(outputPath);
        let settled = false;

        dump.stdout.pipe(writeStream);

        writeStream.on('error', (err) => {
            if (settled) return;
            settled = true;
            console.error('Backup writeStream error:', err);
            dump.kill();
            fs.unlink(outputPath).catch(() => {});
            resolve({ success: false, error: 'Failed to write backup file' });
        });

        dump.stderr.on('data', (data: Buffer) => {
            console.error(`mysqldump stderr: ${data}`);
        });

        dump.on('close', (code: number) => {
            if (settled) return;
            settled = true;
            if (code === 0) {
                // Return filename; url points to authenticated admin download route
                resolve({ success: true, filename, url: `/api/admin/db/download?file=${encodeURIComponent(filename)}` });
            } else {
                fs.unlink(outputPath).catch(() => {});
                resolve({ success: false, error: `mysqldump exited with code ${code}` });
            }
        });

        dump.on('error', (err: Error) => {
            if (settled) return;
            settled = true;
            console.error('mysqldump spawn error:', err);
            fs.unlink(outputPath).catch(() => {});
            resolve({ success: false, error: 'Database backup failed' });
        });
    });
}

// Keep in sync with next.config.ts `serverActions.bodySizeLimit` — uploads above
// that value are rejected by the Next.js framework before reaching this action,
// so a larger value here would be misleading.
const MAX_RESTORE_SIZE = 250 * 1024 * 1024; // 250 MB

// DB advisory lock: prevents concurrent 250MB uploads filling /tmp.
// GET_LOCK is released automatically on connection close (crash-safe).

export async function restoreDatabase(formData: FormData) {
    if (!(await isAdmin())) {
        return { success: false, error: 'Unauthorized' };
    }

    // Use a dedicated connection from the pool so GET_LOCK and RELEASE_LOCK
    // execute on the same session. Advisory locks are session-scoped —
    // with pooled connections, GET_LOCK and RELEASE_LOCK may run on
    // different connections, making the lock unreliable.
    const conn = await connection.getConnection();
    try {
        const [lockRows] = await conn.query(
            "SELECT GET_LOCK('gallerykit_db_restore', 0) AS `GET_LOCK(name, timeout)`"
        ) as [Record<string, unknown>[], unknown];
        const lockRow = lockRows[0];
        const acquired = Object.values(lockRow)[0];
        if (acquired !== 1 && acquired !== BigInt(1)) {
            return { success: false, error: "Another restore is already in progress" };
        }

        try {
            return await runRestore(formData);
        } finally {
            await conn.query("SELECT RELEASE_LOCK('gallerykit_db_restore')").catch(() => {});
        }
    } finally {
        conn.release();
    }
}

async function runRestore(formData: FormData) {
    const fileEntry = formData.get('file');
    if (!fileEntry || !(fileEntry instanceof File)) {
        return { success: false, error: "No file provided" };
    }
    const file = fileEntry;

    if (file.size > MAX_RESTORE_SIZE) {
        return { success: false, error: "File too large (max 250MB)" };
    }

    // Stream to disk to avoid holding up to 250MB in Node.js heap.
    const tempPath = path.join(os.tmpdir(), `restore-${randomUUID()}.sql`);
    try {
        const webStream = file.stream();
        const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream);
        await pipeline(nodeStream, createWriteStream(tempPath, { mode: 0o600 }));
    } catch {
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: "Failed to save uploaded file" };
    }

    // Validate file header
    const headerBuf = Buffer.alloc(256);
    const fd = await fs.open(tempPath, 'r');
    try {
        await fd.read(headerBuf, 0, 256, 0);
    } finally {
        await fd.close();
    }
    const headerBytes = headerBuf.toString('utf8');
    const validHeader = /^(--)|(CREATE\s)|(INSERT\s)|(DROP\s)|(SET\s)|(\/\*!)/.test(headerBytes.trimStart());
    if (!validHeader) {
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: "Invalid SQL dump file" };
    }

    const CHUNK_SIZE = 1024 * 1024;
    const OVERLAP = 256; // overlap to catch patterns split across chunks
    const fileSize = (await fs.stat(tempPath)).size;
    const scanFd = await fs.open(tempPath, 'r');
    try {
        for (let off = 0; off < fileSize; off += CHUNK_SIZE) {
            const readSize = Math.min(CHUNK_SIZE + OVERLAP, fileSize - off);
            const chunkBuf = Buffer.alloc(readSize);
            await scanFd.read(chunkBuf, 0, readSize, off);
            const chunk = chunkBuf.toString('utf8');
            if (containsDangerousSql(chunk)) {
                // Don't close scanFd here — the finally block handles it
                await fs.unlink(tempPath).catch(() => {});
                return { success: false, error: "SQL file contains disallowed statements" };
            }
        }
    } finally {
        await scanFd.close();
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: "Missing database configuration" };
    }

    const isLocalDB = ['127.0.0.1', 'localhost', '::1'].includes(DB_HOST);
    const restoreSslArgs = isLocalDB ? [] : ['--ssl-mode=REQUIRED'];

    return new Promise<{ success: boolean, error?: string }>((resolve) => {
        const restore = spawn('mysql', [
            `-h${DB_HOST}`,
            `-P${DB_PORT || '3306'}`,
            `-u${DB_USER}`,
            '--one-database',
            ...restoreSslArgs,
            DB_NAME
        ], {
            env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: process.env.NODE_ENV, MYSQL_PWD: DB_PASSWORD, LANG: process.env.LANG, LC_ALL: process.env.LC_ALL }
        });

        const readStream = createReadStream(tempPath);
        let settled = false;

        // Register all event handlers BEFORE piping to prevent missed events
        readStream.on('error', async (err) => {
            if (settled) return;
            settled = true;
            console.error('Failed to read restore file:', err);
            restore.stdin.end();
            await fs.unlink(tempPath).catch(() => {});
            resolve({ success: false, error: 'Failed to read restore file' });
        });

        restore.stderr.on('data', (data: Buffer) => {
            console.error(`mysql restore stderr: ${data}`);
        });

        restore.on('close', async (code: number) => {
            if (settled) return;
            settled = true;
            await fs.unlink(tempPath).catch(() => {});
            if (code === 0) {
                const currentUser = await getCurrentUser();
                logAuditEvent(currentUser?.id ?? null, 'db_restore', 'database', DB_NAME).catch(console.debug);
                revalidateAllAppData();
                resolve({ success: true });
            } else {
                resolve({ success: false, error: `mysql restore exited with code ${code}` });
            }
        });

        restore.on('error', async (err: Error) => {
            if (settled) return;
            settled = true;
            console.error('mysql restore spawn error:', err);
            await fs.unlink(tempPath).catch(() => {});
            resolve({ success: false, error: 'Database restore failed' });
        });

        // Start piping after all handlers are registered
        readStream.pipe(restore.stdin);
    });
}
