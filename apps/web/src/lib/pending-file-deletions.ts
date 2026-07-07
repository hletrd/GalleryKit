import { db, pendingFileDeletions } from '@/db';
import { eq, sql } from 'drizzle-orm';
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

const CLEANUP_RETRY_DELAY_MS = 50;

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
