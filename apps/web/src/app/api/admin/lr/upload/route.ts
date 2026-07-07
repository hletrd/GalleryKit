/**
 * POST /api/admin/lr/upload
 *
 * Accepts a multipart upload from external publish clients, including
 * Lightroom-compatible implementations, and creates a new image record.
 * GalleryKit exposes the server-side API only; it does not bundle or
 * distribute a client plugin. Authentication is via the
 * `X-GalleryKit-Token` header (PAT with scope `lr:upload`); ordinary browser
 * admin-session cookies are also accepted as a fallback for testing.
 *
 * Same-origin enforcement: token-bearing requests do NOT need same-origin
 * (cross-origin integration is the point of PATs). The `withAdminAuth` wrapper
 * handles both auth paths when `allowTokenScope` is set.
 *
 * US-P53: this route is the server-side upload API for API-token clients. It
 * re-uses the existing upload infrastructure
 * (saveOriginalAndGetMetadata, enqueueImageProcessing) so image processing,
 * EXIF extraction, and revalidation are identical to the browser upload path.
 */

import path from 'path';
import { statfs } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuthToken, markAdminAuthTokenUsed, withAdminAuth } from '@/lib/api-auth';
import { db, topics, images } from '@/db';
import { eq } from 'drizzle-orm';
import { saveOriginalAndGetMetadata, extractExifForDb, stripGpsFromOriginal, IMAGE_PIPELINE_VERSION, RawFileError } from '@/lib/process-image';
import { ensureUploadDirectories, deleteOriginalUploadFile, UPLOAD_DIR_ORIGINAL } from '@/lib/upload-paths';
import {
    createProcessingSettingsSnapshot,
    enqueueImageProcessing,
    serializeProcessingSettingsSnapshot,
} from '@/lib/image-queue';
import { acquireUploadProcessingContractLock } from '@/lib/upload-processing-contract-lock';
import { isValidSlug, safeInsertId } from '@/lib/validation';
import { countCodePoints } from '@/lib/utils';
import { getSafeUserFilename } from '@/lib/upload-filenames';
import { logAuditEvent } from '@/lib/audit';
import { getClientIp } from '@/lib/rate-limit';
import { getGalleryConfigStrict } from '@/lib/gallery-config';
import { assertBlurDataUrl } from '@/lib/blur-data-url';
import { sanitizeAdminString } from '@/lib/sanitize';
import { revalidateAllAppData } from '@/lib/revalidation';
import { isRestoreMaintenanceActive, cleanupOriginalIfRestoreMaintenanceBegan } from '@/lib/restore-maintenance';
import { getUploadTracker, pruneUploadTracker, resetUploadTrackerWindowIfExpired } from '@/lib/upload-tracker-state';
import { settleUploadTrackerClaim } from '@/lib/upload-tracker';
import {
    MAX_TOTAL_UPLOAD_BYTES,
    MAX_UPLOAD_FILE_BYTES,
    SERVER_ACTION_BODY_OVERHEAD_BYTES,
    UPLOAD_MAX_FILES_PER_WINDOW,
} from '@/lib/upload-limits';
import { getCurrentUser } from '@/app/actions/auth';

const NO_CACHE = {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
};

const LR_MULTIPART_PARSE_MAX_IN_FLIGHT = 1;
let lrMultipartParseInFlight = 0;

function tryAcquireLrMultipartParseSlot() {
    if (lrMultipartParseInFlight >= LR_MULTIPART_PARSE_MAX_IN_FLIGHT) {
        return null;
    }
    lrMultipartParseInFlight += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        lrMultipartParseInFlight = Math.max(0, lrMultipartParseInFlight - 1);
    };
}

// R21-L1: pin to Node runtime explicitly. The route uses `db` (mysql2),
// the Sharp-backed image-processing pipeline (libvips bindings), and
// the in-process upload queue — all Node-only. A future Next.js
// default flip to Edge would break the external publish-client
// primary integration path with zero in-product diagnostic. Matches
// the Node-runtime pinning convention (R20-L2) used across Node-bound routes.
export const runtime = 'nodejs';

export const POST = withAdminAuth(
    async function POST(request: NextRequest) {
        // The withAdminAuth wrapper already verified token scope and passes the
        // accepted token through request-scoped context. Using that avoids re-verifying
        // and double-touching last_used_at on successful PAT uploads.
        const tokenUserId = getAdminAuthToken(request)?.userId ?? null;
        const cookieUser = tokenUserId === null ? await getCurrentUser() : null;
        const actorUserId = tokenUserId ?? cookieUser?.id ?? null;
        const ip = getClientIp(request.headers);

        if (isRestoreMaintenanceActive()) {
            return NextResponse.json(
                { error: 'Restore in progress; retry shortly' },
                { status: 503, headers: NO_CACHE },
            );
        }

        const transferEncoding = request.headers.get('transfer-encoding');
        if (transferEncoding && transferEncoding.toLowerCase().includes('chunked')) {
            return NextResponse.json(
                { error: 'Content-Length is required for Lightroom uploads' },
                { status: 411, headers: NO_CACHE },
            );
        }

        const contentLengthHeader = request.headers.get('content-length');
        const declaredUploadBytes = contentLengthHeader ? Number(contentLengthHeader) : NaN;
        if (!Number.isSafeInteger(declaredUploadBytes) || declaredUploadBytes <= 0) {
            return NextResponse.json(
                { error: 'Content-Length is required for Lightroom uploads' },
                { status: 411, headers: NO_CACHE },
            );
        }
        if (declaredUploadBytes > MAX_TOTAL_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: 'Cumulative upload size exceeded; retry later' },
                { status: 429, headers: NO_CACHE },
            );
        }
        if (declaredUploadBytes > MAX_UPLOAD_FILE_BYTES + SERVER_ACTION_BODY_OVERHEAD_BYTES) {
            return NextResponse.json(
                { error: 'Uploaded file is too large' },
                { status: 413, headers: NO_CACHE },
            );
        }

        const trackerKey = `lr:${actorUserId ?? ip}`;
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
        if (tracker.bytes + declaredUploadBytes > MAX_TOTAL_UPLOAD_BYTES) {
            return NextResponse.json(
                { error: 'Cumulative upload size exceeded; retry later' },
                { status: 429, headers: NO_CACHE },
            );
        }

        const releaseMultipartParseSlot = tryAcquireLrMultipartParseSlot();
        if (!releaseMultipartParseSlot) {
            return NextResponse.json(
                { error: 'Another Lightroom upload is being parsed; retry shortly' },
                { status: 429, headers: NO_CACHE },
            );
        }

        let trackerSettled = false;
        const settleTrackerToActual = (success: boolean, actualBytes: number = 0) => {
            if (trackerSettled) return;
            trackerSettled = true;
            settleUploadTrackerClaim(
                uploadTracker,
                trackerKey,
                1,
                declaredUploadBytes,
                success ? 1 : 0,
                success ? actualBytes : 0,
            );
        };

        let formData: FormData;
        try {
            await markAdminAuthTokenUsed(request);

            tracker.count += 1;
            tracker.bytes += declaredUploadBytes;
            uploadTracker.set(trackerKey, tracker);

            try {
                formData = await request.formData();
            } catch {
                settleTrackerToActual(false);
                return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400, headers: NO_CACHE });
            }
        } finally {
            releaseMultipartParseSlot();
        }

        const fileEntry = formData.get('file');
        if (!(fileEntry instanceof File)) {
            settleTrackerToActual(false);
            return NextResponse.json({ error: 'Missing file field' }, { status: 400, headers: NO_CACHE });
        }
        const fileSize = fileEntry.size;
        if (fileSize > MAX_UPLOAD_FILE_BYTES) {
            settleTrackerToActual(false);
            return NextResponse.json(
                { error: 'Uploaded file is too large' },
                { status: 413, headers: NO_CACHE },
            );
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
            settleTrackerToActual(false);
            return NextResponse.json({ error: 'Invalid filename' }, { status: 400, headers: NO_CACHE });
        }

        const topicSlug = formData.get('topic')?.toString().trim() ?? '';
        if (!topicSlug || !isValidSlug(topicSlug)) {
            settleTrackerToActual(false);
            return NextResponse.json({ error: 'Invalid or missing topic slug' }, { status: 400, headers: NO_CACHE });
        }

        const rawTitle = formData.get('title')?.toString() ?? null;
        const { value: title, rejected: titleRejected } = rawTitle
            ? sanitizeAdminString(rawTitle)
            : { value: null, rejected: false };
        if (titleRejected) {
            settleTrackerToActual(false);
            return NextResponse.json({ error: 'Invalid title' }, { status: 400, headers: NO_CACHE });
        }
        const rawDesc = formData.get('description')?.toString() ?? null;
        const { value: description, rejected: descRejected } = rawDesc
            ? sanitizeAdminString(rawDesc)
            : { value: null, rejected: false };
        if (descRejected) {
            settleTrackerToActual(false);
            return NextResponse.json({ error: 'Invalid description' }, { status: 400, headers: NO_CACHE });
        }

        // R4C1 COR-R4C1-04: mirror the canonical admin metadata constraints
        // (updateImageMetadata, C7-AGG7R-02) — validate by Unicode code
        // points and reject loudly instead of silently truncating with a
        // UTF-16 `.slice()` that can bisect a surrogate pair (trailing
        // U+FFFD mojibake on the photographer's caption).
        if (title && countCodePoints(title) > 255) {
            settleTrackerToActual(false);
            return NextResponse.json({ error: 'Title too long (max 255 characters)' }, { status: 400, headers: NO_CACHE });
        }
        if (description && countCodePoints(description) > 5000) {
            settleTrackerToActual(false);
            return NextResponse.json({ error: 'Description too long (max 5000 characters)' }, { status: 400, headers: NO_CACHE });
        }

        // C61-02: re-check restore maintenance after multipart parsing and
        // validation, then acquire the upload-processing contract lock BEFORE
        // the topic DB SELECT. A restore can begin while a large multipart body
        // is being parsed; without this second guard and earlier lock, the route
        // can query tables during the restore window before the lock rejects it.
        if (isRestoreMaintenanceActive()) {
            settleTrackerToActual(false);
            return NextResponse.json(
                { error: 'Restore in progress; retry shortly' },
                { status: 503, headers: NO_CACHE },
            );
        }

        // Run-3 RPF cycle 3 / F3 (CR-C3-01), extended by C61-02: acquire the
        // upload-processing contract lock for the topic-verify→save→insert→enqueue
        // window, mirroring the browser upload action. The MySQL advisory lock
        // `gallerykit_upload_processing_contract` serializes uploads with
        // restores and `image_sizes` / `strip_gps_on_upload` settings changes so
        // the first committed image cannot race a setting intended to lock once
        // photos exist.
        const uploadContractLock = await acquireUploadProcessingContractLock();
        if (!uploadContractLock) {
            settleTrackerToActual(false);
            return NextResponse.json(
                { error: 'Upload settings are being changed; retry shortly' },
                { status: 409, headers: NO_CACHE },
            );
        }

        try {
            // Verify topic exists under the upload-processing contract lock. This
            // runs after the conservative upload preclaim, so thrown DB errors
            // must settle the claim before returning.
            let topicRow: { slug: string } | undefined;
            try {
                [topicRow] = await db.select({ slug: topics.slug })
                    .from(topics)
                    .where(eq(topics.slug, topicSlug))
                    .limit(1);
            } catch (err) {
                settleTrackerToActual(false);
                console.error('LR upload: failed to verify topic', err);
                return NextResponse.json({ error: 'Upload failed' }, { status: 500, headers: NO_CACHE });
            }
            if (!topicRow) {
                settleTrackerToActual(false);
                return NextResponse.json({ error: 'Topic not found' }, { status: 404, headers: NO_CACHE });
            }

            try {
                await ensureUploadDirectories();
            } catch (err) {
                console.error('LR upload: failed to prepare upload directories', err);
                settleTrackerToActual(false);
                return NextResponse.json(
                    { error: 'Upload storage unavailable; retry shortly' },
                    { status: 503, headers: NO_CACHE },
                );
            }

            let config: Awaited<ReturnType<typeof getGalleryConfigStrict>>;
            try {
                config = await getGalleryConfigStrict();
            } catch (err) {
                console.error('LR upload: failed to read upload settings', err);
                settleTrackerToActual(false);
                return NextResponse.json(
                    { error: 'Upload settings unavailable; retry shortly' },
                    { status: 503, headers: NO_CACHE },
                );
            }
            const processingSettingsSnapshot = createProcessingSettingsSnapshot(config);

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
                    settleTrackerToActual(false);
                    return NextResponse.json(
                        { error: 'Insufficient disk space' },
                        { status: 507, headers: NO_CACHE },
                    );
                }
            } catch (err) {
                console.error('LR upload: failed to inspect upload disk space', err);
                settleTrackerToActual(false);
                return NextResponse.json(
                    { error: 'Insufficient disk space' },
                    { status: 507, headers: NO_CACHE },
                );
            }

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
                console.error('LR upload: failed to save uploaded original', err);
                return NextResponse.json(
                    { error: 'Upload failed while processing the image.' },
                    { status: 422, headers: NO_CACHE },
                );
            }

        // R4C4 COR-R4C4-03: contain the WHOLE post-save window, mirroring the
        // browser path's per-file catch (app/actions/images.ts:270-475). The
        // previous narrow insert-only try left `extractExifForDb`,
        // `cleanupOriginalIfRestoreMaintenanceBegan`, and `assertBlurDataUrl`
        // (which throws BY CONTRACT on producer drift, AGG2-L03) bare — a
        // throw there leaked the pre-claimed tracker quota for the rest of
        // the 1-hour window, orphaned the on-disk original, and surfaced a
        // non-JSON Next.js 500 an external publish client cannot parse. The early
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
        // this gate the external publish-client path — the primary non-browser
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
            // strip_gps_on_upload intent. Non-browser ingest clients commonly
            // retain GPS, so this divergence is the high-likelihood leak path.
            const gpsStripped = await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
            if (!gpsStripped) {
                await deleteOriginalUploadFile(data.filenameOriginal);
                settleTrackerToActual(false);
                return NextResponse.json(
                    { error: 'GPS metadata could not be stripped from the original' },
                    { status: 422, headers: NO_CACHE },
                );
            }
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
            // verified PAT user, or the cookie-session admin used by the
            // documented fallback test path, for admin/audit linkage.
            // Public Atom currently uses the configured feed-level author;
            // per-entry public attribution requires a future safe display-name
            // column.
            uploaded_by: actorUserId,
            original_format: (data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null,
            original_file_size: fileEntry.size,
            processing_settings_json: serializeProcessingSettingsSnapshot(processingSettingsSnapshot),
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

        // C1-15 (run-10 cycle-1, CR-02): the image row is COMMITTED past this
        // point. Everything below is post-commit bookkeeping — if any of it
        // throws (revalidateAllAppData is the realistic candidate;
        // enqueueImageProcessing returns a bool and logAuditEvent self-catches),
        // the upload still SUCCEEDED, so the external publish client must
        // receive a parseable JSON success rather than a framework-generated
        // non-JSON 500 that would trigger a spurious client retry and a
        // duplicate upload. A missed enqueue is self-healing: the bootstrap
        // scan re-discovers processed=false rows without a processing_error.
        try {
        // F3: the upload completed — reconcile the pre-claim to the actual
        // (1 file, fileSize bytes). Identity settle here, but kept explicit so
        // the claim/settle pairing is symmetric with the browser path and the
        // reject branches above.
        settleTrackerToActual(true, fileSize);

        enqueueImageProcessing({
            id: imageId,
            filenameOriginal: data.filenameOriginal,
            filenameWebp: data.filenameWebp,
            filenameAvif: data.filenameAvif,
            filenameJpeg: data.filenameJpeg,
            width: data.width,
            topic: topicSlug,
            quality: processingSettingsSnapshot.quality,
            imageSizes: processingSettingsSnapshot.imageSizes,
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
            forceSrgbDerivatives: processingSettingsSnapshot.forceSrgbDerivatives,
            wideGamutJpegChroma: processingSettingsSnapshot.wideGamutJpegChroma,
            avifEffort: processingSettingsSnapshot.avifEffort,
            sdrJpegChroma: processingSettingsSnapshot.sdrJpegChroma,
            wideGamutMaxSourcePixels: processingSettingsSnapshot.wideGamutMaxSourcePixels,
            autoAltTextEnabled: processingSettingsSnapshot.autoAltTextEnabled,
            semanticSearchMode: processingSettingsSnapshot.semanticSearchMode,
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
        // post-incident triage. The token-bearing publish-client path is
        // the high-trust audit surface — silently dropping audit failures
        // makes "who uploaded image #N" unanswerable for multi-photographer
        // studios. Structured payload mirrors the cycle 5-8 webhook log
        // shape so operators can grep by imageId during forensics.
        await logAuditEvent(
            actorUserId,
            'lr_token_used',
            'image',
            String(imageId),
            ip,
            // R4C1 COR-R4C1-03: audit the sanitized name, not raw client input.
            { topic: topicSlug, filename: safeUserFilename },
        ).catch((err) => {
            console.warn('LR upload: audit log insert failed', {
                userId: actorUserId,
                imageId,
                action: 'lr_token_used',
                err,
            });
        });

        revalidateAllAppData();
        } catch (postCommitErr) {
            // C1-15: log loudly, but the response below still reports the
            // truth — the row is committed and the upload succeeded.
            console.error('LR upload: post-commit work failed (upload already committed)', {
                imageId,
                err: postCommitErr,
            });
        }

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
