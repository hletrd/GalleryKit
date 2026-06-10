import { NextResponse } from 'next/server';
import path from 'path';
import { createReadStream } from 'fs';
import { lstat, realpath } from 'fs/promises';
import { Readable } from 'stream';
import { UPLOAD_ROOT } from '@/lib/upload-paths';
// R4C1 PERF-R4C1-07: import the version constant from its definition site
// (client-safe gallery-config-shared), NOT from process-image — the latter
// loads sharp/libvips + the whole color-detection graph at module init,
// which the image-SERVING path never needs. process-image.ts merely
// re-exports this same constant.
import { IMAGE_PIPELINE_VERSION } from '@/lib/gallery-config-shared';
import { getColorSettingsHash } from '@/lib/settings-hash';
import { getGalleryConfig } from '@/lib/gallery-config';
const ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif']);
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_SEGMENT_LENGTH = 255;

/**
 * R4C3 PERF-R4C3-05: debounce the settings-hash computation on the
 * image-serving hot path.
 *
 * React cache() scopes `getGalleryConfig()` to a SINGLE request, and
 * `getColorSettingsHash(config)` (the R8-H1 validated-values form)
 * bypasses settings-hash's internal 5 s cache — so before this guard,
 * EVERY derivative GET/HEAD/304 issued its own `admin_settings` SELECT
 * just to build the ETag (30-50 extra DB round-trips per masonry paint).
 *
 * This module-scoped TTL + inflight dedupe restores the documented
 * contract ("a flood of image requests does not issue one DB SELECT per
 * file") while preserving R8-H1 semantics: the hash is still computed
 * from the RESOLVED GalleryConfig. An admin flip of any color-impacting
 * setting reaches the ETag within <= 5 s + one refresh latency — the
 * same skew class settings-hash already documents as acceptable.
 *
 * R4C4 PERF-R4C4-01: stale-while-revalidate. Once ANY hash has been
 * resolved, requests are NEVER blocked on a refresh — a stale hash is
 * served immediately and the refresh proceeds in the background
 * (single inflight at a time). On refresh failure the last known hash
 * simply stays in service, so a hung or failing DB cannot stall image
 * responses. The only blocking case is a true cold start (no hash has
 * ever been resolved — there is nothing to serve yet); a cold-start
 * failure falls through to settings-hash's no-arg FALLBACK_HASH path,
 * which carries its own 5 s negative cache.
 */
const SERVING_SETTINGS_HASH_TTL_MS = 5_000;
let servingHashCache: { hash: string; fetchedAt: number } | null = null;
let servingHashInflight: Promise<string> | null = null;

async function getServingColorSettingsHash(): Promise<string> {
    const now = Date.now();
    const cached = servingHashCache;
    if (cached && now - cached.fetchedAt < SERVING_SETTINGS_HASH_TTL_MS) {
        return cached.hash;
    }
    // Refresh needed — start one unless a refresh is already in flight.
    // The async body never rejects (both failure branches return a value),
    // so leaving it un-awaited cannot produce an unhandled rejection.
    if (!servingHashInflight) {
        servingHashInflight = (async () => {
            try {
                const config = await getGalleryConfig();
                const hash = await getColorSettingsHash(config);
                servingHashCache = { hash, fetchedAt: Date.now() };
                return hash;
            } catch {
                if (servingHashCache) return servingHashCache.hash;
                // No-arg form carries its own 5 s cache + FALLBACK_HASH semantics.
                return getColorSettingsHash();
            } finally {
                servingHashInflight = null;
            }
        })();
    }
    if (cached) {
        // Stale-while-revalidate: serve the known hash NOW. The refresh
        // above lands in the background; the next request past its
        // completion picks up the new hash.
        return cached.hash;
    }
    // True cold start: no hash has ever been resolved — must wait once.
    return servingHashInflight;
}

/** Test-only helper: reset the serving-path hash cache. */
export function _resetServingSettingsHashCacheForTesting(): void {
    servingHashCache = null;
    servingHashInflight = null;
}

/** Map from top-level directory to allowed file extensions. Prevents serving
 *  mismatched files (e.g., a .webp from /uploads/jpeg/). */
const DIR_EXTENSION_MAP: Record<string, Set<string>> = {
    'jpeg': new Set(['.jpg', '.jpeg']),
    'webp': new Set(['.webp']),
    'avif': new Set(['.avif']),
};

const CONTENT_TYPES: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
};

/**
 * Shared handler for serving uploaded image files with security checks.
 * Used by both /uploads/[...path] and /[locale]/uploads/[...path] routes.
 *
 * The optional `ifNoneMatch` argument lets the route handler pass the
 * incoming `If-None-Match` header so we can answer a 304 Not Modified
 * when the cached client copy still matches. R11-M1: the Service Worker
 * now sends `If-None-Match` on its HEAD revalidate; honouring it here
 * lets the negotiated-cache short-circuit avoid a full response body.
 */
export async function serveUploadFile(
    pathSegments: string[],
    ifNoneMatch?: string | null,
    method: 'GET' | 'HEAD' = 'GET',
): Promise<NextResponse> {
    if (!Array.isArray(pathSegments) || pathSegments.length < 2) {
        return new NextResponse('Not found', { status: 404 });
    }

    const [topLevelDir] = pathSegments;
    if (!ALLOWED_UPLOAD_DIRS.has(topLevelDir)) {
        return new NextResponse('Not found', { status: 404 });
    }

    // Validate file extension matches the directory — prevents serving
    // mismatched files (e.g., a .webp from /uploads/jpeg/).
    const filename = pathSegments[pathSegments.length - 1];
    const ext = path.extname(filename).toLowerCase();
    const allowedExts = DIR_EXTENSION_MAP[topLevelDir];
    if (allowedExts && !allowedExts.has(ext)) {
        return new NextResponse('Invalid path', { status: 400 });
    }

    // Content type is resolved from the extension already extracted above
    const contentType = CONTENT_TYPES[ext];

    for (const segment of pathSegments) {
        if (!segment || segment.length > MAX_SEGMENT_LENGTH || segment === '.' || segment === '..') {
            return new NextResponse('Invalid path', { status: 400 });
        }
        if (!SAFE_SEGMENT.test(segment)) {
            return new NextResponse('Invalid path', { status: 400 });
        }
    }

    // Construct absolute path
    const relativePath = path.join(...pathSegments);
    const absolutePath = path.join(UPLOAD_ROOT, relativePath);

    let fileStream: ReturnType<typeof createReadStream> | null = null;
    try {
        const resolvedRoot = await realpath(UPLOAD_ROOT).catch((err: unknown) => {
            if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
                return path.resolve(UPLOAD_ROOT);
            }
            throw err;
        });
        const stats = await lstat(absolutePath);

        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', { status: 403 });
        }

        const resolvedPath = await realpath(absolutePath);
        if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
            return new NextResponse('Access denied', { status: 403 });
        }

        // Content type already resolved from extension above (no SVG)
        if (!contentType) {
            return new NextResponse('Unsupported file type', { status: 404 });
        }

        // CM-HIGH-5: build an ETag from (pipeline_version, mtime, size) so the
        // cache invalidates as soon as we change the encoder pipeline OR the
        // file is rewritten. Using `must-revalidate` instead of `immutable`
        // costs one round-trip to a 304 response on each load but lets us
        // ship color-pipeline fixes without orphan year-long stale caches.
        //
        // P4-E2 / R4-L3 / FA-L1: fold an 8-char hash of the color-impacting
        // admin settings (`wide_gamut_jpeg_chroma`, `avif_effort`,
        // `force_srgb_derivatives`) into the ETag. A flip of any of those
        // settings forces a 304 → 200 revalidation cycle on every cached
        // client even when the file mtime has not changed (e.g. an admin
        // toggles `force_srgb_derivatives=true` to clean up a colorimetric
        // bug; previously the change shipped only to fresh browsers).
        //
        // R8-H1: the hash reflects validated encoder values (resolved
        // GalleryConfig), not raw DB strings.
        // R4C3 PERF-R4C3-05: resolved + hashed behind the module-scoped
        // 5 s TTL above — NOT per-request — so derivative floods do not
        // issue one `admin_settings` SELECT per file.
        const settingsHash = await getServingColorSettingsHash();
        const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}-${settingsHash}"`;

        // R11-M1: HTTP-conditional GET. If the client's If-None-Match
        // matches the freshly-computed ETag, return 304 Not Modified
        // with no body. The Cache-Control + ETag headers are still
        // emitted so the client can update its freshness timer.
        // Header parsing handles both single-tag (`W/"v6-..."`) and
        // comma-separated tag lists (`W/"a", W/"b"`).
        if (ifNoneMatch) {
            const tags = ifNoneMatch.split(',').map((t) => t.trim());
            if (tags.includes('*') || tags.includes(etag)) {
                return new NextResponse(null, {
                    status: 304,
                    headers: {
                        'ETag': etag,
                        'Cache-Control': 'public, max-age=3600, must-revalidate',
                        'X-Content-Type-Options': 'nosniff',
                    },
                });
            }
        }

        // R20-L1: HEAD requests do not need the body — return early with
        // headers only. Skips the createReadStream + Readable.toWeb work that
        // Next.js would discard anyway, and avoids opening a file descriptor
        // for crawler / link-checker HEAD bursts that miss the ETag
        // short-circuit above.
        const responseHeaders = {
            'Content-Type': contentType,
            'Content-Length': stats.size.toString(),
            // public + max-age + must-revalidate: edge caches keep the file
            // fast for one day, but every browser must revalidate on the
            // next request via If-None-Match. Combined with the
            // pipeline-version-bearing ETag, a pipeline change forces a
            // fresh fetch with no operator action required.
            // R8-R7: reduced from 86400 to 3600 so color-pipeline fixes
            // ship to browsers within an hour instead of up to 24 hours.
            'Cache-Control': 'public, max-age=3600, must-revalidate',
            'ETag': etag,
            'X-Content-Type-Options': 'nosniff',
        } as const;

        if (method === 'HEAD') {
            return new NextResponse(null, { headers: responseHeaders });
        }

        // Create stream and convert to web ReadableStream for proper lifecycle management
        // Stream from the resolved (realpath) path, not the original path, to
        // close the TOCTOU gap where a file could be replaced by a symlink
        // between realpath() validation and createReadStream().
        fileStream = createReadStream(resolvedPath);
        const webStream = Readable.toWeb(fileStream) as ReadableStream;

        return new NextResponse(webStream, {
            headers: responseHeaders,
        });

    } catch (err: unknown) {
        // Clean up stream on error
        if (fileStream) {
            fileStream.destroy();
        }
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return new NextResponse('File not found', { status: 404 });
        }
        console.error('Error serving static file:', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
