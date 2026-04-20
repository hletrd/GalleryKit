import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { isValidFilename } from '@/lib/validation';
import { MAX_INPUT_PIXELS_TOPIC } from '@/lib/process-image';
const RESOURCES_ROOT = (() => {
    const monorepoPath = path.join(process.cwd(), 'apps/web/public/resources');
    const simplePath = path.join(process.cwd(), 'public/resources');
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();

const RESOURCES_DIR = RESOURCES_ROOT;

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

const MAX_FILE_SIZE = 200 * 1024 * 1024;

// Singleton promise to avoid concurrent mkdir races
let dirPromise: Promise<void> | null = null;
const ensureDir = () => {
    if (!dirPromise) {
        dirPromise = fs.mkdir(RESOURCES_DIR, { recursive: true }).then(() => {}).catch((e) => {
            dirPromise = null;
            throw e;
        });
    }
    return dirPromise;
};

function isAllowedExtension(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
}

export async function processTopicImage(file: File): Promise<string> {
    if (file.size > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    if (file.size === 0) {
        throw new Error('File is empty');
    }

    if (!isAllowedExtension(file.name)) {
        throw new Error('File type not allowed');
    }

    await ensureDir();

    const id = randomUUID();
    const filename = `${id}.webp`;
    const outputPath = path.join(RESOURCES_DIR, filename);

    // Stream to temp file first, then pass path to Sharp
    const tempPath = path.join(RESOURCES_DIR, `tmp-${id}`);
    try {
        const webStream = file.stream();
        const nodeStream = Readable.fromWeb(webStream as import('stream/web').ReadableStream);
        await pipeline(nodeStream, createWriteStream(tempPath, { mode: 0o600 }));

        await sharp(tempPath, { limitInputPixels: MAX_INPUT_PIXELS_TOPIC })
            .resize({ width: 512, height: 512, fit: 'cover' })
            .webp({ quality: 90 })
            .toFile(outputPath);

        await fs.unlink(tempPath).catch(() => {});
    } catch {
        await fs.unlink(tempPath).catch(() => {});
        await fs.unlink(outputPath).catch(() => {});
        throw new Error('Invalid image file');
    }

    return filename;
}

export async function deleteTopicImage(filename: string) {
    if (!filename || !isValidFilename(filename)) return;
    await fs.unlink(path.join(RESOURCES_DIR, filename)).catch(() => {});
}

/**
 * Remove orphaned tmp-* files from RESOURCES_DIR.
 * These are created during processTopicImage and may persist if the
 * process crashes between writing the temp file and renaming/deleting it.
 * Called at startup from bootstrapImageProcessingQueue (image-queue.ts),
 * similar to cleanOrphanedTmpFiles for image upload directories.
 */
export async function cleanOrphanedTopicTempFiles(): Promise<void> {
    try {
        const entries = await fs.readdir(RESOURCES_DIR);
        const tmpFiles = entries.filter(f => f.startsWith('tmp-'));
        if (tmpFiles.length > 0) {
            console.info(`[Cleanup] Removing ${tmpFiles.length} orphaned temp files from ${RESOURCES_DIR}`);
            await Promise.all(tmpFiles.map(f => fs.unlink(path.join(RESOURCES_DIR, f)).catch(() => {})));
        }
    } catch {
        // Directory may not exist yet — skip
    }
}
