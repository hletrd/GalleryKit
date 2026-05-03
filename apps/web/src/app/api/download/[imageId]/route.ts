/**
 * US-P54: GET /api/download/[imageId]?token=<dl_...>
 *
 * Public endpoint bound by single-use token.
 * This route is OUTSIDE /api/admin/ — authentication is by download token.
 *
 * Single-use enforcement:
 *   1. Validate token format and find matching entitlement by tokenHash.
 *   2. Check expiresAt > NOW() and refunded = false.
 *   3. Atomic UPDATE sets downloadedAt = NOW() WHERE downloadedAt IS NULL.
 *   4. If UPDATE affected 0 rows → already used → 410 Gone.
 *   5. Stream original file from data/uploads/original/.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { images, entitlements } from '@/db/schema';
import { eq, and, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { verifyTokenAgainstHash, hashToken } from '@/lib/download-tokens';
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

    // Fetch image filename
    const [image] = await db
        .select({ filename_original: images.filename_original })
        .from(images)
        .where(eq(images.id, imageId))
        .limit(1);

    if (!image) {
        return new NextResponse('Image not found', { status: 404, headers: NO_STORE });
    }

    // Stream original file
    const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads', 'original');
    const filePath = path.resolve(uploadsDir, image.filename_original);

    // Path traversal containment
    if (!filePath.startsWith(uploadsDir + path.sep)) {
        return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
    }

    try {
        const stats = await lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
        }

        const resolvedUploadsDir = await realpath(uploadsDir).catch(() => uploadsDir);
        const resolvedFilePath = await realpath(filePath);
        if (!resolvedFilePath.startsWith(`${resolvedUploadsDir}${path.sep}`)) {
            return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
        }

        const stream = createReadStream(resolvedFilePath);
        const webStream = Readable.toWeb(stream) as ReadableStream;
        const ext = path.extname(image.filename_original) || '.jpg';
        const downloadName = `photo-${imageId}${ext}`;

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
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            return new NextResponse('File not found', { status: 404, headers: NO_STORE });
        }
        console.error('Download stream error:', err);
        return new NextResponse('Internal Server Error', { status: 500, headers: NO_STORE });
    }
}
