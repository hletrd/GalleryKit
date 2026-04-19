/**
 * Upload Path Constants
 *
 * Single source of truth for all upload directory paths.
 * Previously duplicated in process-image.ts, storage/local.ts, and serve-upload.ts.
 */

import path from 'path';

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

/** Directory for original uploaded files. */
export const UPLOAD_DIR_ORIGINAL = path.join(UPLOAD_ROOT, 'original');
/** Directory for processed WebP files. */
export const UPLOAD_DIR_WEBP = path.join(UPLOAD_ROOT, 'webp');
/** Directory for processed AVIF files. */
export const UPLOAD_DIR_AVIF = path.join(UPLOAD_ROOT, 'avif');
/** Directory for processed JPEG files. */
export const UPLOAD_DIR_JPEG = path.join(UPLOAD_ROOT, 'jpeg');
