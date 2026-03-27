import { NextResponse } from 'next/server';
import path from 'path';
import { createReadStream } from 'fs';
import { lstat } from 'fs/promises';
import { Readable } from 'stream';
import { UPLOAD_DIR_ORIGINAL } from '@/lib/process-image';

// Derive UPLOAD_ROOT from the exported original uploads directory
const UPLOAD_ROOT = path.dirname(UPLOAD_DIR_ORIGINAL);
const ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif']);
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_SEGMENT_LENGTH = 255;

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

    // Containment check: trailing path.sep ensures resolvedPath is strictly *inside* UPLOAD_ROOT
    // (not the root directory itself). path.resolve normalizes any trailing separators.
    const resolvedRoot = path.resolve(UPLOAD_ROOT) + path.sep;
    const resolvedPath = path.resolve(absolutePath);

    if (!resolvedPath.startsWith(resolvedRoot)) {
        return new NextResponse('Access denied', { status: 403 });
    }

    let fileStream: ReturnType<typeof createReadStream> | null = null;
    try {
        const stats = await lstat(absolutePath);

        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', { status: 403 });
        }

        // Determine content type (no SVG)
        const ext = path.extname(absolutePath).toLowerCase();
        const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';

        // Create stream and convert to web ReadableStream for proper lifecycle management
        fileStream = createReadStream(absolutePath);
        const webStream = Readable.toWeb(fileStream) as ReadableStream;

        return new NextResponse(webStream, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': stats.size.toString(),
                'Cache-Control': 'public, max-age=31536000, immutable',
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
