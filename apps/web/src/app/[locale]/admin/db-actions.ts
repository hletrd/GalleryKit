'use server';

import { db } from "@/db";
import { images, imageTags, tags } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import path from "path";
import os from "os";
import { randomUUID } from "crypto";
import { isAdmin } from "@/app/actions";
import { revalidatePath } from "next/cache";

// --- CSV helpers ---

function escapeCsvField(value: string): string {
    // Prefix formula injection characters with a single quote
    if (value.match(/^[=+\-@\t\r]/)) {
        value = "'" + value;
    }
    // Wrap in double quotes and escape embedded double quotes by doubling them
    return '"' + value.replace(/"/g, '""') + '"';
}

// --- CSV Export ---

export async function exportImagesCsv() {
    if (!(await isAdmin())) {
        throw new Error("Unauthorized");
    }

    // Query images with aggregated tags
    // Group concat is database specific. MySQL uses GROUP_CONCAT.
    // Drizzle query builder:
    const results = await db
        .select({
            id: images.id,
            filename: images.filename_original,
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
        .groupBy(images.id);

    // Convert to CSV
    const headers = ["ID", "Filename", "Title", "Width", "Height", "Capture Date", "Topic", "Tags"];
    const rows = results.map(row => [
        escapeCsvField(String(row.id)),
        escapeCsvField(row.filename || ""),
        escapeCsvField(row.title || ""),
        escapeCsvField(String(row.width)),
        escapeCsvField(String(row.height)),
        escapeCsvField(row.captureDate ? (() => { const d = new Date(row.captureDate); return Number.isNaN(d.getTime()) ? '' : d.toISOString(); })() : ""),
        escapeCsvField(row.topic || ""),
        escapeCsvField(row.tags || ""),
    ]);

    const csvContent = [
        headers.join(","),
        ...rows.map(r => r.join(","))
    ].join("\n");

    return csvContent;
}

// --- DB Backup (Dump) ---

export async function dumpDatabase() {
    if (!(await isAdmin())) {
        throw new Error("Unauthorized");
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_NAME) {
        throw new Error("Missing database configuration");
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${DB_NAME}-${timestamp}.sql`;

    // Save to a non-public backups directory (mounted as volume in Docker)
    const backupsDir = path.join(process.cwd(), 'data', 'backups');
    const outputPath = path.join(backupsDir, filename);

    await fs.mkdir(backupsDir, { recursive: true });

    return new Promise<{ success: boolean, filename?: string, url?: string, error?: string }>((resolve) => {
        const dump = spawn('mysqldump', [
            `-h${DB_HOST}`,
            `-P${DB_PORT || '3306'}`,
            `-u${DB_USER}`,
            '--single-transaction', // Good for InnoDB
            '--quick',
            DB_NAME
        ], {
            env: { ...process.env, MYSQL_PWD: DB_PASSWORD }
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

// --- DB Restore ---

const MAX_RESTORE_SIZE = 500 * 1024 * 1024; // 500 MB

export async function restoreDatabase(formData: FormData) {
    if (!(await isAdmin())) {
        throw new Error("Unauthorized");
    }

    const fileEntry = formData.get('file');
    if (!fileEntry || !(fileEntry instanceof File)) {
        return { success: false, error: "No file provided" };
    }
    const file = fileEntry;

    // File size validation
    if (file.size > MAX_RESTORE_SIZE) {
        return { success: false, error: "File too large (max 500MB)" };
    }

    // Write uploaded file to disk first to avoid holding up to 500MB in Node.js heap
    // during the dangerous-pattern scan. The scan reads from disk in streaming chunks.
    const tempPath = path.join(os.tmpdir(), `restore-${randomUUID()}.sql`);
    try {
        const fileBuffer = Buffer.from(await file.arrayBuffer());
        await fs.writeFile(tempPath, fileBuffer);
    } catch {
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: "Failed to save uploaded file" };
    }
    // fileBuffer is now out of scope and eligible for GC

    // Validate file header: must start with mysqldump headers
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

    // Reject dangerous SQL statements that --one-database does not block.
    // Scan the file from disk in overlapping 1MB chunks (not in-memory).
    const dangerousPatterns = [
        /\bGRANT\s/i,
        /\bCREATE\s+USER\b/i,
        /\bALTER\s+USER\b/i,
        /\bSET\s+PASSWORD\b/i,
        /\bDROP\s+DATABASE\b/i,
        /\bLOAD\s+DATA\b/i,
        /\bINTO\s+OUTFILE\b/i,
        /\bINTO\s+DUMPFILE\b/i,
        /\bSYSTEM\s+\w/i,
        /\bSHUTDOWN\b/i,
        /\bSOURCE\s/i,
        // Stored routines / events can execute arbitrary SQL on triggers
        /\bCREATE\s+(OR\s+REPLACE\s+)?TRIGGER\b/i,
        /\bCREATE\s+(OR\s+REPLACE\s+)?FUNCTION\b/i,
        /\bCREATE\s+(OR\s+REPLACE\s+)?PROCEDURE\b/i,
        /\bCREATE\s+(OR\s+REPLACE\s+)?EVENT\b/i,
        /\bALTER\s+EVENT\b/i,
        // MySQL conditional comments can hide executable SQL: /*!50003 GRANT ... */
        /\/\*!\d*\s*(GRANT|CREATE\s+USER|ALTER\s+USER|SET\s+PASSWORD|DROP\s+DATABASE|LOAD\s+DATA|SHUTDOWN)/i,
        // DELIMITER changes can defeat statement-level pattern matching
        /\bDELIMITER\b/i,
        // Plugin installation and global config changes
        /\bINSTALL\s+PLUGIN\b/i,
        /\bSET\s+GLOBAL\b/i,
        /\bCREATE\s+SERVER\b/i,
    ];
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
            for (const pattern of dangerousPatterns) {
                if (pattern.test(chunk)) {
                    // Don't close scanFd here — the finally block handles it
                    await fs.unlink(tempPath).catch(() => {});
                    return { success: false, error: "SQL file contains disallowed statements" };
                }
            }
        }
    } finally {
        await scanFd.close();
    }

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    if (!DB_HOST || !DB_USER || !DB_NAME) {
        await fs.unlink(tempPath).catch(() => {});
        return { success: false, error: "Missing database configuration" };
    }

    return new Promise<{ success: boolean, error?: string }>((resolve) => {
        const restore = spawn('mysql', [
            `-h${DB_HOST}`,
            `-P${DB_PORT || '3306'}`,
            `-u${DB_USER}`,
            '--one-database',
            DB_NAME
        ], {
            env: { ...process.env, MYSQL_PWD: DB_PASSWORD }
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
                revalidatePath('/');
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
