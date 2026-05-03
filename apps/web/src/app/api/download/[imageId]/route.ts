/**
 * US-P54: GET /api/download/[imageId]?token=<dl_...>
 *
 * Public endpoint bound by single-use token.
 * This route is OUTSIDE /api/admin/ — authentication is by download token.
 *
 * Single-use enforcement:
 *   1. Validate token format and find matching entitlement by tokenHash.
 *   2. Check expiresAt > NOW() and refunded = false.
 *   3. Verify the original file exists and is a regular non-symlink file.
 *      (Cycle 3 RPF / P262-05 / C3-RPF-05: this happens BEFORE the atomic
 *      single-use claim so a missing-file failure does not consume the
 *      customer's token.)
 *   4. Atomic UPDATE sets downloadedAt = NOW() WHERE downloadedAt IS NULL.
 *   5. If UPDATE affected 0 rows → already used → 410 Gone.
 *   6. Stream original file from UPLOAD_DIR_ORIGINAL (configured via
 *      UPLOAD_ORIGINAL_ROOT env var; see lib/upload-paths.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { images, entitlements } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { verifyTokenAgainstHash, hashToken } from '@/lib/download-tokens';
import { UPLOAD_DIR_ORIGINAL } from '@/lib/upload-paths';
import path from 'path';
import { createReadStream } from 'fs';
import { lstat, realpath } from 'fs/promises';
import { Readable } from 'stream';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE = { 'Cache-Control': 'no-store, no-cache, must-revalidate' };

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ imageId: string }> }
): Promise<Response> {
    const { imageId: imageIdStr } = await params;
    const imageId = parseInt(imageIdStr, 10);
    if (!Number.isFinite(imageId) || imageId <= 0) {
        return new NextResponse('Invalid image ID', { status: 400, headers: NO_STORE });
    }

    const token = request.nextUrl.searchParams.get('token');
    if (!token || !token.startsWith('dl_')) {
        return new NextResponse('Missing or invalid token', { status: 400, headers: NO_STORE });
    }

    const tokenHash = hashToken(token);

    // Find entitlement by tokenHash
    const [entitlement] = await db
        .select({
            id: entitlements.id,
            imageId: entitlements.imageId,
            downloadTokenHash: entitlements.downloadTokenHash,
            downloadedAt: entitlements.downloadedAt,
            expiresAt: entitlements.expiresAt,
            refunded: entitlements.refunded,
        })
        .from(entitlements)
        .where(and(
            eq(entitlements.imageId, imageId),
            eq(entitlements.downloadTokenHash, tokenHash),
        ))
        .limit(1);

    if (!entitlement) {
        return new NextResponse('Token not found', { status: 404, headers: NO_STORE });
    }

    // Check constant-time token match
    if (!entitlement.downloadTokenHash || !verifyTokenAgainstHash(token, entitlement.downloadTokenHash)) {
        return new NextResponse('Invalid token', { status: 403, headers: NO_STORE });
    }

    // Check expiry
    if (new Date() > new Date(entitlement.expiresAt)) {
        return new NextResponse('Token expired', { status: 410, headers: NO_STORE });
    }

    // Check refunded
    if (entitlement.refunded) {
        return new NextResponse('Purchase has been refunded', { status: 410, headers: NO_STORE });
    }

    // Check single-use: already downloaded
    if (entitlement.downloadedAt !== null) {
        return new NextResponse('Token already used', { status: 410, headers: NO_STORE });
    }

    // Cycle 3 RPF / P262-03 / C3-RPF-03: use UPLOAD_DIR_ORIGINAL from
    // lib/upload-paths.ts so the route honors UPLOAD_ORIGINAL_ROOT env var
    // and does not 404 when deployments override the path (e.g., NFS mount,
    // custom volume).
    const uploadsDir = UPLOAD_DIR_ORIGINAL;

    // Cycle 3 RPF / P262-05 / C3-RPF-05: verify the file exists and is a
    // valid regular file BEFORE the atomic single-use claim. Previously the
    // claim consumed the token before lstat, so a missing-file failure left
    // the customer locked out (token gone, file not delivered, no replay
    // path). Order: lstat + realpath traversal check → atomic claim → stream.
    //
    // Fetch the image filename so we can resolve the file path.
    const [image] = await db
        .select({ filename_original: images.filename_original })
        .from(images)
        .where(eq(images.id, imageId))
        .limit(1);

    if (!image) {
        return new NextResponse('Image not found', { status: 404, headers: NO_STORE });
    }

    const filePath = path.resolve(uploadsDir, image.filename_original);

    // Path traversal containment
    if (!filePath.startsWith(uploadsDir + path.sep)) {
        return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
    }

    let stats: Awaited<ReturnType<typeof lstat>>;
    let resolvedFilePath: string;
    try {
        stats = await lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
        }

        // Cycle 4 RPF / P264-06 / C4-RPF-06: parallelize the two realpath
        // calls — they're independent fs round-trips and the prior serial
        // form added an avoidable round-trip per download.
        const [resolvedUploadsDir, resolved] = await Promise.all([
            realpath(uploadsDir).catch(() => uploadsDir),
            realpath(filePath),
        ]);
        resolvedFilePath = resolved;
        if (!resolvedFilePath.startsWith(`${resolvedUploadsDir}${path.sep}`)) {
            return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
        }
    } catch (err: unknown) {
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            // Cycle 3 RPF / P262-05: token NOT consumed yet — customer can
            // retry once the file is restored, or the photographer can issue
            // a refund without an "already used" support burden.
            return new NextResponse('File not found', { status: 404, headers: NO_STORE });
        }
        console.error('Download lstat/realpath error:', err);
        return new NextResponse('Internal Server Error', { status: 500, headers: NO_STORE });
    }

    // Atomic single-use claim: UPDATE WHERE downloadedAt IS NULL
    const result = await db
        .update(entitlements)
        .set({ downloadedAt: sql`NOW()`, downloadTokenHash: null })
        .where(and(
            eq(entitlements.id, entitlement.id),
            isNull(entitlements.downloadedAt),
        ));

    // Check if the update affected a row.
    // Drizzle MySQL returns [ResultSetHeader, ...] — affectedRows is on the first element.
    // We cast conservatively and fall back to 1 (allow download) on shape mismatch
    // to avoid a false-410 when the DB driver changes its result shape.
    const header = (result as unknown as Array<{ affectedRows?: number }>)[0];
    const affected = header?.affectedRows ?? 1;
    if (affected === 0) {
        return new NextResponse('Token already used', { status: 410, headers: NO_STORE });
    }

    try {
        const stream = createReadStream(resolvedFilePath);
        const webStream = Readable.toWeb(stream) as ReadableStream;
        // Cycle 3 RPF / P262-04 / C3-RPF-04: sanitize the extension before
        // interpolating into Content-Disposition. `image.filename_original` is
        // admin-controlled and stored as varchar(255). `path.extname` returns
        // the substring after the last `.`, so any quotes or semicolons after
        // that dot would land verbatim inside `filename="..."` and could break
        // RFC 6266 quoting. Defense-in-depth: restrict to alphanumerics and
        // dot, then length-cap to 8 chars. The canonical photo extension
        // (`.jpg`, `.heic`, `.cr3`, etc.) easily fits this envelope.
        const rawExt = path.extname(image.filename_original) || '.jpg';
        const safeExt = rawExt.replace(/[^a-zA-Z0-9.]/g, '').slice(0, 8) || '.jpg';
        const downloadName = `photo-${imageId}${safeExt}`;

        return new NextResponse(webStream, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${downloadName}"`,
                'Content-Length': stats.size.toString(),
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        });
    } catch (err: unknown) {
        // The file was readable at lstat time; this catch handles a rare race
        // where the file disappears between lstat and stream open. Token has
        // already been claimed (atomic UPDATE above). Logged with err.code so
        // operators can triage by error type.
        const errCode = (err instanceof Error && 'code' in err)
            ? (err as NodeJS.ErrnoException).code
            : undefined;
        console.error('Download stream error:', { entitlementId: entitlement.id, code: errCode });
        if (errCode === 'ENOENT') {
            return new NextResponse('File not found', { status: 404, headers: NO_STORE });
        }
        return new NextResponse('Internal Server Error', { status: 500, headers: NO_STORE });
    }
}
