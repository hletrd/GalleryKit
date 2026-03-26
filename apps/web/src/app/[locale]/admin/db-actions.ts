'use server';

import { db } from "@/db";
import { images, imageTags, tags } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { spawn } from "child_process";
import fs from "fs/promises";
import { createWriteStream, createReadStream } from "fs";
import path from "path";
import os from "os";
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
            tags: sql<string>`GROUP_CONCAT(${tags.name} SEPARATOR ', ')`
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
        escapeCsvField(row.captureDate ? new Date(row.captureDate).toISOString() : ""),
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

        dump.stdout.pipe(writeStream);

        dump.stderr.on('data', (data: any) => {
            console.error(`mysqldump stderr: ${data}`);
        });

        dump.on('close', (code: number) => {
            if (code === 0) {
                // Return filename; url points to authenticated admin download route
                resolve({ success: true, filename, url: `/api/admin/db/download?file=${encodeURIComponent(filename)}` });
            } else {
                resolve({ success: false, error: `mysqldump exited with code ${code}` });
            }
        });

        dump.on('error', (err: any) => {
            resolve({ success: false, error: err.message });
        });
    });
}

// --- DB Restore ---

const MAX_RESTORE_SIZE = 500 * 1024 * 1024; // 500 MB

export async function restoreDatabase(formData: FormData) {
    if (!(await isAdmin())) {
        throw new Error("Unauthorized");
    }

    const file = formData.get('file') as File;
    if (!file || !file.name) {
        return { success: false, error: "No file provided" };
    }

    // File size validation
    if (file.size > MAX_RESTORE_SIZE) {
        return { success: false, error: "File too large (max 500MB)" };
    }

    // Save uploaded file temporarily to os.tmpdir()
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate file content: must start with mysqldump headers (-- comment or SQL keywords)
    const headerBytes = buffer.slice(0, 256).toString('utf8');
    const validHeader = /^(--)|(CREATE\s)|(INSERT\s)|(DROP\s)|(SET\s)|(\/\*!)/.test(headerBytes.trimStart());
    if (!validHeader) {
        return { success: false, error: "Invalid SQL dump file" };
    }

    const tempPath = path.join(os.tmpdir(), `restore-${Date.now()}.sql`);
    await fs.writeFile(tempPath, buffer);

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
        readStream.pipe(restore.stdin);

        restore.stderr.on('data', (data: any) => {
            console.error(`mysql restore stderr: ${data}`);
        });

        restore.on('close', async (code: number) => {
            // Cleanup temp file
            await fs.unlink(tempPath).catch(() => {});

            if (code === 0) {
                revalidatePath('/'); // Revalidate everything
                resolve({ success: true });
            } else {
                resolve({ success: false, error: `mysql restore exited with code ${code}` });
            }
        });

        restore.on('error', async (err: any) => {
            await fs.unlink(tempPath).catch(() => {});
            resolve({ success: false, error: err.message });
        });
    });
}
