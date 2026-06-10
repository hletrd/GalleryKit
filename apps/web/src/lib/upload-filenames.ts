import path from 'path';
import { stripControlChars } from '@/lib/sanitize';

/**
 * Shared user-filename sanitizer for BOTH ingest paths (browser upload action
 * and the Lightroom PAT route). Extracted from app/actions/images.ts in
 * R4C1 COR-R4C1-03 so the PAT path cannot drift from the browser path's
 * guarantees again.
 *
 * C2L2-03: schema column is `varchar(255)` which is a UTF-8 byte budget on
 * MySQL. Bound the byte length so high-codepoint filenames (CJK, emoji) are
 * rejected at the action boundary instead of failing at INSERT time after
 * disk and EXIF work has been done.
 */
export const USER_FILENAME_MAX_BYTES = 255;

/**
 * Returns the sanitized basename, or null when the input is unusable
 * (empty after control/format-char stripping, or exceeding the UTF-8
 * byte budget). Callers MUST reject the upload on null.
 *
 * C2L2-05: a single trailing `.trim()` is sufficient. `stripControlChars`
 * already removes ASCII control bytes (and Unicode bidi/invisible
 * formatting chars), and the post-strip trim handles any whitespace that
 * the strip exposed.
 */
export function getSafeUserFilename(filename: string): string | null {
    const sanitized = stripControlChars(path.basename(filename))?.trim() ?? '';
    if (!sanitized) return null;
    if (Buffer.byteLength(sanitized, 'utf8') > USER_FILENAME_MAX_BYTES) {
        return null;
    }
    return sanitized;
}
