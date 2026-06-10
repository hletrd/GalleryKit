/**
 * US-P54: GET /api/download/[imageId]?token=<dl_...>
 *
 * Public endpoint bound by single-use token.
 * This route is OUTSIDE /api/admin/ — authentication is by download token.
 *
 * Single-use enforcement:
 *   1. Validate token format and find matching entitlement by tokenHash.
 *   2. Check expiresAt > NOW() and refunded = false.
 *   3. Verify the original file exists, is a regular non-symlink file, and
 *      OPEN it (R4C4 COR-R4C4-06). Both the existence checks AND the open
 *      happen BEFORE the atomic single-use claim (Cycle 3 RPF / P262-05 /
 *      C3-RPF-05) so a missing-file failure — including one in the
 *      historical lstat→open race window — never consumes the customer's
 *      token.
 *   4. Atomic UPDATE sets downloadedAt = NOW() WHERE downloadedAt IS NULL.
 *   5. If UPDATE affected 0 rows → already used → close handle → 410 Gone.
 *   6. Stream the bytes from the validated open handle (UPLOAD_DIR_ORIGINAL,
 *      configured via UPLOAD_ORIGINAL_ROOT env var; see lib/upload-paths.ts).
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { images, entitlements } from '@/db/schema';
import { eq, and, isNull, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { verifyTokenAgainstHash, hashToken, isValidTokenShape } from '@/lib/download-tokens';
import { buildDownloadFilename } from '@/lib/download-filename';
import { UPLOAD_DIR_ORIGINAL } from '@/lib/upload-paths';
import path from 'path';
import { lstat, realpath, open, type FileHandle } from 'fs/promises';
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
    // D-101-05: full shape validation (`dl_` + 43 base64url chars) before
    // we hash and probe the DB. A malformed token is now rejected with a
    // single regex eval — no SHA-256, no index probe.
    if (!token || !isValidTokenShape(token)) {
        return new NextResponse('Missing or invalid token', { status: 400, headers: NO_STORE });
    }

    const tokenHash = hashToken(token);

    // Find entitlement by tokenHash. We look up by imageId alone here so we
    // can correctly distinguish "token not found" from "token already used"
    // — the post-claim UPDATE clears `downloadTokenHash` (privacy: prevents
    // replay even on a DB leak) which previously caused legitimate
    // post-download retries to surface a confusing "Token not found" 404.
    // D-101-06: select the entitlement by imageId + matching tokenHash OR
    // a row whose tokenHash has been cleared but whose downloadedAt is set
    // (i.e. already-claimed). The constant-time hash check below still
    // gates the route — an attacker without the original token cannot
    // pass the `verifyTokenAgainstHash()` step on a still-claimable row.
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
        // D-101-06: distinguish "token already used" from "token never
        // existed". If a row exists for this image whose tokenHash is
        // NULL and whose downloadedAt is set, treat that as already-used.
        // This is a privacy-preserving 410 — we cannot tie the request
        // back to the original token (the hash is gone), but we can give
        // the visitor an accurate error message instead of a misleading
        // 404. We do NOT serve the file here; this branch is purely UX.
        // R4C3 COR-R4C3-03: the heuristic requires BOTH cleared-hash AND a
        // set downloadedAt (matching the comment above). refundEntitlement
        // clears the hash WITHOUT touching downloadedAt, so without the
        // isNotNull condition a refunded-never-downloaded row mislabeled any
        // mistyped token for this image as 410 "Token already used" —
        // actively misleading on multi-buyer/refunded images. Unknown tokens
        // now fall through to the accurate 404.
        const [usedRow] = await db
            .select({ id: entitlements.id })
            .from(entitlements)
            .where(and(
                eq(entitlements.imageId, imageId),
                isNull(entitlements.downloadTokenHash),
                isNotNull(entitlements.downloadedAt),
            ))
            .limit(1);
        if (usedRow) {
            return new NextResponse('Token already used', { status: 410, headers: NO_STORE });
        }
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
    // R17-L5: also fetch `title` so the Content-Disposition filename can
    // carry the same slug shape the gallery download path produces via
    // `buildDownloadFilename` (R12-M2). Paid-download customers downloading
    // multiple favorites otherwise end up with indistinguishable
    // `photo-{id}.jpg` files in their Downloads folder.
    const [image] = await db
        .select({ filename_original: images.filename_original, title: images.title })
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

    let fileHandle: FileHandle;
    let fileSize: number;
    // R4C5 COR-R4C5-04: nullable alias assigned the moment open() succeeds.
    // `fileHandle.stat()` below sits between open() and the catch — a stat
    // throw (EIO on a failing disk, EBADF after an external close) would
    // otherwise return 404/500 with the just-opened handle leaked,
    // violating the R4C4-06 "cannot leak on any post-open path" contract.
    let openedHandle: FileHandle | null = null;
    try {
        const stats = await lstat(filePath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
            return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
        }

        // Cycle 4 RPF / P264-06 / C4-RPF-06: parallelize the two realpath
        // calls — they're independent fs round-trips and the prior serial
        // form added an avoidable round-trip per download.
        const [resolvedUploadsDir, resolvedFilePath] = await Promise.all([
            realpath(uploadsDir).catch(() => uploadsDir),
            realpath(filePath),
        ]);
        if (!resolvedFilePath.startsWith(`${resolvedUploadsDir}${path.sep}`)) {
            return new NextResponse('Access denied', { status: 403, headers: NO_STORE });
        }

        // R4C4 COR-R4C4-06: open the file BEFORE the atomic single-use
        // claim. `createReadStream(path)` opens asynchronously and its
        // open-failure surfaces as a stream 'error' event AFTER the
        // response has been returned — so the previous post-claim
        // ENOENT-to-404 catch could never fire and a file vanishing
        // between lstat and open burned the customer's token on a 200
        // with an aborted body (exactly what C3-RPF-05 reordered this
        // route to avoid). An awaited open() makes the failure visible
        // HERE, while the token is still intact; the claim below streams
        // from this validated handle. Content-Length comes from the
        // opened inode so a concurrent replace cannot desync it.
        fileHandle = await open(resolvedFilePath, 'r');
        openedHandle = fileHandle;
        fileSize = (await fileHandle.stat()).size;
    } catch (err: unknown) {
        // R4C5 COR-R4C5-04: close the handle if open() succeeded but a
        // later statement in this try threw (fileHandle.stat()).
        await openedHandle?.close().catch(() => undefined);
        if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            // Cycle 3 RPF / P262-05: token NOT consumed yet — customer can
            // retry once the file is restored, or the photographer can issue
            // a refund without an "already used" support burden.
            return new NextResponse('File not found', { status: 404, headers: NO_STORE });
        }
        // Cycle 8 RPF / P394-01 / C8-RPF-01: structured-object log shape
        // with `entitlementId` correlation key. Mirrors the same-file
        // stream-error log below and the cycle 5/6/7 contract
        // on the upstream Stripe surface (webhook + checkout + refund +
        // listEntitlements). Closes the audit chain so an operator
        // triaging a paid-asset download incident can correlate this
        // catch with the upstream entitlement row by entitlementId.
        console.error('Download lstat/realpath/open error', { entitlementId: entitlement.id, err });
        return new NextResponse('Internal Server Error', { status: 500, headers: NO_STORE });
    }

    // Atomic single-use claim: UPDATE WHERE downloadedAt IS NULL
    // R4C4 COR-R4C4-06: the open file handle must not leak on any
    // post-open path — close it on claim failure, already-used, and
    // stream-setup failure; the success path closes it via autoClose.
    let result: unknown;
    try {
        result = await db
            .update(entitlements)
            .set({ downloadedAt: sql`NOW()`, downloadTokenHash: null })
            .where(and(
                eq(entitlements.id, entitlement.id),
                isNull(entitlements.downloadedAt),
            ));
    } catch (err: unknown) {
        await fileHandle.close().catch(() => undefined);
        console.error('Download claim UPDATE failed', { entitlementId: entitlement.id, err });
        return new NextResponse('Internal Server Error', { status: 500, headers: NO_STORE });
    }

    // Check if the update affected a row.
    // Drizzle MySQL returns [ResultSetHeader, ...] — affectedRows is on the first element.
    // We cast conservatively and fall back to 1 (allow download) on shape mismatch
    // to avoid a false-410 when the DB driver changes its result shape.
    const header = (result as unknown as Array<{ affectedRows?: number }>)[0];
    const affected = header?.affectedRows ?? 1;
    if (affected === 0) {
        await fileHandle.close().catch(() => undefined);
        return new NextResponse('Token already used', { status: 410, headers: NO_STORE });
    }

    try {
        // autoClose (default) closes the FileHandle when the stream ends or
        // is destroyed (client abort) — no leak on the success path.
        const stream = fileHandle.createReadStream();
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
        // R17-L5: use the same slug-form filename the gallery download
        // path produces (R12-M2). When `image.title` is empty / CJK-only /
        // slugifies to empty, `buildDownloadFilename` returns
        // `photo-{id}.{ext}` — identical to the legacy shape, so no
        // regression for SKUs that prefer anonymous filenames.
        // `buildDownloadFilename` expects ext WITHOUT leading dot.
        const extNoDot = safeExt.replace(/^\.+/, '');
        const downloadName = buildDownloadFilename(image.title, imageId, extNoDot);

        // D-101-10: RFC 6266 + RFC 5987 encode the saved filename so a
        // non-ASCII extension (today rare, future-possible if user
        // filenames ever flow into the saved name) doesn't render
        // garbled in browsers. We always emit the ASCII-safe `filename=`
        // form for legacy clients and additionally emit `filename*=`
        // when the name contains any byte outside the URL-token safe
        // set, per RFC 5987 §3.2.
        const isAsciiSafe = /^[\x20-\x7E]+$/.test(downloadName) && !/[",;\\]/.test(downloadName);
        const asciiFallback = downloadName.replace(/[^\x20-\x7E]/g, '_').replace(/[",;\\]/g, '_');
        const contentDisposition = isAsciiSafe
            ? `attachment; filename="${downloadName}"`
            : `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`;

        return new NextResponse(webStream, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': contentDisposition,
                'Content-Length': fileSize.toString(),
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store, no-cache, must-revalidate',
            },
        });
    } catch (err: unknown) {
        // R4C4 COR-R4C4-06: the file is already OPEN (handle validated
        // before the claim), so the historical between-lstat-and-open
        // ENOENT race can no longer reach this catch — it now only covers
        // synchronous setup failures (createReadStream on a closed handle,
        // Readable.toWeb). Token has already been claimed by the atomic
        // UPDATE above; close the handle so it cannot leak.
        await fileHandle.close().catch(() => undefined);
        const errCode = (err instanceof Error && 'code' in err)
            ? (err as NodeJS.ErrnoException).code
            : undefined;
        console.error('Download stream error:', { entitlementId: entitlement.id, code: errCode });
        return new NextResponse('Internal Server Error', { status: 500, headers: NO_STORE });
    }
}
