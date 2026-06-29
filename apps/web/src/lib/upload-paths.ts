/**
 * Upload Path Constants
 *
 * Single source of truth for all upload directory paths.
 * Previously duplicated in process-image.ts, storage/local.ts, and serve-upload.ts.
 */

import path from 'path';
import * as fs from 'fs/promises';
import { isValidFilename } from '@/lib/validation';

/** Root directory for all uploaded files. Derived from UPLOAD_ROOT env var or cwd. */
export const UPLOAD_ROOT = (() => {
    const envRoot = process.env.UPLOAD_ROOT?.trim();
    if (envRoot) return envRoot;

    const monorepoPath = path.join(process.cwd(), 'apps/web/public/uploads');
    const simplePath = path.join(process.cwd(), 'public/uploads');
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();

/** Legacy directory where original uploads used to live under the public web root. */
export const LEGACY_UPLOAD_DIR_ORIGINAL = path.join(UPLOAD_ROOT, 'original');
/** Private directory for original uploads. Derived from UPLOAD_ORIGINAL_ROOT env var or cwd. */
export const UPLOAD_ORIGINAL_ROOT = (() => {
    const envRoot = process.env.UPLOAD_ORIGINAL_ROOT?.trim();
    if (envRoot) return envRoot;

    const monorepoPath = path.join(process.cwd(), 'apps/web/data/uploads/original');
    const simplePath = path.join(process.cwd(), 'data/uploads/original');
    if (process.cwd().endsWith('apps/web')) {
        return simplePath;
    }
    return monorepoPath;
})();

/** Directory for original uploaded files. */
export const UPLOAD_DIR_ORIGINAL = UPLOAD_ORIGINAL_ROOT;
/** Directory for processed WebP files. */
export const UPLOAD_DIR_WEBP = path.join(UPLOAD_ROOT, 'webp');
/** Directory for processed AVIF files. */
export const UPLOAD_DIR_AVIF = path.join(UPLOAD_ROOT, 'avif');
/** Directory for processed JPEG files. */
export const UPLOAD_DIR_JPEG = path.join(UPLOAD_ROOT, 'jpeg');

export async function ensureUploadDirectories() {
    await Promise.all([
        UPLOAD_DIR_ORIGINAL,
        UPLOAD_DIR_WEBP,
        UPLOAD_DIR_AVIF,
        UPLOAD_DIR_JPEG,
    ].map((dir) => fs.mkdir(dir, { recursive: true })));
}

export async function resolveOriginalUploadPath(filename: string): Promise<string | null> {
    for (const root of [UPLOAD_DIR_ORIGINAL, LEGACY_UPLOAD_DIR_ORIGINAL]) {
        try {
            const candidate = await resolveOriginalCandidate(root, filename);
            if (candidate) return candidate;
        } catch {
            continue;
        }
    }

    return null; // Both missing — caller must handle
}

export async function deleteOriginalUploadFile(filename: string) {
    if (!isSafeOriginalFilename(filename)) return;
    await Promise.all([UPLOAD_DIR_ORIGINAL, LEGACY_UPLOAD_DIR_ORIGINAL].map(async (root) => {
        const candidate = await resolveOriginalCandidate(root, filename).catch(() => null);
        if (!candidate) return;
        await fs.unlink(candidate).catch(() => {});
    }));
}

async function unlinkOriginalCandidateStrict(filePath: string) {
    try {
        await fs.unlink(filePath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
        throw err;
    }
}

export async function deleteOriginalUploadFileStrict(filename: string) {
    if (!isSafeOriginalFilename(filename)) {
        throw new Error(`Unsafe original upload filename: ${filename}`);
    }
    const failures: unknown[] = [];
    await Promise.all([UPLOAD_DIR_ORIGINAL, LEGACY_UPLOAD_DIR_ORIGINAL].map(async (root) => {
        try {
            const candidate = await resolveOriginalCandidate(root, filename, { strict: true });
            if (!candidate) return;
            await unlinkOriginalCandidateStrict(candidate);
        } catch (err) {
            failures.push(err);
        }
    }));
    if (failures.length > 0) {
        throw new AggregateError(failures, `Failed to delete ${failures.length} original upload file candidate(s) for ${filename}`);
    }
}

function isSafeOriginalFilename(filename: string): boolean {
    return isValidFilename(filename) && !path.isAbsolute(filename) && path.basename(filename) === filename;
}

function isPathInside(root: string, candidate: string): boolean {
    const rel = path.relative(root, candidate);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function resolveOriginalCandidate(
    root: string,
    filename: string,
    options: { strict?: boolean } = {},
): Promise<string | null> {
    if (!isSafeOriginalFilename(filename)) {
        if (options.strict) throw new Error(`Unsafe original upload filename: ${filename}`);
        return null;
    }

    let rootReal: string;
    try {
        rootReal = await fs.realpath(root);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
    }

    const candidate = path.join(rootReal, filename);
    if (!isPathInside(rootReal, candidate)) {
        if (options.strict) throw new Error(`Original upload path escapes root: ${filename}`);
        return null;
    }

    let stat;
    try {
        stat = await fs.lstat(candidate);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
    }
    if (stat.isSymbolicLink()) {
        if (options.strict) throw new Error(`Original upload path is a symlink: ${filename}`);
        return null;
    }

    const candidateReal = await fs.realpath(candidate);
    if (!isPathInside(rootReal, candidateReal)) {
        if (options.strict) throw new Error(`Original upload path escapes root: ${filename}`);
        return null;
    }
    return candidateReal;
}

export async function assertNoLegacyPublicOriginalUploads(options: { failInProduction?: boolean } = {}) {
    let fileCount = 0;
    try {
        const entries = await fs.readdir(LEGACY_UPLOAD_DIR_ORIGINAL, { withFileTypes: true });
        fileCount = entries.filter((entry) => entry.isFile()).length;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
        }
        throw error;
    }
    if (fileCount === 0) {
        return;
    }

    const message = `Found ${fileCount} legacy original upload(s) in ${LEGACY_UPLOAD_DIR_ORIGINAL}. Move originals to ${UPLOAD_DIR_ORIGINAL} before serving traffic.`;
    if (options.failInProduction && process.env.NODE_ENV === 'production') {
        throw new Error(message);
    }

    console.warn(`[uploads] ${message}`);
}
