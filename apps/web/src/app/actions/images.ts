'use server';

import path from 'path';
import { statfs } from 'fs/promises';
import { db, images, imageTags, sharedGroups, sharedGroupImages, topics } from '@/db';
import { eq, inArray, and, isNotNull, isNull, sql } from 'drizzle-orm';
import { saveOriginalAndGetMetadata, extractExifForDb, deleteImageVariantsStrict, stripGpsFromOriginal, IMAGE_PIPELINE_VERSION, RawFileError } from '@/lib/process-image';
import { UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG, deleteOriginalUploadFile, deleteOriginalUploadFileStrict, ensureUploadDirectories } from '@/lib/upload-paths';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isValidSlug, isValidFilename, isValidTagName, isValidTagSlug, safeInsertId } from '@/lib/validation';
import { countCodePoints } from '@/lib/utils';
import {
    createProcessingSettingsSnapshot,
    enqueueImageProcessing,
    getProcessingQueueState,
    serializeProcessingSettingsSnapshot,
} from '@/lib/image-queue';
import { logAuditEvent } from '@/lib/audit';
import { revalidateAllAppData, revalidateLocalizedPaths } from '@/lib/revalidation';
import { sanitizeAdminString, requireCleanInput } from '@/lib/sanitize';
import { getSafeUserFilename } from '@/lib/upload-filenames';
import { ensureTagRecord, findTagRecordByNameOrSlug, getTagSlug } from '@/lib/tag-records';
import { MAX_TOTAL_UPLOAD_BYTES, UPLOAD_MAX_FILES_PER_WINDOW } from '@/lib/upload-limits';
import { getGalleryConfigStrict, type GalleryConfig } from '@/lib/gallery-config';
import { getClientIp } from '@/lib/rate-limit';
import { cleanupOriginalIfRestoreMaintenanceBegan, getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier';
import { settleUploadTrackerClaim } from '@/lib/upload-tracker';
import { getUploadTracker, pruneUploadTracker, resetUploadTrackerWindowIfExpired } from '@/lib/upload-tracker-state';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { acquireUploadProcessingContractLock } from '@/lib/upload-processing-contract-lock';
import { assertBlurDataUrl } from '@/lib/blur-data-url';
import { isWideGamutPrimary } from '@/lib/color-primaries';
import { headers } from 'next/headers';
import type { BulkUpdateImagesInput, TriState } from '@/lib/bulk-edit-types';
import { stripStubPrefix } from '@/lib/caption-constants';
import { parseBoundedPositiveInteger } from '@/lib/env';
import { toMySqlDateTime } from '@/lib/mysql-datetime';

type ImageCleanupFailure = {
    target: 'original' | 'webp' | 'avif' | 'jpeg';
    filename: string;
    reason: string;
};

type NormalizedBulkTagName = {
    name: string;
    slug: string;
};

// R4C1 COR-R4C1-03: getSafeUserFilename (C2L2-03 / C2L2-05) moved to
// @/lib/upload-filenames so the Lightroom PAT route shares the exact same
// sanitizer instead of re-implementing (and drifting from) it.
const CLEANUP_RETRY_DELAY_MS = 50;

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBulkTagName(name: string): NormalizedBulkTagName | null {
    const { value: cleanName, rejected } = requireCleanInput(name);
    if (rejected || !cleanName) return null;
    if (!isValidTagName(cleanName)) return null;
    const slug = getTagSlug(cleanName);
    if (!isValidTagSlug(slug)) return null;
    return { name: cleanName, slug };
}

async function collectImageCleanupFailures(tasks: {
    target: ImageCleanupFailure['target'];
    filename: string;
    operation: () => Promise<void>;
}[]) {
    const settled = await Promise.all(tasks.map(async (task) => {
        let lastReason: unknown;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await task.operation();
                return null;
            } catch (err) {
                lastReason = err;
                if (attempt === 0) {
                    await wait(CLEANUP_RETRY_DELAY_MS);
                }
            }
        }

        const reason = lastReason instanceof Error
            ? lastReason.message
            : String(lastReason ?? 'unknown cleanup failure');

        return {
            target: task.target,
            filename: task.filename,
            reason,
        } satisfies ImageCleanupFailure;
    }));

    return settled.filter((failure): failure is ImageCleanupFailure => failure !== null);
}

async function getSharedGroupKeysForImages(imageIds: number[]) {
    if (imageIds.length === 0) return [];

    const rows = await db.select({ key: sharedGroups.key })
        .from(sharedGroupImages)
        .innerJoin(sharedGroups, eq(sharedGroupImages.groupId, sharedGroups.id))
        .where(inArray(sharedGroupImages.imageId, imageIds));

    return [...new Set(rows.map((row) => row.key).filter(Boolean))];
}

function getShareRevalidationPaths(shareKeys: Iterable<string | null>, groupKeys: Iterable<string>) {
    const paths = new Set<string>();

    for (const shareKey of shareKeys) {
        if (shareKey) paths.add(`/s/${shareKey}`);
    }
    for (const groupKey of groupKeys) {
        paths.add(`/g/${groupKey}`);
    }

    return [...paths];
}


export async function uploadImages(formData: FormData) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { error: t('unauthorized') };
    }
    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    // Topic and tags are admin-controlled strings that become route/query/UI
    // data. Reject rather than silently stripping C0/C1 or Unicode formatting
    // characters so validation, user feedback, and persistence cannot drift.
    const { value: topicValue, rejected: topicRejected } = requireCleanInput(formData.get('topic')?.toString());
    const { value: tagsValue, rejected: tagsRejected } = requireCleanInput(formData.get('tags')?.toString());
    if (topicRejected) {
        return { error: t('invalidTopicFormat') };
    }
    if (tagsRejected) {
        return { error: t('invalidTagNames') };
    }
    const topic = topicValue ?? '';
    const tagsString = tagsValue ?? '';

    if (tagsString && countCodePoints(tagsString) > 1000) {
        return { error: t('tagsStringTooLong') };
    }

    // C7L-FIX-01: single split — derive both the validated tag list AND the
    // count of non-empty candidates from the same source so the validate /
    // count steps cannot drift if the parse rule changes. The earlier shape
    // ran `tagsString.split(',')` twice, which silently created a maintenance
    // hazard: changing the separator or trim rule in the validate pass
    // without updating the count pass would have made every batch return
    // `invalidTagNames`. The fix also avoids the redundant array allocation
    // on the upload hot path. Defense in depth still abort-on-any-bad-tag.
    const candidateTags = tagsString
        ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];
    const tagNames = candidateTags.filter(t => isValidTagName(t) && isValidTagSlug(getTagSlug(t)));

    if (candidateTags.length !== tagNames.length) {
        return { error: t('invalidTagNames') };
    }

    if (!files.length) return { error: t('noFilesProvided') };
    if (files.length > UPLOAD_MAX_FILES_PER_WINDOW) return { error: t('tooManyFiles') };

    const userFilenames = new Map<File, string>();
    for (const file of files) {
        const safeFilename = getSafeUserFilename(file.name);
        if (!safeFilename) {
            return { error: t('invalidFilename') };
        }
        userFilenames.set(file, safeFilename);
    }

    // Server-side cumulative upload tracking across per-file invocations.
    // The client sends files individually, so per-call limits are insufficient.
    const uploadContractLock = await acquireUploadProcessingContractLock();
    if (!uploadContractLock) {
        return { error: t('uploadSettingsLocked') };
    }

    try {
        let uploadConfig: GalleryConfig;
        try {
            uploadConfig = await getGalleryConfigStrict();
        } catch (err) {
            console.error('Failed to read upload settings', err);
            return { error: t('failedToFetchGallerySettings') };
        }
        const processingSettingsSnapshot = createProcessingSettingsSnapshot(uploadConfig);
        const requestHeaders = await headers();
        const uploadIp = getClientIp(requestHeaders);
        const uploadTrackerKey = `${currentUser.id}:${uploadIp}`;
        const now = Date.now();
        const uploadTracker = getUploadTracker();
        // Prune stale entries unconditionally to prevent unbounded memory growth
        pruneUploadTracker();
        // C8R-RPL-02 / AGG8R-02: close the first-insert TOCTOU. Without an
        // explicit `set()` BEFORE any subsequent `await`, two concurrent
        // requests from a cold IP each create their own literal and both
        // pass the cumulative-limit check below. Registering the entry on
        // the Map up-front makes subsequent mutations share the same object
        // reference across concurrent invocations.
        let tracker = uploadTracker.get(uploadTrackerKey);
        if (!tracker) {
            tracker = { count: 0, bytes: 0, windowStart: now };
            uploadTracker.set(uploadTrackerKey, tracker);
        }
        resetUploadTrackerWindowIfExpired(tracker, now);

        // R16C16 CR-16-01: close the check-then-claim TOCTOU. ALL quota + format
        // checks below are SYNCHRONOUS (no await), and the claim is made
        // immediately after them BEFORE the first await (disk + topic-exists).
        // Previously the count/byte checks were separated from the claim by two
        // awaits, so two concurrent same-key uploads could both pass the checks
        // before either claimed and jointly exceed the window limits. The two
        // awaited validations that follow the claim roll it back on early return.
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        if (tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW) {
            return { error: t('uploadLimitReached') };
        }
        // Validate total upload size (per-call limit)
        if (totalSize > MAX_TOTAL_UPLOAD_BYTES) {
            return { error: t('totalUploadSizeExceeded') };
        }
        // Also enforce cumulative byte limit across per-file invocations
        if (tracker.bytes + totalSize > MAX_TOTAL_UPLOAD_BYTES) {
            return { error: t('cumulativeUploadSizeExceeded') };
        }
        if (!topic) {
            return { error: t('topicRequired') };
        }
        // Validate topic slug format
        if (!isValidSlug(topic)) {
            return { error: t('invalidTopicFormat') };
        }

        // CLAIM the quota now, synchronously, before any await — this is the
        // point that makes the check+claim atomic against concurrent invocations.
        tracker.bytes += totalSize;
        tracker.count += files.length;
        uploadTracker.set(uploadTrackerKey, tracker);
        let trackerSettled = false;
        const settleClaim = (successfulFiles: number, successfulBytes: number) => {
            if (trackerSettled) return;
            trackerSettled = true;
            settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, successfulFiles, successfulBytes);
        };

        // Disk space pre-check: require at least 1GB free before accepting uploads.
        // Ensure the upload tree exists first so fresh volumes do not map ENOENT
        // from statfs() to a misleading "insufficient disk space" error.
        try {
            await ensureUploadDirectories();
            const stats = await statfs(UPLOAD_DIR_ORIGINAL);
            // Use `bavail` (blocks available to a NON-root process), not `bfree`
            // (which includes the ~5% root-reserved blocks the `node` user cannot
            // allocate). Otherwise the pre-check can pass while the writable space
            // is below the threshold, deferring the failure to an ENOSPC at
            // writeFile with a generic error (R13C13 / AGG-R13-04).
            const freeBytes = stats.bavail * stats.bsize;
            if (freeBytes < 1024 * 1024 * 1024) {
                // Roll back the claim (no upload happened): settle with 0 success.
                settleClaim(0, 0);
                return { error: t('insufficientDiskSpace') };
            }
        } catch (err) {
            console.error('Failed to inspect upload disk space', err);
            settleClaim(0, 0);
            return { error: t('insufficientDiskSpace') };
        }

        // C11-MED-01: verify the topic exists in the database before accepting
        // uploads. The schema now has an FK, but checking here keeps the error
        // localized and avoids saving files before a doomed INSERT.
        //
        // R17C17 CR-17-1 / DBG-17-1: the quota claim above is made synchronously
        // BEFORE this awaited SELECT (the CR-16-01 TOCTOU fix). The outer `try`
        // is `finally`-only (it releases the upload-contract lock, it does NOT
        // settle the claim), so an UN-caught throw here (pool timeout, conn reset,
        // restart mid-request) would leak the claim — inflating this admin+IP
        // window by +files.length/+totalSize with zero files stored until the
        // ~1 h tracking window expires. Mirror the disk pre-check's settle-on-throw.
        // The one-shot settleClaim helper owns all post-claim exits, so future
        // branches can settle safely without double-decrementing.
        let topicRow: { slug: string } | undefined;
        try {
            [topicRow] = await db.select({ slug: topics.slug })
                .from(topics)
                .where(eq(topics.slug, topic))
                .limit(1);
        } catch (err) {
            settleClaim(0, 0);
            throw err;
        }
        if (!topicRow) {
            settleClaim(0, 0);
            return { error: t('topicNotFound') };
        }

        const uniqueTagNames = Array.from(new Set(tagNames))
            .map(tagName => tagName.trim())
            .filter(Boolean);
        const resolvedTagRecords: Array<{ id: number }> = [];
        const skippedTagNames: string[] = [];
        let tagResolutionFailed = false;
        if (uniqueTagNames.length > 0) {
            try {
                for (const cleanName of uniqueTagNames) {
                    const slug = getTagSlug(cleanName);
                    if (!isValidTagSlug(slug)) {
                        console.warn(`Skipping tag with invalid generated slug: "${cleanName}"`);
                        skippedTagNames.push(cleanName);
                        continue;
                    }
                    const resolvedTag = await ensureTagRecord(db, cleanName, slug);
                    if (resolvedTag.kind === 'collision') {
                        console.warn(`Tag slug collision: "${cleanName}" collides with existing "${resolvedTag.existing.name}" on slug "${resolvedTag.slug}"`);
                        skippedTagNames.push(cleanName);
                        continue;
                    }
                    if (resolvedTag.kind === 'found') {
                        resolvedTagRecords.push(resolvedTag.tag);
                    }
                }
            } catch (err) {
                tagResolutionFailed = true;
                console.error('Failed to resolve upload tags', err);
            }
        }

        let successCount = 0;
        let uploadedBytes = 0;
        const failedFiles: string[] = [];
        const warnings: string[] = [];
        let hdrRejectedCount = 0;
        let hdrWarningCount = 0;
        let wideGamutDownscaleWarningCount = 0;
        let gpsStripFailureCount = 0;
        // R12-H1 / R10-L4: separate RAW rejection counter so the response
        // can show a specific "RAW not supported — export to JPEG/TIFF/AVIF
        // first" message instead of a generic "all uploads failed" path.
        let rawRejectedCount = 0;
        const rawRejectedFiles: string[] = [];

        for (const file of files) {
            // Track saved original filename for cleanup on DB insert failure
            let savedOriginalFilename: string | null = null;
            try {
                const originalFilename = userFilenames.get(file) ?? getSafeUserFilename(file.name);
                if (!originalFilename) {
                    failedFiles.push(file.name);
                    continue;
                }

                // Phase 1: Save original and get metadata (fast)
                const data = await saveOriginalAndGetMetadata(file);
                savedOriginalFilename = data.filenameOriginal;

                // P3-2: Reject HDR ingest when admin setting is disabled (default)
                if (data.colorSignals?.isHdr && !uploadConfig.allowHdrIngest) {
                    await deleteOriginalUploadFile(savedOriginalFilename);
                    savedOriginalFilename = null;
                    failedFiles.push(file.name);
                    hdrRejectedCount++;
                    continue;
                }

                // P3-14: warn when HDR is accepted
                if (data.colorSignals?.isHdr && uploadConfig.allowHdrIngest) {
                    hdrWarningCount++;
                }

                // P3-24: warn when wide-gamut source exceeds the configured
                // downscale cap. AGG-M1 (run-6 cycle-2): use the admin-tunable
                // uploadConfig.wideGamutMaxSourcePixels (already fetched above)
                // rather than the hardcoded 50 M literal, so the upload warning
                // matches the encoder's actual downscale threshold whenever an
                // admin tunes wide_gamut_max_source_pixels away from the default.
                const isWideGamutSource = isWideGamutPrimary(data.colorSignals?.colorPrimaries);
                if (isWideGamutSource && data.width * data.height > uploadConfig.wideGamutMaxSourcePixels) {
                    wideGamutDownscaleWarningCount++;
                }

                // Extract EXIF
                const exifDb = extractExifForDb(data.exifData);

                // Strip GPS coordinates using the upload-start config snapshot.
                if (uploadConfig.stripGpsOnUpload) {
                    exifDb.latitude = null;
                    exifDb.longitude = null;
                    // PP-BUG-3: also strip GPS EXIF from the on-disk original so
                    // the retained original doesn't leak protected locations.
                    const gpsStripped = await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
                    if (!gpsStripped) {
                        await deleteOriginalUploadFile(savedOriginalFilename);
                        savedOriginalFilename = null;
                        failedFiles.push(file.name);
                        gpsStripFailureCount++;
                        continue;
                    }
                }

                if (await cleanupOriginalIfRestoreMaintenanceBegan(savedOriginalFilename, deleteOriginalUploadFile)) {
                    savedOriginalFilename = null;
                    failedFiles.push(file.name);
                    continue;
                }

                const lateMaintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
                if (lateMaintenanceError) {
                    await deleteOriginalUploadFile(savedOriginalFilename);
                    savedOriginalFilename = null;
                    failedFiles.push(file.name);
                    continue;
                }

                // Phase 2: Insert into DB immediately so it shows up in UI
                const insertValues = {
                    filename_original: data.filenameOriginal,
                    filename_webp: data.filenameWebp,
                    filename_avif: data.filenameAvif,
                    filename_jpeg: data.filenameJpeg,
                    width: data.width,
                    height: data.height,
                    original_width: data.originalWidth,
                    original_height: data.originalHeight,
                    topic,
                    title: null, // Title is null by default, showing tags or user_filename
                    description: '',
                    user_filename: originalFilename,
                    // AGG2-L03 / SR2-LOW-01: defense-in-depth write barrier.
                    // The single producer is `process-image.ts`, but cap the
                    // value at 4 KB and assert the `data:image/{jpeg,png,webp}`
                    // shape so a future regression cannot land an oversized or
                    // off-MIME blob in the column.
                    blur_data_url: assertBlurDataUrl(data.blurDataUrl),
                    processed: false,
                    ...exifDb,
                    icc_profile_name: data.iccProfileName,
                    bit_depth: data.bitDepth,
                    color_pipeline_decision: data.colorPipelineDecision,
                    color_primaries: data.colorSignals?.colorPrimaries ?? null,
                    transfer_function: data.colorSignals?.transferFunction ?? null,
                    matrix_coefficients: data.colorSignals?.matrixCoefficients ?? null,
                    is_hdr: data.colorSignals?.isHdr ?? false,
                    has_gain_map: data.colorSignals?.hasGainMap ?? false,
                    pipeline_version: IMAGE_PIPELINE_VERSION,
                    // R17-L2: record the admin who performed this upload for
                    // admin/audit linkage. Admin-only PII on read; public
                    // Atom currently uses the configured feed-level author.
                    // Per-entry public attribution requires a separate safe
                    // display-name column, not raw admin usernames/ids.
                    uploaded_by: currentUser.id,
                    // C22-AGG-02: .slice(0, 10) is safe on UTF-16 code units because
                    // getSafeExtension() in process-image.ts guarantees ASCII-only
                    // output ([a-z0-9.]), so .length == countCodePoints and slice
                    // cannot split a surrogate pair. Truncation matches varchar(10).
                    original_format: (data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null,
                    // C14-LOW-01: `mode: 'number'` is safe because UPLOAD_MAX_FILE_BYTES
                    // (200 MB) is well within Number.MAX_SAFE_INTEGER (~9 PB). The schema
                    // column uses `bigint('original_file_size', { mode: 'number' })` so
                    // Drizzle returns a JS number. If the per-file cap is ever raised
                    // above ~9 PB, this would silently lose precision.
                    original_file_size: file.size,
                    processing_settings_json: serializeProcessingSettingsSnapshot(processingSettingsSnapshot),
                };

                const [result] = await db.insert(images).values(insertValues);
                // C20-MED-01: use safeInsertId to prevent silent BigInt precision loss
                const insertedId = safeInsertId(result.insertId);
                if (insertedId <= 0) {
                    console.error(`Invalid insertId for file: ${file.name}`);
                    // Clean up saved original file — no DB record references it
                    await deleteOriginalUploadFile(savedOriginalFilename);
                    failedFiles.push(file.name);
                    savedOriginalFilename = null; // Already cleaned up
                    continue;
                }
                const insertedImage = { id: insertedId, ...insertValues };

                {
                    // Phase 3: Process Tags (batched)
                    if (tagNames.length > 0) {
                        try {
                            if (resolvedTagRecords.length > 0) {
                                // Single batch insert for this image using the
                                // tag records resolved once for the whole upload.
                                await db.insert(imageTags).ignore().values(
                                    resolvedTagRecords.map(tagRecord => ({
                                        imageId: insertedImage.id,
                                        tagId: tagRecord.id,
                                    }))
                                );
                            }
                            if (skippedTagNames.length > 0 || tagResolutionFailed) {
                                warnings.push(t('tagPersistenceWarning', { file: file.name }));
                            }
                        } catch (err) {
                            console.error('Failed to process tags for image', insertedImage.id, err);
                            warnings.push(t('tagPersistenceWarning', { file: file.name }));
                        }
                    }

                    // Phase 4: Queue heavy processing (Fire and Forget)
                    enqueueImageProcessing({
                        id: insertedImage.id,
                        filenameOriginal: data.filenameOriginal,
                        filenameWebp: data.filenameWebp,
                        filenameAvif: data.filenameAvif,
                        filenameJpeg: data.filenameJpeg,
                        width: data.width,
                        topic,
                        quality: processingSettingsSnapshot.quality,
                        imageSizes: processingSettingsSnapshot.imageSizes,
                        // CR-R9C6-01: carry the remaining 6 admin processing
                        // settings on the job (upload-time snapshot) so a fresh
                        // upload honors them. Without these, the queue handler's
                        // config-load gate never enters (it only enters when
                        // BOTH quality and imageSizes are absent, which never
                        // happens on upload), so these settings were silently
                        // ignored on every upload until a backfill re-encode.
                        forceSrgbDerivatives: processingSettingsSnapshot.forceSrgbDerivatives,
                        wideGamutJpegChroma: processingSettingsSnapshot.wideGamutJpegChroma,
                        avifEffort: processingSettingsSnapshot.avifEffort,
                        sdrJpegChroma: processingSettingsSnapshot.sdrJpegChroma,
                        wideGamutMaxSourcePixels: processingSettingsSnapshot.wideGamutMaxSourcePixels,
                        autoAltTextEnabled: processingSettingsSnapshot.autoAltTextEnabled,
                        // Historical snapshot field retained for pending-row
                        // compatibility. The queue worker resolves the current
                        // runtime semantic mode before embedding writes.
                        semanticSearchMode: processingSettingsSnapshot.semanticSearchMode,
                        camera_model: exifDb.camera_model,
                        capture_date: exifDb.capture_date,
                        iccProfileName: data.iccProfileName,
                        colorSignals: data.colorSignals,
                    });

                    successCount++;
                    uploadedBytes += file.size;
                }
            } catch (e) {
                // Log full error server-side; only return filename to client (no internal details)
                console.error(`Failed to process file ${file.name}:`, e);
                // Clean up saved original file if it was written but DB insert failed.
                // R18C18 MINOR-1 (cross-ref the quota-claim invariant at the SELECT
                // settle above, :264-265): this `await` sits AFTER the synchronous
                // claim but is the ONLY post-claim await not paired with a settle.
                // It is safe ONLY because `deleteOriginalUploadFile` NEVER rejects —
                // both `fs.unlink` calls swallow errors via `.catch(() => {})`
                // (upload-paths.ts). If that contract ever changes to propagate
                // errors, this throw would escape the per-file catch to the outer
                // finally-only try and leak the claim (the DBG-17-1 class). Keep
                // `deleteOriginalUploadFile` non-throwing, or add a settle here.
                if (savedOriginalFilename) {
                    await deleteOriginalUploadFile(savedOriginalFilename);
                }
                if (e instanceof RawFileError) {
                    // R12-H1 / R10-L4: surface RAW rejections in a separate
                    // bucket so the admin UI can show an actionable "export
                    // your RAW to JPEG/TIFF/AVIF first" message rather than
                    // letting the file silently land in the generic failed list.
                    rawRejectedCount++;
                    rawRejectedFiles.push(file.name);
                } else {
                    failedFiles.push(file.name);
                }
            }
        }

        // Note: HDR rejections still push into `failedFiles` (legacy behavior
        // preserved so existing tests + downstream UI keep working). RAW
        // rejections (R12-H1) are tracked separately in rawRejectedCount /
        // rawRejectedFiles so they can surface their own specific message.
        const totalFailures = failedFiles.length + rawRejectedCount;
        if (totalFailures > 0 && successCount === 0) {
            settleClaim(successCount, uploadedBytes);
            // P3-2: return specific error when ALL failures are HDR-ingest
            // rejections and there are no other failure categories.
            if (hdrRejectedCount > 0 && failedFiles.length === hdrRejectedCount && rawRejectedCount === 0) {
                return { error: t('hdrNotSupported') };
            }
            if (gpsStripFailureCount > 0 && failedFiles.length === gpsStripFailureCount && rawRejectedCount === 0) {
                return { error: t('gpsStripFailed') };
            }
            // R12-H1: RAW-only rejection — photographers who batch-drop a
            // folder mixing exports and RAWs need the specific remediation
            // hint instead of the generic "all uploads failed."
            if (rawRejectedCount > 0 && failedFiles.length === 0) {
                return { error: t('rawNotSupported') };
            }
            return { error: t('allUploadsFailed') };
        }

        // R12-H1: when SOME succeeded but RAWs were rejected, emit a warning
        // alongside the success result so the admin UI can show a banner.
        if (rawRejectedCount > 0) {
            warnings.push(t('rawRejectedWarning', { count: rawRejectedCount }));
        }

        // Reconcile the pre-claimed quota with the uploads that actually finished.
        settleClaim(successCount, uploadedBytes);

        // Audit log for upload action
        logAuditEvent(currentUser.id, 'image_upload', 'image', undefined, undefined, {
            count: successCount,
            failed: totalFailures,
            rawRejected: rawRejectedCount,
            topic,
            tags: tagNames.join(','),
        }).catch(console.debug);

        // Revalidate so newly uploaded (unprocessed) images appear in admin dashboard
        revalidateLocalizedPaths('/', '/admin/dashboard', `/${topic}`);

        return {
            success: true,
            count: successCount,
            failed: failedFiles,
            warnings,
            hdrWarningCount,
            wideGamutDownscaleWarningCount,
            // R12-H1 / R10-L4: surface RAW rejections separately so the UI
            // can group them under a single "RAW not supported" warning
            // rather than mixing with disk/decode failures.
            rawRejectedCount,
            rawRejectedFiles,
        };
    } finally {
        await uploadContractLock.release();
    }
}

export async function deleteImage(id: number) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidImageId') };
    }

    // Get image to find filenames — select only needed columns
    const [image] = await db.select({
        id: images.id,
        topic: images.topic,
        filename_original: images.filename_original,
        filename_webp: images.filename_webp,
        filename_avif: images.filename_avif,
        filename_jpeg: images.filename_jpeg,
        share_key: images.share_key,
    }).from(images).where(eq(images.id, id));
    if (!image) return { error: t('imageNotFound') };

    // Validate filenames before attempting to delete (security check)
    if (
        !isValidFilename(image.filename_original)
        || !isValidFilename(image.filename_webp)
        || !isValidFilename(image.filename_avif)
        || !isValidFilename(image.filename_jpeg)
    ) {
         return { error: t('invalidFilename') };
    }

    const imageTopic = image.topic;
    const affectedGroupKeys = await getSharedGroupKeysForImages([id]);
    const shareRevalidationPaths = getShareRevalidationPaths([image.share_key], affectedGroupKeys);

    const currentUser = await getCurrentUser();

    // US-001: Remove from processing queue so the queue detects deletion
    // C2-HIGH-01: also remove from permanentlyFailedIds so stale IDs don't
    // exclude future images with the same auto-increment ID after a DB restore.
    const queueState = getProcessingQueueState();
    queueState.enqueued.delete(id);
    queueState.permanentlyFailedIds.delete(id);
    // C10-LOW-03: clean retry maps for deleted IDs so stale entries
    // don't accumulate until pruneRetryMaps evicts them at capacity.
    // Consistent with permanentlyFailedIds cleanup (C7-MED-05).
    queueState.retryCounts.delete(id);
    queueState.claimRetryCounts.delete(id);

    // US-008: Delete DB records in a transaction for consistency
    let deletedRows = 0;
    await db.transaction(async (tx) => {
        await tx.delete(imageTags).where(eq(imageTags.imageId, id));
        const [delResult] = await tx.delete(images).where(eq(images.id, id));
        deletedRows = delResult.affectedRows;
    });

    if (deletedRows === 0) {
        return { error: t('imageNotFound') };
    }

    // Log audit event only when the image was actually deleted — avoids duplicate
    // entries when concurrent deletion causes the transaction to delete 0 rows.
    logAuditEvent(currentUser?.id ?? null, 'image_delete', 'image', String(id), undefined, {}).catch(console.debug);

    // Delete files best-effort, all in parallel. Use prefix scanning for
    // derivatives so variants generated under older image-size settings are
    // removed too, not only variants from the current config.
    const cleanupFailures = await collectImageCleanupFailures([
        { target: 'original', filename: image.filename_original, operation: () => deleteOriginalUploadFileStrict(image.filename_original) },
        // Pass empty sizes [] to trigger directory scan and remove ALL
        // size variants, including those from prior image-size configs.
        { target: 'webp', filename: image.filename_webp, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_WEBP, image.filename_webp, []) },
        { target: 'avif', filename: image.filename_avif, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_AVIF, image.filename_avif, []) },
        { target: 'jpeg', filename: image.filename_jpeg, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_JPEG, image.filename_jpeg, []) },
    ]);

    if (cleanupFailures.length > 0) {
        console.error('Image file cleanup incomplete after deleteImage', {
            imageId: id,
            cleanupFailures,
        });
    }

    revalidateLocalizedPaths('/', `/p/${id}`, `/${imageTopic}`, '/admin/dashboard', ...shareRevalidationPaths);

    return { success: true, cleanupFailureCount: cleanupFailures.length };
}

export async function deleteImages(ids: number[]) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }

    if (!Array.isArray(ids) || ids.length === 0) {
        return { error: t('noImagesSelected') };
    }

    // Limit batch size to prevent DoS
    if (ids.length > 100) {
        return { error: t('tooManyImages') };
    }

    // Validate all IDs upfront
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: t('invalidImageId') };
        }
    }
    // Fetch all images in one query — select only needed columns
    const imageRecords = await db.select({
        id: images.id,
        topic: images.topic,
        filename_original: images.filename_original,
        filename_webp: images.filename_webp,
        filename_avif: images.filename_avif,
        filename_jpeg: images.filename_jpeg,
        share_key: images.share_key,
    }).from(images).where(inArray(images.id, ids));

    // Validate all filenames before deleting anything
    for (const image of imageRecords) {
        if (
            !isValidFilename(image.filename_original)
            || !isValidFilename(image.filename_webp)
            || !isValidFilename(image.filename_avif)
            || !isValidFilename(image.filename_jpeg)
        ) {
            return { error: t('invalidFilename') };
        }
    }

    const foundIdSet = new Set(imageRecords.map(img => img.id));
    const foundIds = [...foundIdSet];
    const notFoundCount = ids.filter(id => !foundIdSet.has(id)).length;
    const affectedGroupKeys = await getSharedGroupKeysForImages(foundIds);
    const shareRevalidationPaths = getShareRevalidationPaths(
        imageRecords.map((image) => image.share_key),
        affectedGroupKeys,
    );

    // Remove from processing queue so queue detects deletion (matches deleteImage behavior)
    // C2-HIGH-01: also remove from permanentlyFailedIds so stale IDs don't
    // exclude future images with the same auto-increment ID after a DB restore.
    const queueState = getProcessingQueueState();
    for (const id of foundIds) {
        queueState.enqueued.delete(id);
        queueState.permanentlyFailedIds.delete(id);
        // C10-LOW-03: clean retry maps for deleted IDs (matches deleteImage).
        queueState.retryCounts.delete(id);
        queueState.claimRetryCounts.delete(id);
    }

    // Delete DB records in a transaction (imageTags cascade via FK, but explicit for safety)
    let deletedRows = 0;
    if (foundIds.length > 0) {
        await db.transaction(async (tx) => {
            await tx.delete(imageTags).where(inArray(imageTags.imageId, foundIds));
            const [deleteResult] = await tx.delete(images).where(inArray(images.id, foundIds));
            deletedRows = deleteResult.affectedRows;
        });
    }

    const staleCount = Math.max(foundIds.length - deletedRows, 0);
    const currentUser = await getCurrentUser();
    if (deletedRows > 0) {
        logAuditEvent(currentUser?.id ?? null, 'images_batch_delete', 'image', 'batch-delete', undefined, {
            requestedIds: ids,
            foundIds,
            requestedCount: ids.length,
            deletedCount: deletedRows,
            staleCount,
            notFoundCount,
        }).catch(console.debug);
    }

    // Clean up image records with bounded concurrency. Each derivative cleanup
    // may scan a whole upload directory to remove historical size variants, so
    // launching every selected image concurrently can fan out into hundreds of
    // directory scans. Process a small chunk of images at a time (concurrency 5)
    // so filesystem I/O pressure stays bounded while wall-clock time is
    // significantly reduced compared to the prior fully-sequential for-of loop.
    // C2-AGG-02 / plan-257. C6-AGG6R-05: env-configurable via
    // IMAGE_CLEANUP_CONCURRENCY (default 5) so NAS-backed deployments
    // with higher I/O latency can tune this without code changes.
    const CLEANUP_CONCURRENCY = parseBoundedPositiveInteger(
        process.env.IMAGE_CLEANUP_CONCURRENCY,
        { fallback: 5, max: 32 },
    );
    const cleanupFailures: ImageCleanupFailure[] = [];
    for (let i = 0; i < imageRecords.length; i += CLEANUP_CONCURRENCY) {
        const chunk = imageRecords.slice(i, i + CLEANUP_CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map(async (image) => {
            // Pass empty sizes [] to scan directory and remove ALL size variants,
            // including those from prior image-size configs.
            const failures = await collectImageCleanupFailures([
                { target: 'original', filename: image.filename_original, operation: () => deleteOriginalUploadFileStrict(image.filename_original) },
                { target: 'webp', filename: image.filename_webp, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_WEBP, image.filename_webp, []) },
                { target: 'avif', filename: image.filename_avif, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_AVIF, image.filename_avif, []) },
                { target: 'jpeg', filename: image.filename_jpeg, operation: () => deleteImageVariantsStrict(UPLOAD_DIR_JPEG, image.filename_jpeg, []) },
            ]);

            if (failures.length > 0) {
                console.error('Image file cleanup incomplete after deleteImages', {
                    imageId: image.id,
                    cleanupFailures: failures,
                });
            }

            return failures;
        }));
        for (const failures of chunkResults) {
            cleanupFailures.push(...failures);
        }
    }

    const successCount = deletedRows;
    const errorCount = notFoundCount + staleCount;

    const affectedTopics = new Set(imageRecords.map(r => r.topic));

    // For large batches, use layout-level revalidation to avoid ISR cache thrash
    // from hundreds of individual revalidatePath calls. C6R-RPL-05 / AGG6R-10:
    // revalidateAllAppData already invalidates every page including the admin
    // dashboard, so the follow-up revalidateLocalizedPaths('/admin/dashboard')
    // was redundant. Dropping the redundant call removes a pointless ISR tag
    // invalidation without changing visible behavior.
    if (foundIds.length > 20) {
        revalidateAllAppData();
    } else {
        revalidateLocalizedPaths(
            '/',
            '/admin/dashboard',
            ...foundIds.map(id => `/p/${id}`),
            ...[...affectedTopics].map(topic => `/${topic}`),
            ...shareRevalidationPaths,
        );
    }
    return { success: true, count: successCount, errors: errorCount, cleanupFailureCount: cleanupFailures.length };
}

export async function updateImageMetadata(id: number, title: string | null, description: string | null) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }

    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidImageId') };
    }

    // C7-AGG7R-03: sanitizeAdminString checks Unicode formatting BEFORE
    // stripping (stripControlChars now removes bidi/zero-width chars, so
    // calling containsUnicodeFormatting after it would always pass).
    // Combines C5L-SEC-01 formatting rejection + C0/C1 strip in one call.
    // Null preservation is image-specific (DB columns are nullable).
    const { value: sanitizedTitle, rejected: titleRejected } = sanitizeAdminString(title);
    const { value: sanitizedDescription, rejected: descRejected } = sanitizeAdminString(description);
    if (titleRejected) return { error: t('invalidTitle') };
    if (descRejected) return { error: t('invalidDescription') };

    // C7-AGG7R-02: use countCodePoints for length validation so
    // supplementary characters (emoji, rare CJK) are counted as one
    // character each, matching MySQL varchar semantics. JS `.length`
    // counts UTF-16 code units (2 per surrogate pair), causing false
    // rejections for emoji-heavy titles that fit in varchar(255).
    if (sanitizedTitle && countCodePoints(sanitizedTitle) > 255) {
        return { error: t('titleTooLong') };
    }

    if (sanitizedDescription && countCodePoints(sanitizedDescription) > 5000) {
        return { error: t('descriptionTooLong') };
    }

    try {
        const [existingImage] = await db.select({ topic: images.topic, share_key: images.share_key })
            .from(images).where(eq(images.id, id));

        if (!existingImage) {
            return { error: t('imageNotFound') };
        }

        // C20-AGG-01: updated_at omitted from .set() — the schema's
        // onUpdateNow() annotation auto-updates on every row mutation.
        const [updateResult] = await db.update(images)
            .set({
                title: sanitizedTitle,
                description: sanitizedDescription,
            })
            .where(eq(images.id, id));
        if (updateResult.affectedRows === 0) {
            return { error: t('imageNotFound') };
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'image_update', 'image', String(id)).catch(console.debug);

        const affectedGroupKeys = await getSharedGroupKeysForImages([id]);
        const shareRevalidationPaths = getShareRevalidationPaths([existingImage.share_key], affectedGroupKeys);
        const topicPath = existingImage.topic ? `/${existingImage.topic}` : undefined;
        revalidateLocalizedPaths(`/p/${id}`, '/admin/dashboard', '/', ...(topicPath ? [topicPath] : []), ...shareRevalidationPaths);
        // C1R-04: return the sanitized/normalized values so the admin UI can
        // rehydrate local state from what was actually persisted instead of
        // the pre-submit raw input. Without this, trailing whitespace or
        // control characters briefly linger in the UI until the next refresh.
        return { success: true as const, title: sanitizedTitle, description: sanitizedDescription };
    } catch (e) {
        console.error("Failed to update image metadata", e);
        return { error: t('failedToUpdateImage') };
    }
}

export async function bulkUpdateImages(input: BulkUpdateImagesInput) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    // US-P41: requireSameOriginAdmin first, then isAdmin (matches existing action pattern).
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    const { ids, topic, titlePrefix, description, addTagNames, removeTagNames, applyAltSuggested } = input;

    if (!Array.isArray(ids) || ids.length === 0) {
        return { error: t('noImagesSelected') };
    }
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: t('invalidImageId') };
        }
    }
    const requestedIds = [...new Set(ids)];
    if (requestedIds.length > 100) {
        return { error: t('tooManyImages') };
    }
    if (!Array.isArray(addTagNames) || !Array.isArray(removeTagNames)) {
        return { error: t('invalidInput') };
    }
    if (!addTagNames.every(v => typeof v === 'string') || !removeTagNames.every(v => typeof v === 'string')) {
        return { error: t('invalidInput') };
    }
    if (addTagNames.length > 100 || removeTagNames.length > 100) {
        return { error: t('tooManyTags') };
    }
    const normalizedAddTagNames = addTagNames.map(normalizeBulkTagName);
    const normalizedRemoveTagNames = removeTagNames.map(normalizeBulkTagName);
    if (normalizedAddTagNames.some((tag) => tag === null) || normalizedRemoveTagNames.some((tag) => tag === null)) {
        return { error: t('invalidTagName') };
    }

    // COR-R5C1-01 (plan-315 item 1, pulled forward this cycle): validate each
    // TriState field's SHAPE before reading `.mode`. The fields below are read
    // as `topic.mode`/`titlePrefix.mode`/… — a malformed Server-Action payload
    // (field missing, not an object, or `mode='set'` without a string `value`)
    // would otherwise throw an unhandled TypeError and surface as a framework
    // 500 instead of a clean localized error. isTriState narrows mode to the
    // valid enum and, for 'set', requires a string value.
    const isTriState = (v: unknown): v is TriState<string> => {
        if (typeof v !== 'object' || v === null) return false;
        const mode = (v as { mode?: unknown }).mode;
        if (mode === 'leave' || mode === 'clear') return true;
        if (mode === 'set') return typeof (v as { value?: unknown }).value === 'string';
        return false;
    };
    if (!isTriState(topic) || !isTriState(titlePrefix) || !isTriState(description)) {
        return { error: t('invalidInput') };
    }

    // Validate topic field — verify slug format and existence before any writes.
    if (topic.mode === 'set') {
        if (!isValidSlug(topic.value)) return { error: t('invalidTopicFormat') };
        const [topicRow] = await db.select({ slug: topics.slug })
            .from(topics).where(eq(topics.slug, topic.value)).limit(1);
        if (!topicRow) return { error: t('topicNotFound') };
    }

    // Validate and sanitize titlePrefix field (reuses updateImageMetadata validation).
    let sanitizedTitlePrefix: string | null = null;
    if (titlePrefix.mode === 'set') {
        const { value: sv, rejected: rej } = sanitizeAdminString(titlePrefix.value);
        if (rej) return { error: t('invalidTitle') };
        if (sv && countCodePoints(sv) > 255) return { error: t('titleTooLong') };
        sanitizedTitlePrefix = sv;
    }

    // Validate and sanitize description field.
    let sanitizedDescription: string | null = null;
    if (description.mode === 'set') {
        const { value: sv, rejected: rej } = sanitizeAdminString(description.value);
        if (rej) return { error: t('invalidDescription') };
        if (sv && countCodePoints(sv) > 5000) return { error: t('descriptionTooLong') };
        sanitizedDescription = sv;
    }

    // Validate applyAltSuggested — only 'title' | 'description' | null allowed.
    if (applyAltSuggested !== undefined && applyAltSuggested !== null
        && applyAltSuggested !== 'title' && applyAltSuggested !== 'description') {
        return { error: t('invalidInput') };
    }

    try {
        const existingIds = await db.transaction(async (tx) => {
            const existingRows = await tx.select({ id: images.id })
                .from(images)
                .where(inArray(images.id, requestedIds))
                .limit(requestedIds.length);
            const existingImageIds = existingRows.map((row) => row.id);
            if (existingImageIds.length === 0) {
                return existingImageIds;
            }

            // Build scalar SET clause — only include fields not in 'leave' mode so
            // the UPDATE is minimal and untouched fields are never overwritten.
            const setClause: Record<string, string | null> = {};
            if (topic.mode === 'set') setClause['topic'] = topic.value;
            if (titlePrefix.mode === 'set') setClause['title'] = sanitizedTitlePrefix;
            if (titlePrefix.mode === 'clear') setClause['title'] = null;
            if (description.mode === 'set') setClause['description'] = sanitizedDescription;
            if (description.mode === 'clear') setClause['description'] = null;

            if (Object.keys(setClause).length > 0) {
                await tx.update(images).set(setClause).where(inArray(images.id, existingImageIds));
            }
            let tagMutationRows = 0;

            // US-P52: Apply suggested alt text → title or description.
            // Copies alt_text_suggested into the chosen field ONLY when the
            // image has no admin-set value for that field (never auto-overwrite).
            if (applyAltSuggested === 'title' || applyAltSuggested === 'description') {
                const rows = await tx.select({
                    id: images.id,
                    title: images.title,
                    description: images.description,
                    alt_text_suggested: images.alt_text_suggested,
                }).from(images).where(inArray(images.id, existingImageIds));

                // Build a map of id → suggested caption for rows that qualify.
                // Rows with an existing admin-set value for the target field are skipped
                // (never auto-overwrite). Per-row updates avoid a bulk SET that would
                // overwrite different suggested values with a single expression.
                const toUpdate: { id: number; caption: string }[] = [];
                for (const row of rows) {
                    if (!row.alt_text_suggested) continue;
                    // TRC-R5C3-04: only skip when the target field is genuinely
                    // present (non-null AND non-empty). The bare-truthiness guard
                    // also skipped on a stored empty string, which is the same as
                    // "absent" here — make the intent explicit rather than relying
                    // on '' being falsy.
                    if (applyAltSuggested === 'title' && row.title != null && row.title !== '') continue;
                    if (applyAltSuggested === 'description' && row.description != null && row.description !== '') continue;
                    // CRT-R5C2-02: strip the [AUTO] stub prefix before copying into
                    // title/description so the prefix never persists in stored metadata.
                    // C33-P1: apply the same persistent admin metadata contract as
                    // manual title/description updates. Suggestions are machine- or
                    // import-derived TEXT values; skip invalid rows instead of letting
                    // one stale caption fail the whole bulk operation.
                    const stripped = stripStubPrefix(row.alt_text_suggested).trim();
                    if (!stripped) continue;
                    const { value: sanitizedCaption, rejected } = sanitizeAdminString(stripped);
                    if (rejected || !sanitizedCaption) continue;
                    if (applyAltSuggested === 'title' && countCodePoints(sanitizedCaption) > 255) continue;
                    if (applyAltSuggested === 'description' && countCodePoints(sanitizedCaption) > 5000) continue;
                    toUpdate.push({ id: row.id, caption: sanitizedCaption });
                }

                for (const { id, caption } of toUpdate) {
                    if (applyAltSuggested === 'title') {
                        await tx.update(images)
                            .set({ title: caption })
                            .where(eq(images.id, id));
                    } else {
                        await tx.update(images)
                            .set({ description: caption })
                            .where(eq(images.id, id));
                    }
                }
            }

            // Tag additions: ensure tag record exists, then batch-insert imageTags
            // rows for all selected images.
            for (const tag of normalizedAddTagNames) {
                if (!tag) continue;
                const resolved = await ensureTagRecord(tx, tag.name, tag.slug);
                if (resolved.kind !== 'found') continue;
                const [insertResult] = await tx.insert(imageTags).ignore().values(
                    existingImageIds.map(imageId => ({ imageId, tagId: resolved.tag.id }))
                );
                tagMutationRows += Number(insertResult.affectedRows ?? 0);
            }

            // Tag removals: look up tag by exact name (then slug fallback), then
            // delete only rows matching both the imageId batch AND the specific tagId
            // to avoid removing unrelated tags.
            for (const tag of normalizedRemoveTagNames) {
                if (!tag) continue;
                const resolved = await findTagRecordByNameOrSlug(tx, tag.name, tag.slug);
                if (resolved.kind !== 'found') continue;
                const [deleteResult] = await tx.delete(imageTags).where(
                    and(inArray(imageTags.imageId, existingImageIds), eq(imageTags.tagId, resolved.tag.id))
                );
                tagMutationRows += Number(deleteResult.affectedRows ?? 0);
            }
            if (tagMutationRows > 0) {
                await tx.update(images)
                    .set({ updated_at: sql`CURRENT_TIMESTAMP` })
                    .where(inArray(images.id, existingImageIds));
            }
            return existingImageIds;
        });

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'images_bulk_update', 'image', 'bulk', undefined, {
            ids: existingIds,
            requestedIds,
            topicMode: topic.mode,
            titlePrefixMode: titlePrefix.mode,
            descriptionMode: description.mode,
            addTagNames,
            removeTagNames,
            applyAltSuggested: applyAltSuggested ?? null,
        }).catch(console.debug);

        // Revalidate broadly — many images and potentially multiple topics may be affected.
        revalidateAllAppData();

        return { success: true as const, count: existingIds.length };
    } catch (e) {
        console.error('bulkUpdateImages transaction failed:', e);
        return { error: t('failedToUpdateImage') };
    }
}

// R10-H2: retry a permanently-failed image from the admin dashboard.
export async function retryFailedImage(id: number) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) {
        return { error: maintenanceError };
    }
    // TRC-R5C1-18: requireSameOriginAdmin first, then isAdmin (matches file-standard pattern, e.g. bulkUpdateImages :871).
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Number.isInteger(id) || id <= 0) {
        // AGG-R8c3-16(b): localized to match every sibling (deleteImage etc.);
        // was a lone hardcoded English string.
        return { error: t('invalidImageId') };
    }

    const failedStatePredicate = and(eq(images.id, id), eq(images.processed, false), isNotNull(images.processing_error));

    // Fetch the image row (admin-only fields needed for re-enqueue)
    const [image] = await db.select({
        id: images.id,
        filename_original: images.filename_original,
        filename_webp: images.filename_webp,
        filename_avif: images.filename_avif,
        filename_jpeg: images.filename_jpeg,
        width: images.width,
        topic: images.topic,
        icc_profile_name: images.icc_profile_name,
        color_primaries: images.color_primaries,
        transfer_function: images.transfer_function,
        matrix_coefficients: images.matrix_coefficients,
        is_hdr: images.is_hdr,
        has_gain_map: images.has_gain_map,
        camera_model: images.camera_model,
        capture_date: images.capture_date,
        processing_error: images.processing_error,
    })
        .from(images)
        .where(failedStatePredicate)
        .limit(1);

    if (!image) {
        return { error: t('imageNotInFailedState') };
    }

    let retryConfig: GalleryConfig;
    try {
        retryConfig = await getGalleryConfigStrict();
    } catch (err) {
        console.error('Failed to read retry processing settings', err);
        return { error: t('failedToFetchGallerySettings') };
    }
    const processingSettingsSnapshot = createProcessingSettingsSnapshot(retryConfig);
    const serializedSnapshot = serializeProcessingSettingsSnapshot(processingSettingsSnapshot);

    // Clear the failure columns only after a fresh strict snapshot is ready.
    const clearResult = await db.update(images)
        .set({ processing_error: null, failed_at: null, processing_settings_json: serializedSnapshot })
        .where(failedStatePredicate);
    const clearHeader = (Array.isArray(clearResult) ? clearResult[0] : clearResult) as { affectedRows?: number | bigint | string };
    const affectedRows = Number(clearHeader?.affectedRows ?? 0);
    if (!Number.isFinite(affectedRows) || affectedRows <= 0) {
        return { error: t('imageNotInFailedState') };
    }

    // Remove from the in-memory permanently-failed set so the bootstrap
    // scan will discover it on the next run.
    const state = getProcessingQueueState();
    state.permanentlyFailedIds.delete(id);
    state.retryCounts.delete(id);
    state.claimRetryCounts.delete(id);
    state.lastErrors.delete(id);

    // Re-enqueue for processing. If the queue rejects the job (shutdown,
    // duplicate/ineligible state, etc.), restore a visible failed state instead
    // of reporting success while the image disappears from the failed list.
    const enqueued = enqueueImageProcessing({
        id: image.id,
        filenameOriginal: image.filename_original,
        filenameWebp: image.filename_webp,
        filenameAvif: image.filename_avif,
        filenameJpeg: image.filename_jpeg,
        width: image.width,
        topic: image.topic,
        quality: processingSettingsSnapshot.quality,
        imageSizes: processingSettingsSnapshot.imageSizes,
        forceSrgbDerivatives: processingSettingsSnapshot.forceSrgbDerivatives,
        wideGamutJpegChroma: processingSettingsSnapshot.wideGamutJpegChroma,
        avifEffort: processingSettingsSnapshot.avifEffort,
        sdrJpegChroma: processingSettingsSnapshot.sdrJpegChroma,
        wideGamutMaxSourcePixels: processingSettingsSnapshot.wideGamutMaxSourcePixels,
        autoAltTextEnabled: processingSettingsSnapshot.autoAltTextEnabled,
        semanticSearchMode: processingSettingsSnapshot.semanticSearchMode,
        iccProfileName: image.icc_profile_name,
        colorSignals: {
            colorPrimaries: image.color_primaries,
            transferFunction: image.transfer_function,
            matrixCoefficients: image.matrix_coefficients,
            isHdr: image.is_hdr,
            hasGainMap: image.has_gain_map,
        },
        camera_model: image.camera_model,
        capture_date: image.capture_date,
    });
    if (!enqueued) {
        const retryError = image.processing_error || t('failedToRetryImage');
        const restoreResult = await db.update(images)
            .set({
                processing_error: retryError,
                failed_at: toMySqlDateTime(new Date()),
                processing_settings_json: null,
            })
            .where(and(eq(images.id, id), eq(images.processed, false), isNull(images.processing_error)));
        const restoreHeader = (Array.isArray(restoreResult) ? restoreResult[0] : restoreResult) as { affectedRows?: number | bigint | string };
        const restoredRows = Number(restoreHeader?.affectedRows ?? 0);
        if (Number.isFinite(restoredRows) && restoredRows > 0) {
            state.permanentlyFailedIds.add(id);
            state.lastErrors.set(id, retryError);
        }
        return { error: t('failedToRetryImage') };
    }

    return { success: true as const };
}
