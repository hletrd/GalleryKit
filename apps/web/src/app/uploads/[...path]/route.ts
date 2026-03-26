import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { createReadStream } from 'fs';
import { lstat } from 'fs/promises';
import { UPLOAD_DIR_ORIGINAL } from '@/lib/process-image';

// Derive UPLOAD_ROOT from the exported original uploads directory
const UPLOAD_ROOT = path.dirname(UPLOAD_DIR_ORIGINAL);
const ALLOWED_UPLOAD_DIRS = new Set(['jpeg', 'webp', 'avif']);
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_SEGMENT_LENGTH = 255;

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;

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

    // Containment check: ensure the resolved path is inside UPLOAD_ROOT
    const resolvedRoot = path.resolve(UPLOAD_ROOT) + path.sep;
    const resolvedPath = path.resolve(absolutePath);

    if (!resolvedPath.startsWith(resolvedRoot)) {
        return new NextResponse('Access denied', { status: 403 });
    }

    try {
        const stats = await lstat(absolutePath);

        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', { status: 403 });
        }

        // Determine content type (no SVG)
        const ext = path.extname(absolutePath).toLowerCase();
        let contentType = 'application/octet-stream';
        if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
        else if (ext === '.png') contentType = 'image/png';
        else if (ext === '.webp') contentType = 'image/webp';
        else if (ext === '.avif') contentType = 'image/avif';
        else if (ext === '.gif') contentType = 'image/gif';

        // Create stream
        const fileStream = createReadStream(absolutePath);

        // @ts-expect-error - Readable is compatible with BodyInit in recent Next.js versions for streaming
        return new NextResponse(fileStream, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': stats.size.toString(),
                'Cache-Control': 'public, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff',
            },
        });

    } catch (err: any) {
        if (err.code === 'ENOENT') {
            return new NextResponse('File not found', { status: 404 });
        }
        console.error('Error serving static file:', err);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
