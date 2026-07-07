import { db, pendingFileDeletions } from '@/db';
import { asc, eq, sql } from 'drizzle-orm';
import { deleteImageVariantsStrict } from '@/lib/process-image';
import {
    deleteOriginalUploadFileStrict,
    UPLOAD_DIR_AVIF,
    UPLOAD_DIR_JPEG,
    UPLOAD_DIR_WEBP,
} from '@/lib/upload-paths';

export type ImageCleanupTarget = 'original' | 'webp' | 'avif' | 'jpeg';

export type ImageCleanupFailure = {
    target: ImageCleanupTarget;
    filename: string;
    reason: string;
};

export type PendingFileDeletionRecord = {
    id: number;
    image_id: number | null;
    filename_original: string;
    filename_webp: string;
    filename_avif: string;
    filename_jpeg: string;
};

export type PendingFileDeletionDrainResult = {
    attempted: number;
    cleaned: number;
    failed: number;
};

const CLEANUP_RETRY_DELAY_MS = 50;
const DEFAULT_PENDING_FILE_DELETION_DRAIN_LIMIT = 25;

function normalizeDrainLimit(limit: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_PENDING_FILE_DELETION_DRAIN_LIMIT;
    return Math.max(1, Math.min(100, Math.floor(limit)));
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function collectImageCleanupFailures(tasks: {
    target: ImageCleanupTarget;
    filename: string;
    operation: () => Promise<void>;
}[]): Promise<ImageCleanupFailure[]> {
    const settled = await Promise.all(tasks.map(async (task) => {
        let lastReason: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await task.operation();
                return null;
            } catch (err) {
                lastReason = err;
                if (attempt === 0) {
                    await wait(CLEANUP_RETRY_DELAY_MS);
                }
            }
        }
        return {
            target: task.target,
            filename: task.filename,
            reason: lastReason instanceof Error ? lastReason.message : String(lastReason),
        };
    }));

    return settled.filter((failure): failure is ImageCleanupFailure => failure !== null);
}

function describeCleanupFailures(failures: ImageCleanupFailure[]): string {
    return JSON.stringify(failures.map((failure) => ({
        target: failure.target,
        filename: failure.filename,
        reason: failure.reason,
    })));
}

export async function cleanupPendingFileDeletion(record: PendingFileDeletionRecord): Promise<ImageCleanupFailure[]> {
    const failures = await collectImageCleanupFailures([
        { target: 'original', filename: record.filename_original, operation: () => deleteOriginalUploadFileStrict(record.filename_original) },
        { target: 'webp', filename: record.filename_webp, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_WEBP, record.filename_webp, []) },
        { target: 'avif', filename: record.filename_avif, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_AVIF, record.filename_avif, []) },
        { target: 'jpeg', filename: record.filename_jpeg, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_JPEG, record.filename_jpeg, []) },
    ]);

    if (failures.length === 0) {
        await db.delete(pendingFileDeletions).where(eq(pendingFileDeletions.id, record.id));
        return [];
    }

    await db.update(pendingFileDeletions)
        .set({
            attempts: sql`${pendingFileDeletions.attempts} + 1`,
            last_error: describeCleanupFailures(failures),
        })
        .where(eq(pendingFileDeletions.id, record.id));

    return failures;
}

export async function drainPendingFileDeletions(
    limit = DEFAULT_PENDING_FILE_DELETION_DRAIN_LIMIT,
): Promise<PendingFileDeletionDrainResult> {
    const rows: PendingFileDeletionRecord[] = await db.select({
        id: pendingFileDeletions.id,
        image_id: pendingFileDeletions.image_id,
        filename_original: pendingFileDeletions.filename_original,
        filename_webp: pendingFileDeletions.filename_webp,
        filename_avif: pendingFileDeletions.filename_avif,
        filename_jpeg: pendingFileDeletions.filename_jpeg,
    })
        .from(pendingFileDeletions)
        .orderBy(asc(pendingFileDeletions.updated_at), asc(pendingFileDeletions.id))
        .limit(normalizeDrainLimit(limit));

    let cleaned = 0;
    let failed = 0;

    for (const row of rows) {
        const failures = await cleanupPendingFileDeletion(row);
        if (failures.length === 0) {
            cleaned++;
            continue;
        }

        failed++;
        console.error('Pending file deletion retry failed', {
            pendingFileDeletionId: row.id,
            imageId: row.image_id,
            failures,
        });
    }

    return { attempted: rows.length, cleaned, failed };
}
