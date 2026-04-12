import { NextRequest, NextResponse } from 'next/server';
import { isAdmin } from '@/app/actions';
import path from 'path';
import { createReadStream } from 'fs';
import { lstat } from 'fs/promises';
import { Readable } from 'stream';

const SAFE_FILENAME = /^backup-\d{4}-\d{2}-\d{2}T[\d-]+Z\.sql$/;

export async function GET(request: NextRequest) {
    const admin = await isAdmin();
    if (!admin) {
        return new NextResponse('Unauthorized', { status: 401 });
    }

    const file = request.nextUrl.searchParams.get('file');
    if (!file || !SAFE_FILENAME.test(file)) {
        return new NextResponse('Invalid filename', { status: 400 });
    }

    const backupsDir = path.resolve(process.cwd(), 'data', 'backups');
    const filePath = path.resolve(backupsDir, file);

    // Containment check
    if (!filePath.startsWith(backupsDir + path.sep)) {
        return new NextResponse('Access denied', { status: 403 });
    }

    try {
        const stats = await lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', { status: 403 });
        }

        const stream = createReadStream(filePath);
        const webStream = Readable.toWeb(stream) as ReadableStream;

        return new NextResponse(webStream, {
            headers: {
                'Content-Type': 'application/sql',
                'Content-Disposition': `attachment; filename="${file}"`,
                'Content-Length': stats.size.toString(),
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
                'Pragma': 'no-cache',
            },
        });
    } catch {
        return new NextResponse('File not found', { status: 404 });
    }
}
