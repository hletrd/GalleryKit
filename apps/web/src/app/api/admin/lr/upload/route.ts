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

import path from 'path';
import { statfs } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/api-auth';
import { verifyToken } from '@/lib/admin-tokens';
import { db, topics, images } from '@/db';
import { eq } from 'drizzle-orm';
import { saveOriginalAndGetMetadata, extractExifForDb, stripGpsFromOriginal, IMAGE_PIPELINE_VERSION, RawFileError } from '@/lib/process-image';
import { ensureUploadDirectories, deleteOriginalUploadFile, UPLOAD_DIR_ORIGINAL } from '@/lib/upload-paths';
import { enqueueImageProcessing } from '@/lib/image-queue';
import { acquireUploadProcessingContractLock } from '@/lib/upload-processing-contract-lock';
import { isValidSlug, safeInsertId } from '@/lib/validation';
import { countCodePoints } from '@/lib/utils';
import { getSafeUserFilename } from '@/lib/upload-filenames';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { getGalleryConfig } from '@/lib/gallery-config';
import { assertBlurDataUrl } from '@/lib/blur-data-url';
import { sanitizeAdminString } from '@/lib/sanitize';
import { revalidateAllAppData } from '@/lib/revalidation';
import { isRestoreMaintenanceActive, cleanupOriginalIfRestoreMaintenanceBegan } from '@/lib/restore-maintenance';
import { getUploadTracker, pruneUploadTracker, resetUploadTrackerWindowIfExpired } from '@/lib/upload-tracker-state';
import { settleUploadTrackerClaim } from '@/lib/upload-tracker';
import { MAX_TOTAL_UPLOAD_BYTES, UPLOAD_MAX_FILES_PER_WINDOW } from '@/lib/upload-limits';

const NO_CACHE = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

// R21-L1: pin to Node runtime explicitly. The route uses `db` (mysql2),
// the Sharp-backed image-processing pipeline (libvips bindings), and
// the in-process upload queue — all Node-only. A future Next.js
// default flip to Edge would break the Lightroom publish-plugin's
// primary integration path with zero in-product diagnostic. Matches
// the Node-runtime pinning convention (R20-L2) used across Node-bound routes.
export const runtime = 'nodejs';

export const POST = withAdminAuth(
    async function POST(request: NextRequest) {
        // Re-verify the X-GalleryKit-Token to access userId for audit
        // logging. The withAdminAuth wrapper already verified scope and
        // gated entry; this second verifyToken pass is type-safe (avoids
        // augmenting the route handler's signature with a non-Next.js
        // second parameter) and cheap (one sha256 + one indexed lookup).
        // Cookie-authenticated requests (no header) leave tokenUserId null.
        const tokenHeader = request.headers.get('X-GalleryKit-Token');
        const verified = tokenHeader ? await verifyToken(tokenHeader) : null;
        const tokenUserId = verified?.userId ?? null;
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

        // R4C1 COR-R4C1-03: mirror the browser path's user-filename guard
        // (app/actions/images.ts → getSafeUserFilename, C2L2-03/C2L2-05).
        // The prior 255-UTF-16-unit truncation of fileEntry.name stored raw
        // client input: no basename(), no control/format-char rejection,
        // empty names allowed, surrogate pairs bisected (mysql2's UTF-8
        // encoder then writes U+FFFD mojibake), and no 255-UTF-8-byte
        // budget for the varchar(255) column.
        const safeUserFilename = getSafeUserFilename(fileEntry.name);
        if (!safeUserFilename) {
            return NextResponse.json({ error: 'Invalid filename' }, { status: 400, headers: NO_CACHE });
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

        // R4C1 COR-R4C1-04: mirror the canonical admin metadata constraints
        // (updateImageMetadata, C7-AGG7R-02) — validate by Unicode code
        // points and reject loudly instead of silently truncating with a
        // UTF-16 `.slice()` that can bisect a surrogate pair (trailing
        // U+FFFD mojibake on the photographer's caption).
        if (title && countCodePoints(title) > 255) {
            return NextResponse.json({ error: 'Title too long (max 255 characters)' }, { status: 400, headers: NO_CACHE });
        }
        if (description && countCodePoints(description) > 5000) {
            return NextResponse.json({ error: 'Description too long (max 5000 characters)' }, { status: 400, headers: NO_CACHE });
        }

        // Verify topic exists
        const [topicRow] = await db.select({ slug: topics.slug })
            .from(topics)
            .where(eq(topics.slug, topicSlug))
            .limit(1);
        if (!topicRow) {
            return NextResponse.json({ error: 'Topic not found' }, { status: 404, headers: NO_CACHE });
        }

        // Run-3 RPF cycle 4 / F1 (DEF-C4-01): mirror the browser upload path's
        // restore-maintenance entry guard (app/actions/images.ts:122-125). While
        // a DB restore is in progress the writer is frozen; accepting an upload
        // here would write an on-disk original and (post-lock) an `images` row
        // that the restore then wipes, orphaning the file. The single-writer
        // topology (CLAUDE.md "Runtime topology") makes this a process-local
        // flag, shared by both ingest entrypoints. 503 = service temporarily
        // unavailable; the Lightroom plugin retries.
        if (isRestoreMaintenanceActive()) {
            return NextResponse.json(
                { error: 'Restore in progress; retry shortly' },
                { status: 503, headers: NO_CACHE },
            );
        }

        // Run-3 RPF cycle 3 / F3 (CR-C3-01): acquire the upload-processing
        // contract lock for the whole save→insert→enqueue window, mirroring the
        // browser upload action (app/actions/images.ts:183). The MySQL advisory
        // lock `gallerykit_upload_processing_contract` serializes uploads with
        // `image_sizes` / `strip_gps_on_upload` settings changes so the first
        // committed image cannot race a setting intended to lock once photos
        // exist (CLAUDE.md "Race Condition Protections"). Without this, an LR
        // publish could interleave with a concurrent settings change and defeat
        // the lock-once guarantee on the primary non-browser ingest path.
        const uploadContractLock = await acquireUploadProcessingContractLock();
        if (!uploadContractLock) {
            return NextResponse.json(
                { error: 'Upload settings are being changed; retry shortly' },
                { status: 409, headers: NO_CACHE },
            );
        }

        try {
            await ensureUploadDirectories();

            const config = await getGalleryConfig();

            // Run-3 RPF cycle 4 / F2 (DEF-C4-02): mirror the browser upload
            // path's 1 GB disk-space pre-check (app/actions/images.ts:216-226).
            // ensureUploadDirectories() above guarantees the tree exists so a
            // fresh volume does not map ENOENT to a misleading message. Surfaces
            // a clean 507 instead of an opaque 422 from saveOriginalAndGetMetadata
            // on ENOSPC. The upload tree was created above.
            try {
                const stats = await statfs(UPLOAD_DIR_ORIGINAL);
                // R14C14 / SEC-14-01: use `bavail` (blocks available to a
                // NON-root process), not `bfree` — bfree counts the ~5%
                // root-reserved blocks the non-root `node` user cannot allocate,
                // so the pre-check could pass and then ENOSPC at writeFile.
                // Mirrors the browser path (images.ts).
                const freeBytes = stats.bavail * stats.bsize;
                if (freeBytes < 1024 * 1024 * 1024) {
                    return NextResponse.json(
                        { error: 'Insufficient disk space' },
                        { status: 507, headers: NO_CACHE },
                    );
                }
            } catch (err) {
                console.error('LR upload: failed to inspect upload disk space', err);
                return NextResponse.json(
                    { error: 'Insufficient disk space' },
                    { status: 507, headers: NO_CACHE },
                );
            }

            // Run-3 RPF cycle 4 / F3 (DEF-C4-03): mirror the browser upload
            // path's cumulative upload-tracker window (app/actions/images.ts:
            // 183-237, 259-265, settle at 497/519). The per-file 200 MB cap and
            // Sharp limitInputPixels already bound abuse, but this closes the
            // last divergence so both ingress paths share identical cumulative
            // limits. PAT requests are single-file, so claimedCount = 1 and
            // claimedBytes = fileEntry.size. Key on the verified token user (or
            // IP for the cookie fallback) so a single photographer's PAT cannot
            // exceed the window. On any pre-save reject the claim is settled back
            // to zero; on success it is settled to the actual upload.
            const trackerKey = `lr:${tokenUserId ?? ip}`;
            const uploadTracker = getUploadTracker();
            pruneUploadTracker();
            let tracker = uploadTracker.get(trackerKey);
            if (!tracker) {
                tracker = { count: 0, bytes: 0, windowStart: Date.now() };
                uploadTracker.set(trackerKey, tracker);
            }
            resetUploadTrackerWindowIfExpired(tracker, Date.now());
            if (tracker.count + 1 > UPLOAD_MAX_FILES_PER_WINDOW) {
                return NextResponse.json(
                    { error: 'Upload limit reached; retry later' },
                    { status: 429, headers: NO_CACHE },
                );
            }
            const fileSize = fileEntry.size;
            if (fileSize > MAX_TOTAL_UPLOAD_BYTES || tracker.bytes + fileSize > MAX_TOTAL_UPLOAD_BYTES) {
                return NextResponse.json(
                    { error: 'Cumulative upload size exceeded; retry later' },
                    { status: 429, headers: NO_CACHE },
                );
            }
            // Pre-claim the quota before the save so concurrent PAT requests
            // from the same token cannot all read the same tracker state and
            // bypass the window (TOCTOU parity with images.ts:259-265). Settled
            // back down on every pre-success return below.
            tracker.count += 1;
            tracker.bytes += fileSize;
            uploadTracker.set(trackerKey, tracker);
            // R4C4 COR-R4C4-03: idempotent settle — the widened containment
            // catch below may run after a reject branch already settled (e.g.
            // a throw following the HDR-reject's own settle). A double settle
            // of the same claim would steal quota from OTHER concurrent
            // claims under this key, so the closure settles at most once.
            let trackerSettled = false;
            const settleTrackerToActual = (success: boolean) => {
                if (trackerSettled) return;
                trackerSettled = true;
                settleUploadTrackerClaim(
                    uploadTracker,
                    trackerKey,
                    1,
                    fileSize,
                    success ? 1 : 0,
                    success ? fileSize : 0,
                );
            };

            let data: Awaited<ReturnType<typeof saveOriginalAndGetMetadata>>;
            try {
                data = await saveOriginalAndGetMetadata(fileEntry);
            } catch (err: unknown) {
                // Run-3 RPF cycle 3 / F4 (CR-C3-02): surface RAW rejections with
                // the same actionable message as the browser path
                // (app/actions/images.ts → rawNotSupported) instead of an opaque
                // "Upload failed". The shared getSafeExtension throws RawFileError
                // for known camera-RAW extensions; the rejection itself already
                // happens, only the message diverged.
                // F3: the save never produced an original, so release the
                // pre-claimed tracker quota before returning.
                settleTrackerToActual(false);
                if (err instanceof RawFileError) {
                    return NextResponse.json(
                        { error: 'RAW files are not supported. Export to JPEG, TIFF, or AVIF first.' },
                        { status: 422, headers: NO_CACHE },
                    );
                }
                const msg = err instanceof Error ? err.message : 'Upload failed';
                return NextResponse.json({ error: msg }, { status: 422, headers: NO_CACHE });
            }

        // R4C4 COR-R4C4-03: contain the WHOLE post-save window, mirroring the
        // browser path's per-file catch (app/actions/images.ts:270-475). The
        // previous narrow insert-only try left `extractExifForDb`,
        // `cleanupOriginalIfRestoreMaintenanceBegan`, and `assertBlurDataUrl`
        // (which throws BY CONTRACT on producer drift, AGG2-L03) bare — a
        // throw there leaked the pre-claimed tracker quota for the rest of
        // the 1-hour window, orphaned the on-disk original, and surfaced a
        // non-JSON Next.js 500 the Lightroom plugin cannot parse. The early
        // returns inside this block settle their own claims (the settle
        // closure is idempotent) and are unaffected. Post-insert work
        // (enqueue/audit/revalidate) stays OUTSIDE: once the row exists,
        // deleting the original would be wrong.
        let imageId: number;
        let exifDb: ReturnType<typeof extractExifForDb>;
        try {
        // Run-3 RPF cycle 1 / F2: honor the `allow_hdr_ingest` admin setting on
        // the Lightroom PAT path, mirroring the browser upload action
        // (app/actions/images.ts). `allow_hdr_ingest` (default false) is
        // documented as "PQ/HLG sources rejected at upload by default"; before
        // this gate the Lightroom publish-plugin path — the primary non-browser
        // ingest — silently accepted HDR sources the admin had asked to reject.
        // Not a public-honesty issue (is_hdr / transfer_function are admin-only
        // and process-image encodes SDR derivatives regardless), but a genuine
        // admin-intent / contract drift the R8 plan predicted.
        if (data.colorSignals?.isHdr && !config.allowHdrIngest) {
            await deleteOriginalUploadFile(data.filenameOriginal);
            // F3: rejected before insert — release the pre-claimed quota.
            settleTrackerToActual(false);
            return NextResponse.json(
                { error: 'HDR ingest is disabled' },
                { status: 422, headers: NO_CACHE },
            );
        }

        exifDb = extractExifForDb(data.exifData);
        if (config.stripGpsOnUpload) {
            exifDb.latitude = null;
            exifDb.longitude = null;
            // Run-3 RPF cycle 2 / F1: also strip GPS EXIF from the on-disk
            // original, mirroring the browser upload path (app/actions/images.ts
            // PP-BUG-3). Nulling the DB columns alone leaves GPS at rest in the
            // retained original on disk, against the admin's explicit
            // strip_gps_on_upload intent. The Lightroom publish-plugin is the
            // primary non-browser ingest and its exports commonly retain GPS,
            // so this divergence is the high-likelihood leak path.
            // Best-effort: stripGpsFromOriginal catches its own errors and never
            // throws, so a strip failure logs and keeps the image (parity with
            // the browser path) rather than aborting the upload.
            await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
        }

        // Run-3 RPF cycle 4 / F1 (DEF-C4-01): late restore-maintenance re-check,
        // mirroring the browser path's post-save guard (app/actions/images.ts:
        // 326-330). A DB restore may have begun AFTER the entry guard but during
        // the (slow) save+EXIF+GPS-strip window. If so, delete the orphaned
        // on-disk original and abort before the insert so the restore is not
        // raced with a half-written row. Returns true when maintenance began and
        // the original was cleaned up.
        if (await cleanupOriginalIfRestoreMaintenanceBegan(data.filenameOriginal, deleteOriginalUploadFile)) {
            // F3: released the quota since no image landed.
            settleTrackerToActual(false);
            return NextResponse.json(
                { error: 'Restore in progress; retry shortly' },
                { status: 503, headers: NO_CACHE },
            );
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
            // R4C1 COR-R4C1-04: lengths validated by code points above; store
            // the sanitized values unsliced (parity with updateImageMetadata).
            title: title || null,
            description: description ?? '',
            // R4C1 COR-R4C1-03: sanitized basename, parity with browser path.
            user_filename: safeUserFilename,
            blur_data_url: assertBlurDataUrl(data.blurDataUrl),
            processed: false,
            ...exifDb,
            // Run-3 RPF cycle 3 / F1 (SEC-C3-01): mirror the browser upload path
            // exactly. `color_space` is the EXIF ColorSpace tag value (NOT the
            // ICC name — CLAUDE.md `images` color columns table) and arrives via
            // `...exifDb`, so it must NOT be overwritten with the ICC descriptor.
            // The ICC descriptor belongs in its own `icc_profile_name` column,
            // which the Color Details audit row reads. The prior shape both lost
            // the ICC name (column never written → NULL) and polluted
            // `color_space` with wrong-semantics data.
            icc_profile_name: data.iccProfileName,
            bit_depth: data.bitDepth,
            // R8-H2: mirror browser upload path — store all color/HDR signals
            // so the Color Details accordion shows complete metadata.
            color_pipeline_decision: data.colorPipelineDecision,
            color_primaries: data.colorSignals?.colorPrimaries ?? null,
            transfer_function: data.colorSignals?.transferFunction ?? null,
            matrix_coefficients: data.colorSignals?.matrixCoefficients ?? null,
            is_hdr: data.colorSignals?.isHdr ?? false,
            has_gain_map: data.colorSignals?.hasGainMap ?? false,
            pipeline_version: IMAGE_PIPELINE_VERSION,
            // Run-3 RPF cycle 3 / F2 (SEC-C3-02): attribute the upload to the
            // verified PAT user, mirroring the browser path
            // (app/actions/images.ts:375 `uploaded_by: currentUser.id`). Without
            // this, every LR-published image has `uploaded_by = NULL` and the
            // public Atom per-entry <author> (R17-L2) falls back to the
            // feed-level author — attribution is dead on the primary non-browser
            // ingest path even though the PAT identifies the photographer.
            // Cookie-fallback requests (tokenUserId === null) degrade gracefully
            // to NULL, same as a legacy upload.
            uploaded_by: tokenUserId,
            original_format: (data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null,
            original_file_size: fileEntry.size,
        };

        // R4C1 COR-R4C1-02 / R4C4 COR-R4C4-03: the catch below contains the
        // whole post-save window opened above — EXIF extraction, the late
        // restore-maintenance probe, the blur-data-url write barrier, and
        // the insert itself (where a concurrent topic deletion surfaces as
        // an FK violation and a thrown safeInsertId lands too). Cleanup is
        // safe to repeat: deleteOriginalUploadFile never throws (both
        // unlinks self-catch) and the settle closure is idempotent.
        const insertResult = await db.insert(images).values(insertValues);
        imageId = safeInsertId(insertResult[0].insertId);
        } catch (err) {
            console.error('LR upload: post-save processing failed', err);
            await deleteOriginalUploadFile(data.filenameOriginal);
            settleTrackerToActual(false);
            return NextResponse.json(
                { error: 'Upload failed' },
                { status: 500, headers: NO_CACHE },
            );
        }

        // F3: the upload completed — reconcile the pre-claim to the actual
        // (1 file, fileSize bytes). Identity settle here, but kept explicit so
        // the claim/settle pairing is symmetric with the browser path and the
        // reject branches above.
        settleTrackerToActual(true);

        enqueueImageProcessing({
            id: imageId,
            filenameOriginal: data.filenameOriginal,
            filenameWebp: data.filenameWebp,
            filenameAvif: data.filenameAvif,
            filenameJpeg: data.filenameJpeg,
            width: data.width,
            topic: topicSlug,
            quality: {
                webp: config.imageQualityWebp,
                avif: config.imageQualityAvif,
                jpeg: config.imageQualityJpeg,
            },
            imageSizes: config.imageSizes.length > 0 ? config.imageSizes : undefined,
            // CR-R9C7-01: carry the remaining 6 admin processing settings on
            // the job (upload-time snapshot from the already-loaded `config`),
            // exactly mirroring the browser upload path (actions/images.ts).
            // Without these, the queue handler's config-load gate never enters
            // (it only enters when BOTH quality and imageSizes are absent, which
            // never happens here because this path always supplies a truthy
            // `quality` object), so these settings were silently ignored on
            // every Lightroom publish until a backfill re-encode — the same
            // defect class CR-R9C6-01 fixed for the browser path but which the
            // c6 fix missed on this parallel enqueue site.
            forceSrgbDerivatives: config.forceSrgbDerivatives,
            wideGamutJpegChroma: config.wideGamutJpegChroma,
            avifEffort: config.avifEffort,
            sdrJpegChroma: config.sdrJpegChroma,
            wideGamutMaxSourcePixels: config.wideGamutMaxSourcePixels,
            autoAltTextEnabled: config.autoAltTextEnabled,
            // R4C1 COR-R4C1-05: forward EXIF caption inputs, mirroring the
            // browser path. Without these the auto alt-text stub
            // (caption-generator.ts) emits the generic "[AUTO] Photo" for
            // every LR publish instead of the camera-specific caption.
            camera_model: exifDb.camera_model,
            capture_date: exifDb.capture_date,
            iccProfileName: data.iccProfileName,
            // R8-H2: forward color signals so the queue worker can make
            // NCLX-informed pipeline decisions identical to browser uploads.
            colorSignals: data.colorSignals,
        });

        // R18-M2: bump audit-log failure severity from console.debug to
        // console.warn so log shippers (Datadog/Loki) retain the line for
        // post-incident triage. The token-bearing publish-plugin path is
        // the high-trust audit surface — silently dropping audit failures
        // makes "who uploaded image #N" unanswerable for multi-photographer
        // studios. Structured payload mirrors the cycle 5-8 webhook log
        // shape so operators can grep by imageId during forensics.
        await logAuditEvent(
            tokenUserId,
            'lr_token_used',
            'image',
            String(imageId),
            ip,
            // R4C1 COR-R4C1-03: audit the sanitized name, not raw client input.
            { topic: topicSlug, filename: safeUserFilename },
        ).catch((err) => {
            console.warn('LR upload: audit log insert failed', {
                userId: tokenUserId,
                imageId,
                action: 'lr_token_used',
                err,
            });
        });

        revalidateAllAppData();

        return NextResponse.json(
            { success: true, id: imageId },
            { status: 201, headers: NO_CACHE },
        );
        } finally {
            // Run-3 RPF cycle 3 / F3: always release the contract lock, mirroring
            // the browser path's try/finally (app/actions/images.ts:545-547).
            await uploadContractLock.release();
        }
    },
    { allowTokenScope: 'lr:upload' },
);
