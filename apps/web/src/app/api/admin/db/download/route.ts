import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api-auth';
import path from 'path';
import { createReadStream } from 'fs';
import { lstat, realpath } from 'fs/promises';
import { Readable } from 'stream';
import { isValidBackupFilename } from '@/lib/backup-filename';
import { getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { hasTrustedSameOriginWithOptions } from '@/lib/request-origin';

export const GET = withAdminAuth(async function GET(request: NextRequest) {
    const requestHeaders = {
        get(name: string) {
            const normalized = name.toLowerCase();
            if (normalized === 'host') {
                return request.headers.get(name) ?? request.nextUrl.host;
            }
            if (normalized === 'x-forwarded-proto') {
                return request.headers.get(name) ?? request.nextUrl.protocol.replace(/:$/, '');
            }
            return request.headers.get(name);
        },
    };

    if (!hasTrustedSameOriginWithOptions(requestHeaders, { allowMissingSource: false })) {
        return new NextResponse('Unauthorized', {
            status: 403,
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        });
    }

    const file = request.nextUrl.searchParams.get('file');
    if (!file || !isValidBackupFilename(file)) {
        return new NextResponse('Invalid filename', {
            status: 400,
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        });
    }

    const backupsDir = path.resolve(process.cwd(), 'data', 'backups');
    const filePath = path.resolve(backupsDir, file);

    // Containment check
        if (!filePath.startsWith(backupsDir + path.sep)) {
            return new NextResponse('Access denied', {
                status: 403,
                headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
            });
        }

    try {
        const resolvedBackupsDir = await realpath(backupsDir).catch((err: unknown) => {
            if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
                return backupsDir;
            }
            throw err;
        });
        const stats = await lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', {
                status: 403,
                headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
            });
        }

        const resolvedFilePath = await realpath(filePath);
        if (!resolvedFilePath.startsWith(`${resolvedBackupsDir}${path.sep}`)) {
            return new NextResponse('Access denied', {
                status: 403,
                headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
            });
        }

        const currentUser = await getCurrentUser();
        const requesterIp = getClientIp(request.headers);
        await logAuditEvent(currentUser?.id ?? null, 'db_backup_download', 'database_backup', file, requesterIp, {
            size: stats.size,
        }).catch(console.debug);

        // Stream from the resolved (realpath) path, not the original path, to
        // close the TOCTOU gap where a file could be replaced by a symlink
        // between realpath() validation and createReadStream().
        const stream = createReadStream(resolvedFilePath);
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
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return new NextResponse('File not found', {
                status: 404,
                headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
            });
        }
        console.error('Error downloading backup file:', err);
        return new NextResponse('Internal Server Error', {
            status: 500,
            headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
        });
    }
});
