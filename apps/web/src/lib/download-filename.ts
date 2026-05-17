/**
 * R12-M2: build photographer-friendly download filenames.
 *
 * The photo viewer's `Download` button today produces filenames like
 * `photo-12345.jpg` which leaks no information but also gives the
 * end-user no way to tell downloaded files apart. Recipients of a
 * wedding share download 8 favorites and end up with 8 indistinguishable
 * `photo-{id}.jpg` files in their Downloads folder.
 *
 * `buildDownloadFilename` derives a filename from the photo's PUBLIC
 * `title` field (already rendered in og:title and visible on the page,
 * so no new information is leaked) plus the immutable photo ID for
 * stable disambiguation. When the title is missing, empty, or
 * slugifies to the empty string, the legacy `photo-{id}.{ext}` shape
 * is preserved.
 *
 * Security:
 * - Unicode bidi + zero-width formatting chars stripped (matches the
 *   `UNICODE_FORMAT_CHARS` allowlist in `lib/validation.ts`).
 * - Control chars stripped.
 * - Non-ASCII transliterated via NFKD + diacritic strip; any remaining
 *   non-`[a-z0-9-]` removed. CJK / non-Latin titles slugify to empty
 *   and fall back to the `photo-{id}` shape rather than producing an
 *   awkward partial-romanization.
 * - Output capped at 60 chars to stay well below common filesystem
 *   filename limits (255 bytes on most FSs) and to leave headroom for
 *   the `-{id}.{ext}` suffix.
 */

import { UNICODE_FORMAT_CHARS } from '@/lib/validation';

const MAX_SLUG_LENGTH = 60;

function slugifyTitle(title: string | null | undefined): string {
    if (!title) return '';
    let s = title;

    // Strip Unicode bidi / zero-width / format chars first (defense
    // against visually-spoofed titles affecting the download filename).
    s = s.replace(new RegExp(UNICODE_FORMAT_CHARS.source, 'g'), '');

    // Strip C0 / C1 control bytes.
    // eslint-disable-next-line no-control-regex -- intentional: strip control bytes
    s = s.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

    // NFKD decomposition + diacritic strip so common accented Latin
    // characters (é, ñ, ü, ç) reduce to ASCII equivalents.
    s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');

    // Lowercase.
    s = s.toLowerCase();

    // Replace anything that isn't ASCII alphanumeric with `-` so path
    // separators, shell metacharacters, and whitespace all become
    // boundaries rather than getting elided into adjacent words.
    s = s.replace(/[^a-z0-9]+/g, '-');

    // Collapse repeated `-`.
    s = s.replace(/-+/g, '-');

    // Trim leading/trailing `-`.
    s = s.replace(/^-+|-+$/g, '');

    // Cap length.
    if (s.length > MAX_SLUG_LENGTH) {
        s = s.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
    }

    return s;
}

export function buildDownloadFilename(
    title: string | null | undefined,
    id: number | string,
    ext: string,
): string {
    const cleanExt = String(ext).replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const idPart = String(id).replace(/[^0-9]/g, '') || '0';
    const slug = slugifyTitle(title);
    if (slug) {
        return `${slug}-${idPart}.${cleanExt}`;
    }
    return `photo-${idPart}.${cleanExt}`;
}

// Exported for testing — never call directly from product code.
export const _internal = { slugifyTitle, MAX_SLUG_LENGTH };
