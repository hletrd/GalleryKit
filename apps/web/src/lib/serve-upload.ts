import { NextResponse } from 'next/server';
import path from 'path';
import { createReadStream } from 'fs';
import { lstat, realpath } from 'fs/promises';
import { Readable } from 'stream';
import { UPLOAD_ROOT } from '@/lib/upload-paths';
import { IMAGE_PIPELINE_VERSION } from '@/lib/process-image';
const ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif']);
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_SEGMENT_LENGTH = 255;

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
 */
export async function serveUploadFile(pathSegments: string[]): Promise<NextResponse> {
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
        const etag = `W/"v${IMAGE_PIPELINE_VERSION}-${stats.mtimeMs.toFixed(0)}-${stats.size}"`;

        // Create stream and convert to web ReadableStream for proper lifecycle management
        // Stream from the resolved (realpath) path, not the original path, to
        // close the TOCTOU gap where a file could be replaced by a symlink
        // between realpath() validation and createReadStream().
        fileStream = createReadStream(resolvedPath);
        const webStream = Readable.toWeb(fileStream) as ReadableStream;

        return new NextResponse(webStream, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': stats.size.toString(),
                // public + max-age + must-revalidate: edge caches keep the file
                // fast for one day, but every browser must revalidate on the
                // next request via If-None-Match. Combined with the
                // pipeline-version-bearing ETag, a pipeline change forces a
                // fresh fetch with no operator action required.
                'Cache-Control': 'public, max-age=86400, must-revalidate',
                'ETag': etag,
                'X-Content-Type-Options': 'nosniff',
            },
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
