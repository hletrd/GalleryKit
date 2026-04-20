import { IMAGE_BASE_URL } from '@/lib/constants';

/** Prepend IMAGE_BASE_URL to a relative image path (e.g. `/uploads/jpeg/foo.jpg`). */
export function imageUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const base = IMAGE_BASE_URL.replace(/\/+$/, '');
    return base ? `${base}${normalizedPath}` : normalizedPath;
}

function isAbsoluteUrl(value: string) {
    return /^https?:\/\//i.test(value);
}

/** Return an absolute image URL for metadata/JSON-LD/share surfaces. */
export function absoluteImageUrl(path: string, siteUrl: string): string {
    const resolved = imageUrl(path);
    if (isAbsoluteUrl(resolved)) {
        return resolved;
    }
    return new URL(resolved, siteUrl).toString();
}
