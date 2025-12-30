import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { Readable } from 'stream';

// Reuse logic or define simple constant based on Docker structure
// In Docker/Standalone: process.cwd() is usually /app
// We map volumes to /app/apps/web/public/uploads
const UPLOAD_ROOT = path.join(process.cwd(), 'apps/web/public/uploads');

// Fallback for local dev where CWD might be apps/web
const LOCAL_UPLOAD_ROOT = path.join(process.cwd(), 'public/uploads');

function getContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    switch (ext) {
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.png':
            return 'image/png';
        case '.webp':
            return 'image/webp';
        case '.avif':
            return 'image/avif';
        case '.gif':
            return 'image/gif';
        case '.svg':
            return 'image/svg+xml';
        default:
            return 'application/octet-stream';
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const { path: pathSegments } = await params;
    const filePathRelative = pathSegments.join('/');

    // Prevent path traversal
    if (filePathRelative.includes('..')) {
        return new NextResponse('Invalid path', { status: 400 });
    }

    // Try finding the file in typical locations
    let fullPath = path.join(UPLOAD_ROOT, filePathRelative);

    if (!existsSync(fullPath)) {
        // Try local dev path
        fullPath = path.join(LOCAL_UPLOAD_ROOT, filePathRelative);
    }

    if (!existsSync(fullPath)) {
        return new NextResponse('File not found', { status: 404 });
    }

    try {
        const stats = await fs.stat(fullPath);
        if (!stats.isFile()) {
            return new NextResponse('Not a file', { status: 404 });
        }

        // Create stream
        const stream = createReadStream(fullPath);

        // Convert node stream to web stream for Next.js response
        // @ts-ignore
        const webStream = Readable.toWeb(stream);

        return new NextResponse(webStream as any, {
            headers: {
                'Content-Type': getContentType(fullPath),
                'Content-Length': stats.size.toString(),
                'Cache-Control': 'public, max-age=31536000, immutable',
            },
        });
    } catch (e) {
        console.error('Error serving file:', e);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
