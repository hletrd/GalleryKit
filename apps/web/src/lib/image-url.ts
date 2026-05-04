import { IMAGE_BASE_URL } from '@/lib/constants';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';

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

/** Pick the nearest configured derivative filename for a desired rendered size. */
export function sizedImageFilename(filename: string, targetSize: number, imageSizes: number[] = DEFAULT_IMAGE_SIZES): string {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot <= 0) {
        return filename;
    }

    const base = filename.slice(0, lastDot);
    const ext = filename.slice(lastDot);
    const selectedSize = findNearestImageSize(imageSizes, targetSize);
    return `${base}_${selectedSize}${ext}`;
}

/** Build a URL for the nearest configured derivative in the given directory. */
export function sizedImageUrl(directory: string, filename: string, targetSize: number, imageSizes: number[] = DEFAULT_IMAGE_SIZES): string {
    const normalizedDirectory = directory.replace(/\/+$/, '');
    return imageUrl(`${normalizedDirectory}/${sizedImageFilename(filename, targetSize, imageSizes)}`);
}

/** Build a responsive srcSet from the configured derivatives in the given directory. */
export function sizedImageSrcSet(directory: string, filename: string, imageSizes: number[] = DEFAULT_IMAGE_SIZES): string {
    return imageSizes
        .map((size) => `${sizedImageUrl(directory, filename, size, imageSizes)} ${size}w`)
        .join(', ');
}
