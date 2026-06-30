import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api-auth';
import path from 'path';
import { open, realpath } from 'fs/promises';
import { Readable } from 'stream';
import { isValidBackupFilename } from '@/lib/backup-filename';
import { getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';

// AGG9R-02: origin verification is now enforced by `withAdminAuth`
// in api-auth.ts. The previous inline `hasTrustedSameOriginWithOptions`
// check was redundant after the wrapper was updated. Removed to avoid
// duplicated origin checks on every request.

// R21-L1: pin to Node runtime explicitly. The route imports `fs`,
// `fs/promises`, `path`, and `stream` — all Node-only modules that
// are not Edge-compatible. Matches every other Node-bound route.
export const runtime = 'nodejs';

export const GET = withAdminAuth(async function GET(request: NextRequest) {

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
        const resolvedFilePath = await realpath(filePath);
        if (!resolvedFilePath.startsWith(`${resolvedBackupsDir}${path.sep}`)) {
            return new NextResponse('Access denied', {
                status: 403,
                headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
            });
        }
        const fileHandle = await open(resolvedFilePath, 'r');
        const stats = await fileHandle.stat();
        if (!stats.isFile()) {
            await fileHandle.close();
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

        // Stream from the already-validated file handle so Content-Length and
        // bytes come from the same descriptor instead of a later path reopen.
        const stream = fileHandle.createReadStream();
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
