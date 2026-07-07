import { IMAGE_BASE_URL } from '@/lib/constants';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';
import { sanitizeImageBaseUrlSafely } from '@/lib/content-security-policy';

/**
 * COR-R4C16-03: resolve the image base for BOTH runtimes.
 *
 * `IMAGE_BASE_URL` is a server-runtime env var (deliberately not
 * `NEXT_PUBLIC_` — the Docker flow sets env at container runtime,
 * after `next build`, so a build-time-inlined public var would bake
 * the build host's empty value). Client bundles therefore see
 * `process.env.IMAGE_BASE_URL` as undefined and the module constant
 * collapses to `''` — which used to silently route every
 * client-rendered image URL (lightbox swaps, search results, map
 * popups, viewer preloads) to the app origin on CDN-fronted
 * deployments, and made SSR'd client components hydration-mismatch.
 *
 * In the browser the base is read lazily from
 * `document.documentElement.dataset.imageBase`, stamped by
 * `app/[locale]/layout.tsx` from the same env the SSR pass used — so
 * server HTML and hydration render identical URLs. When the env is
 * unset (single-host topology) both runtimes resolve `''` and
 * behavior is unchanged. The read MUST stay inside the function
 * (lazy): module scope would break SSR and pin a stale value.
 */
function resolveImageBase(): string {
    if (typeof document !== 'undefined') {
        return sanitizeImageBaseUrlSafely(document.documentElement?.dataset?.imageBase);
    }
    return IMAGE_BASE_URL;
}

/** Prepend the image base URL to a relative image path (e.g. `/uploads/jpeg/foo.jpg`). */
export function imageUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const base = resolveImageBase().replace(/\/+$/, '');
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
