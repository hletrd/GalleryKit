'use server';

import { db } from "@/db";
import { images, imageTags, tags } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { isAdmin } from "@/app/actions";
import { revalidatePath } from "next/cache";

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
            caption: images.caption,
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
    const headers = ["ID", "Filename", "Title", "Caption", "Width", "Height", "Capture Date", "Topic", "Tags"];
    const rows = results.map(row => [
        row.id,
        row.filename,
        row.title || "",
        row.caption || "",
        row.width,
        row.height,
        row.captureDate ? new Date(row.captureDate).toISOString() : "",
        row.topic,
        `"${(row.tags || "").replace(/"/g, '""')}"` // Quote and escape tags
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
    const outputPath = path.join(process.cwd(), 'public', 'uploads', filename); // Save to temp/uploads for download

    // Ensure uploads dir exists (should exist in prod)
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise<{ success: boolean, url?: string, error?: string }>((resolve, reject) => {
        const dump = spawn('mysqldump', [
            `-h${DB_HOST}`,
            `-P${DB_PORT || '3306'}`,
            `-u${DB_USER}`,
            `-p${DB_PASSWORD}`,
            '--single-transaction', // Good for InnoDB
            '--quick',
            DB_NAME
        ]);

        const writeStream = require('fs').createWriteStream(outputPath);

        dump.stdout.pipe(writeStream);

        dump.stderr.on('data', (data: any) => {
            console.error(`mysqldump stderr: ${data}`);
        });

        dump.on('close', (code: number) => {
            if (code === 0) {
                // Return relative URL for download
                resolve({ success: true, url: `/uploads/${filename}` });
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

export async function restoreDatabase(formData: FormData) {
    if (!(await isAdmin())) {
        throw new Error("Unauthorized");
    }

    const file = formData.get('file') as File;
    if (!file || !file.name) {
        return { success: false, error: "No file provided" };
    }

    // Save uploaded file temporarily
    const buffer = Buffer.from(await file.arrayBuffer());
    const tempPath = path.join(process.cwd(), 'backup-restore-temp.sql');
    await fs.writeFile(tempPath, buffer);

    const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT } = process.env;

    return new Promise<{ success: boolean, error?: string }>((resolve) => {
        const restore = spawn('mysql', [
            `-h${DB_HOST}`,
            `-P${DB_PORT || '3306'}`,
            `-u${DB_USER}`,
            `-p${DB_PASSWORD}`,
            DB_NAME
        ]);

        const readStream = require('fs').createReadStream(tempPath);
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
