import sharp from 'sharp';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import { isValidFilename } from '@/lib/validation';
import { MAX_INPUT_PIXELS_TOPIC } from '@/lib/process-image';
import { MAX_UPLOAD_FILE_BYTES } from '@/lib/upload-limits';
const RESOURCES_ROOT = (() => {
    // ORCH-C3-TMPDIR (AGG-C3-03): honor an explicit override so tests (and any
    // sandboxed run) can redirect topic-image scratch + output to an OS temp
    // dir instead of the repo-tracked public/resources/ tree. Mirrors the
    // UPLOAD_ROOT / UPLOAD_ORIGINAL_ROOT override pattern in lib/upload-paths.ts.
    // Production leaves this unset, so the cwd-derived behavior is unchanged.
    const envRoot = process.env.TOPIC_RESOURCES_ROOT?.trim();
    if (envRoot) return envRoot;

    const monorepoPath = path.join(process.cwd(), 'apps/web/public/resources');
    const simplePath = path.join(process.cwd(), 'public/resources');
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();

const RESOURCES_DIR = RESOURCES_ROOT;
const TOPIC_TMP_ROOT = (() => {
    const envRoot = process.env.TOPIC_RESOURCES_TMP_ROOT?.trim();
    if (envRoot) return envRoot;

    const monorepoPath = path.join(process.cwd(), 'apps/web/data/tmp/topic-resources');
    const simplePath = path.join(process.cwd(), 'data/tmp/topic-resources');
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

// R4C2 ARCH-R4C2-06: single source of truth with the advertised per-file cap.
const MAX_FILE_SIZE = MAX_UPLOAD_FILE_BYTES;

// Singleton promise to avoid concurrent mkdir races
let dirPromise: Promise<void> | null = null;
const ensureDir = () => {
    if (!dirPromise) {
        // AGG-R5C3-09 (BUG-R5C3-06): guarded reset. Capture this attempt's
        // promise in a local and only null the singleton if it STILL points at
        // THIS attempt. The previous unconditional `dirPromise = null` let a
        // failed attempt clobber a newer in-flight one set by a concurrent
        // caller — matching the documented `ensureDirs` singleton pattern used
        // elsewhere.
        const p = fs.mkdir(RESOURCES_DIR, { recursive: true }).then(() => {}).catch((e) => {
            if (dirPromise === p) dirPromise = null;
            throw e;
        });
        dirPromise = p;
    }
    return dirPromise;
};

let tmpDirPromise: Promise<void> | null = null;
const ensureTmpDir = () => {
    if (!tmpDirPromise) {
        const p = fs.mkdir(TOPIC_TMP_ROOT, { recursive: true }).then(() => {}).catch((e) => {
            if (tmpDirPromise === p) tmpDirPromise = null;
            throw e;
        });
        tmpDirPromise = p;
    }
    return tmpDirPromise;
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

    await Promise.all([ensureDir(), ensureTmpDir()]);

    const id = randomUUID();
    const filename = `${id}.webp`;
    const outputPath = path.join(RESOURCES_DIR, filename);

    // Stream to a private temp file first, then pass path to Sharp. Legacy
    // public/resources/tmp-* files are still cleaned by cleanOrphanedTopicTempFiles().
    const tempPath = path.join(TOPIC_TMP_ROOT, `tmp-${id}`);
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

/** C1-05 (run-10 cycle-1, DBG-01): minimum age before a tmp-* topic file is
 *  treated as orphaned. bootstrapImageProcessingQueue is NOT startup-only — it
 *  re-runs on every continuation batch and every 30 s bootstrap retry — so an
 *  un-gated cleanup could delete an admin's mid-stream topic-cover upload
 *  (processTopicImage pipes the upload to tmp-{uuid} before Sharp reads it).
 *  Mirrors ORPHANED_DERIVATIVE_TEMP_MIN_AGE_MS in image-queue.ts (kept as a
 *  local constant — importing it from image-queue would create a module cycle,
 *  since image-queue imports this module for the bootstrap cleanup call). */
export const ORPHANED_TOPIC_TEMP_MIN_AGE_MS = 60 * 60 * 1000;

/**
 * Remove orphaned tmp-* files from the private topic temp dir and the legacy
 * public resources dir. Legacy public tmp files may exist from older releases.
 * Called from bootstrapImageProcessingQueue (image-queue.ts), similar to
 * cleanOrphanedTmpFiles for image upload directories — and age-gated exactly
 * like that sibling, so fresh in-flight uploads are never raced (C1-05).
 */
export async function cleanOrphanedTopicTempFiles(): Promise<void> {
    try {
        const now = Date.now();
        await Promise.all([TOPIC_TMP_ROOT, RESOURCES_DIR].map(async (dir) => {
            const entries = await fs.readdir(dir).catch(() => [] as string[]);
            const tmpFiles = entries.filter(f => f.startsWith('tmp-'));
            if (tmpFiles.length === 0) return;
            const staleFiles: string[] = [];
            await Promise.all(tmpFiles.map(async (f) => {
                try {
                    const stat = await fs.stat(path.join(dir, f));
                    if (now - stat.mtimeMs >= ORPHANED_TOPIC_TEMP_MIN_AGE_MS) {
                        staleFiles.push(f);
                    }
                } catch {
                    // File vanished mid-scan — nothing to clean.
                }
            }));
            if (staleFiles.length > 0) {
                console.info(`[Cleanup] Removing ${staleFiles.length} orphaned temp files from ${dir}`);
                await Promise.all(staleFiles.map(f => fs.unlink(path.join(dir, f)).catch(() => {})));
            }
        }));
    } catch {
        // Directory may not exist yet — skip
    }
}
