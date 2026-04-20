/**
 * Upload Path Constants
 *
 * Single source of truth for all upload directory paths.
 * Previously duplicated in process-image.ts, storage/local.ts, and serve-upload.ts.
 */

import path from 'path';
import fs from 'fs/promises';

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

export async function resolveOriginalUploadPath(filename: string) {
    const candidates = [
        path.join(UPLOAD_DIR_ORIGINAL, filename),
        path.join(LEGACY_UPLOAD_DIR_ORIGINAL, filename),
    ];

    for (const candidate of candidates) {
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            continue;
        }
    }

    return candidates[0];
}

export async function deleteOriginalUploadFile(filename: string) {
    await Promise.all([
        fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, filename)).catch(() => {}),
        fs.unlink(path.join(LEGACY_UPLOAD_DIR_ORIGINAL, filename)).catch(() => {}),
    ]);
}
