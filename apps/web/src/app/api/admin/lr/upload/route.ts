/**
 * POST /api/admin/lr/upload
 *
 * Accepts a multipart upload from the GalleryKit Lightroom Classic publish
 * plugin and creates a new image record. Authentication is via the
 * `X-GalleryKit-Token` header (PAT with scope `lr:upload`); ordinary browser
 * admin-session cookies are also accepted as a fallback for testing.
 *
 * Same-origin enforcement: token-bearing requests do NOT need same-origin
 * (cross-origin integration is the point of PATs). The `withAdminAuth` wrapper
 * handles both auth paths when `allowTokenScope` is set.
 *
 * US-P53: this route is the server-side counterpart to the Lightroom plugin's
 * GalleryKitAPI.lua. It re-uses the existing upload infrastructure
 * (saveOriginalAndGetMetadata, enqueueImageProcessing) so image processing,
 * EXIF extraction, and revalidation are identical to the browser upload path.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth, type VerifiedToken } from '@/lib/api-auth';
import { db, topics, images } from '@/db';
import { eq } from 'drizzle-orm';
import { saveOriginalAndGetMetadata, extractExifForDb } from '@/lib/process-image';
import { ensureUploadDirectories } from '@/lib/upload-paths';
import { enqueueImageProcessing } from '@/lib/image-queue';
import { isValidSlug, safeInsertId } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { getGalleryConfig } from '@/lib/gallery-config';
import { assertBlurDataUrl } from '@/lib/blur-data-url';
import { sanitizeAdminString } from '@/lib/sanitize';
import { revalidateAllAppData } from '@/lib/revalidation';

const NO_CACHE = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

export const POST = withAdminAuth(
    async function POST(
        request: NextRequest,
        ctx?: { token?: VerifiedToken },
    ) {
        const tokenUserId = ctx?.token?.userId ?? null;
        const ip = getClientIp(request.headers);

        let formData: FormData;
        try {
            formData = await request.formData();
        } catch {
            return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400, headers: NO_CACHE });
        }

        const fileEntry = formData.get('file');
        if (!(fileEntry instanceof File)) {
            return NextResponse.json({ error: 'Missing file field' }, { status: 400, headers: NO_CACHE });
        }

        const topicSlug = formData.get('topic')?.toString().trim() ?? '';
        if (!topicSlug || !isValidSlug(topicSlug)) {
            return NextResponse.json({ error: 'Invalid or missing topic slug' }, { status: 400, headers: NO_CACHE });
        }

        const rawTitle = formData.get('title')?.toString() ?? null;
        const { value: title, rejected: titleRejected } = rawTitle
            ? sanitizeAdminString(rawTitle)
            : { value: null, rejected: false };
        if (titleRejected) {
            return NextResponse.json({ error: 'Invalid title' }, { status: 400, headers: NO_CACHE });
        }
        const rawDesc = formData.get('description')?.toString() ?? null;
        const { value: description, rejected: descRejected } = rawDesc
            ? sanitizeAdminString(rawDesc)
            : { value: null, rejected: false };
        if (descRejected) {
            return NextResponse.json({ error: 'Invalid description' }, { status: 400, headers: NO_CACHE });
        }

        // Verify topic exists
        const [topicRow] = await db.select({ slug: topics.slug })
            .from(topics)
            .where(eq(topics.slug, topicSlug))
            .limit(1);
        if (!topicRow) {
            return NextResponse.json({ error: 'Topic not found' }, { status: 404, headers: NO_CACHE });
        }

        await ensureUploadDirectories();

        const config = await getGalleryConfig();

        let data: Awaited<ReturnType<typeof saveOriginalAndGetMetadata>>;
        try {
            data = await saveOriginalAndGetMetadata(fileEntry);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Upload failed';
            return NextResponse.json({ error: msg }, { status: 422, headers: NO_CACHE });
        }

        const exifDb = extractExifForDb(data.exifData);
        if (config.stripGpsOnUpload) {
            exifDb.latitude = null;
            exifDb.longitude = null;
        }

        const insertValues = {
            filename_original: data.filenameOriginal,
            filename_webp: data.filenameWebp,
            filename_avif: data.filenameAvif,
            filename_jpeg: data.filenameJpeg,
            width: data.width,
            height: data.height,
            original_width: data.originalWidth,
            original_height: data.originalHeight,
            topic: topicSlug,
            title: (title ?? '').slice(0, 255) || null,
            description: (description ?? '').slice(0, 4096),
            user_filename: fileEntry.name.slice(0, 255),
            blur_data_url: assertBlurDataUrl(data.blurDataUrl),
            processed: false,
            ...exifDb,
            color_space: data.iccProfileName || exifDb.color_space,
            bit_depth: data.bitDepth,
            original_format: (data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null,
            original_file_size: fileEntry.size,
        };

        const insertResult = await db.insert(images).values(insertValues);
        const imageId = safeInsertId(insertResult[0].insertId);

        enqueueImageProcessing({
            imageId,
            filenameOriginal: data.filenameOriginal,
            filenameWebp: data.filenameWebp,
            filenameAvif: data.filenameAvif,
            filenameJpeg: data.filenameJpeg,
            config,
        });

        await logAuditEvent(
            tokenUserId,
            'lr_token_used',
            'image',
            String(imageId),
            ip,
            { topic: topicSlug, filename: fileEntry.name },
        ).catch(console.debug);

        revalidateAllAppData().catch(console.debug);

        return NextResponse.json(
            { success: true, id: imageId },
            { status: 201, headers: NO_CACHE },
        );
    },
    { allowTokenScope: 'lr:upload' },
);
