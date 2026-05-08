'use server';

import path from 'path';
import { statfs } from 'fs/promises';
import { db, images, imageTags, sharedGroups, sharedGroupImages, topics } from '@/db';
import { eq, inArray, and } from 'drizzle-orm';
import { saveOriginalAndGetMetadata, extractExifForDb, deleteImageVariants, stripGpsFromOriginal, IMAGE_PIPELINE_VERSION } from '@/lib/process-image';
import { UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG, deleteOriginalUploadFile, ensureUploadDirectories } from '@/lib/upload-paths';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isValidSlug, isValidFilename, isValidTagName, isValidTagSlug, safeInsertId } from '@/lib/validation';
import { countCodePoints } from '@/lib/utils';
import { enqueueImageProcessing, getProcessingQueueState } from '@/lib/image-queue';
import { logAuditEvent } from '@/lib/audit';
import { revalidateAllAppData, revalidateLocalizedPaths } from '@/lib/revalidation';
import { stripControlChars, sanitizeAdminString, requireCleanInput } from '@/lib/sanitize';
import { ensureTagRecord, findTagRecordByNameOrSlug, getTagSlug } from '@/lib/tag-records';
import { MAX_TOTAL_UPLOAD_BYTES, UPLOAD_MAX_FILES_PER_WINDOW } from '@/lib/upload-limits';
import { getGalleryConfig, type GalleryConfig } from '@/lib/gallery-config';
import { getClientIp } from '@/lib/rate-limit';
import { cleanupOriginalIfRestoreMaintenanceBegan, getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { settleUploadTrackerClaim } from '@/lib/upload-tracker';
import { getUploadTracker, pruneUploadTracker, resetUploadTrackerWindowIfExpired } from '@/lib/upload-tracker-state';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { acquireUploadProcessingContractLock } from '@/lib/upload-processing-contract-lock';
import { assertBlurDataUrl } from '@/lib/blur-data-url';
import { headers } from 'next/headers';
import { LICENSE_TIERS } from '@/lib/bulk-edit-types';
import type { BulkUpdateImagesInput } from '@/lib/bulk-edit-types';

type ImageCleanupFailure = {
    target: 'original' | 'webp' | 'avif' | 'jpeg';
    filename: string;
    reason: string;
};

// C2L2-03: schema column is `varchar(255)` which is a UTF-8 byte budget on
// MySQL. Bound the byte length so high-codepoint filenames (CJK, emoji) are
// rejected at the action boundary instead of failing at INSERT time after
// disk and EXIF work has been done.
const USER_FILENAME_MAX_BYTES = 255;
const CLEANUP_RETRY_DELAY_MS = 50;

function getSafeUserFilename(filename: string): string | null {
    // C2L2-05: a single trailing `.trim()` is sufficient. `stripControlChars`
    // already removes ASCII control bytes, and the post-strip trim handles
    // any whitespace that the strip exposed.
    const sanitized = stripControlChars(path.basename(filename))?.trim() ?? '';
    if (!sanitized) return null;
    if (Buffer.byteLength(sanitized, 'utf8') > USER_FILENAME_MAX_BYTES) {
        return null;
    }
    return sanitized;
}

function wait(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const currentUser = await getCurrentUser();
    if (!currentUser) {
        return { error: t('unauthorized') };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
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
        const uploadConfig: GalleryConfig = await getGalleryConfig();
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
        if (tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW) {
            return { error: t('uploadLimitReached') };
        }

        // Disk space pre-check: require at least 1GB free before accepting uploads.
        // Ensure the upload tree exists first so fresh volumes do not map ENOENT
        // from statfs() to a misleading "insufficient disk space" error.
        try {
            await ensureUploadDirectories();
            const stats = await statfs(UPLOAD_DIR_ORIGINAL);
            const freeBytes = stats.bfree * stats.bsize;
            if (freeBytes < 1024 * 1024 * 1024) {
                return { error: t('insufficientDiskSpace') };
            }
        } catch (err) {
            console.error('Failed to inspect upload disk space', err);
            return { error: t('insufficientDiskSpace') };
        }

        // Validate total upload size (per-call limit)
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
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

        // C11-MED-01: verify the topic exists in the database before accepting
        // uploads. The schema now has an FK, but checking here keeps the error
        // localized and avoids saving files before a doomed INSERT.
        const [topicRow] = await db.select({ slug: topics.slug })
            .from(topics)
            .where(eq(topics.slug, topic))
            .limit(1);
        if (!topicRow) {
            return { error: t('topicNotFound') };
        }

        // Pre-increment tracker to prevent TOCTOU race: concurrent uploads from
        // the same IP could all read the same tracker state and bypass the limit.
        // We optimistically claim the bytes now and adjust after processing.
        // This is placed after all validation checks so no manual rollback is needed.
        tracker.bytes += totalSize;
        tracker.count += files.length;
        uploadTracker.set(uploadTrackerKey, tracker);

        let successCount = 0;
        let uploadedBytes = 0;
        const failedFiles: string[] = [];
        const warnings: string[] = [];
        let hdrRejectedCount = 0;

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

                // Extract EXIF
                const exifDb = extractExifForDb(data.exifData);

                // Strip GPS coordinates using the upload-start config snapshot.
                if (uploadConfig.stripGpsOnUpload) {
                    exifDb.latitude = null;
                    exifDb.longitude = null;
                    // PP-BUG-3: also strip GPS EXIF from the on-disk original so
                    // the paid-download endpoint doesn't leak protected locations.
                    await stripGpsFromOriginal(path.join(UPLOAD_DIR_ORIGINAL, data.filenameOriginal));
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
                    pipeline_version: IMAGE_PIPELINE_VERSION,
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
                            const uniqueTagNames = Array.from(new Set(tagNames))
                                .map(t => t.trim()).filter(Boolean);
                            const skippedTagNames: string[] = [];
                            if (uniqueTagNames.length > 0) {
                                const tagRecords = [];
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
                                        tagRecords.push(resolvedTag.tag);
                                    }
                                }
                                if (tagRecords.length > 0) {
                                    // Single batch insert for all imageTags
                                    await db.insert(imageTags).ignore().values(
                                        tagRecords.map(tagRecord => ({
                                            imageId: insertedImage.id,
                                            tagId: tagRecord.id,
                                        }))
                                    );
                                }
                            }
                            if (skippedTagNames.length > 0) {
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
                        quality: {
                            webp: uploadConfig.imageQualityWebp,
                            avif: uploadConfig.imageQualityAvif,
                            jpeg: uploadConfig.imageQualityJpeg,
                        },
                        imageSizes: uploadConfig.imageSizes.length > 0 ? uploadConfig.imageSizes : undefined,
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
                // Clean up saved original file if it was written but DB insert failed
                if (savedOriginalFilename) {
                    await deleteOriginalUploadFile(savedOriginalFilename);
                }
                failedFiles.push(file.name);
            }
        }

        if (failedFiles.length > 0 && successCount === 0) {
            settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, successCount, uploadedBytes);
            // P3-2: return specific error when HDR ingest is disallowed
            if (hdrRejectedCount > 0) {
                return { error: t('hdrNotSupported') };
            }
            return { error: t('allUploadsFailed') };
        }

        // Reconcile the pre-claimed quota with the uploads that actually finished.
        settleUploadTrackerClaim(uploadTracker, uploadTrackerKey, files.length, totalSize, successCount, uploadedBytes);

        // Audit log for upload action
        logAuditEvent(currentUser.id, 'image_upload', 'image', undefined, undefined, {
            count: successCount,
            failed: failedFiles.length,
            topic,
            tags: tagNames.join(','),
        }).catch(console.debug);

        // Revalidate so newly uploaded (unprocessed) images appear in admin dashboard
        revalidateLocalizedPaths('/', '/admin/dashboard', `/${topic}`);

        return {
            success: true,
            count: successCount,
            failed: failedFiles,
            warnings
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
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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

    // Log audit event only when the image was actually deleted — avoids duplicate
    // entries when concurrent deletion causes the transaction to delete 0 rows.
    if (deletedRows > 0) {
        logAuditEvent(currentUser?.id ?? null, 'image_delete', 'image', String(id), undefined, {}).catch(console.debug);
    }

    // Delete files best-effort, all in parallel. Use prefix scanning for
    // derivatives so variants generated under older image-size settings are
    // removed too, not only variants from the current config.
    const cleanupFailures = await collectImageCleanupFailures([
        { target: 'original', filename: image.filename_original, operation: () => deleteOriginalUploadFile(image.filename_original) },
        // Pass empty sizes [] to trigger directory scan and remove ALL
        // size variants, including those from prior image-size configs.
        { target: 'webp', filename: image.filename_webp, operation: () => deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp, []) },
        { target: 'avif', filename: image.filename_avif, operation: () => deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif, []) },
        { target: 'jpeg', filename: image.filename_jpeg, operation: () => deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg, []) },
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
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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
    const CLEANUP_CONCURRENCY = Math.max(1, Number.parseInt(process.env.IMAGE_CLEANUP_CONCURRENCY ?? '', 10) || 5);
    const cleanupFailures: ImageCleanupFailure[] = [];
    for (let i = 0; i < imageRecords.length; i += CLEANUP_CONCURRENCY) {
        const chunk = imageRecords.slice(i, i + CLEANUP_CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map(async (image) => {
            // Pass empty sizes [] to scan directory and remove ALL size variants,
            // including those from prior image-size configs.
            const failures = await collectImageCleanupFailures([
                { target: 'original', filename: image.filename_original, operation: () => deleteOriginalUploadFile(image.filename_original) },
                { target: 'webp', filename: image.filename_webp, operation: () => deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp, []) },
                { target: 'avif', filename: image.filename_avif, operation: () => deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif, []) },
                { target: 'jpeg', filename: image.filename_jpeg, operation: () => deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg, []) },
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
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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
    // US-P41: requireSameOriginAdmin first, then isAdmin (matches existing action pattern).
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    if (!(await isAdmin())) return { error: t('unauthorized') };

    const { ids, topic, titlePrefix, description, licenseTier, addTagNames, removeTagNames, applyAltSuggested } = input;

    if (!Array.isArray(ids) || ids.length === 0) {
        return { error: t('noImagesSelected') };
    }
    if (ids.length > 100) {
        return { error: t('tooManyImages') };
    }
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: t('invalidImageId') };
        }
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

    // Validate licenseTier enum value.
    if (licenseTier.mode === 'set') {
        if (!(LICENSE_TIERS as readonly string[]).includes(licenseTier.value)) {
            return { error: t('invalidInput') };
        }
    }

    // Validate applyAltSuggested — only 'title' | 'description' | null allowed.
    if (applyAltSuggested !== undefined && applyAltSuggested !== null
        && applyAltSuggested !== 'title' && applyAltSuggested !== 'description') {
        return { error: t('invalidInput') };
    }

    try {
        await db.transaction(async (tx) => {
            // Build scalar SET clause — only include fields not in 'leave' mode so
            // the UPDATE is minimal and untouched fields are never overwritten.
            const setClause: Record<string, string | null> = {};
            if (topic.mode === 'set') setClause['topic'] = topic.value;
            if (titlePrefix.mode === 'set') setClause['title'] = sanitizedTitlePrefix;
            if (titlePrefix.mode === 'clear') setClause['title'] = null;
            if (description.mode === 'set') setClause['description'] = sanitizedDescription;
            if (description.mode === 'clear') setClause['description'] = null;
            if (licenseTier.mode === 'set') setClause['license_tier'] = licenseTier.value;

            if (Object.keys(setClause).length > 0) {
                await tx.update(images).set(setClause).where(inArray(images.id, ids));
            }

            // US-P52: Apply suggested alt text → title or description.
            // Copies alt_text_suggested into the chosen field ONLY when the
            // image has no admin-set value for that field (never auto-overwrite).
            if (applyAltSuggested === 'title' || applyAltSuggested === 'description') {
                const rows = await tx.select({
                    id: images.id,
                    title: images.title,
                    description: images.description,
                    alt_text_suggested: images.alt_text_suggested,
                }).from(images).where(inArray(images.id, ids));

                // Build a map of id → suggested caption for rows that qualify.
                // Rows with an existing admin-set value for the target field are skipped
                // (never auto-overwrite). Per-row updates avoid a bulk SET that would
                // overwrite different suggested values with a single expression.
                const toUpdate: { id: number; caption: string }[] = [];
                for (const row of rows) {
                    if (!row.alt_text_suggested) continue;
                    if (applyAltSuggested === 'title' && row.title) continue;
                    if (applyAltSuggested === 'description' && row.description) continue;
                    toUpdate.push({ id: row.id, caption: row.alt_text_suggested });
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
            for (const name of addTagNames) {
                const { value: cleanName, rejected } = requireCleanInput(name);
                if (rejected || !cleanName) continue;
                if (!isValidTagName(cleanName)) continue;
                const slug = getTagSlug(cleanName);
                if (!isValidTagSlug(slug)) continue;
                const resolved = await ensureTagRecord(tx, cleanName, slug);
                if (resolved.kind !== 'found') continue;
                await tx.insert(imageTags).ignore().values(
                    ids.map(imageId => ({ imageId, tagId: resolved.tag.id }))
                );
            }

            // Tag removals: look up tag by exact name (then slug fallback), then
            // delete only rows matching both the imageId batch AND the specific tagId
            // to avoid removing unrelated tags.
            for (const name of removeTagNames) {
                const { value: cleanName, rejected } = requireCleanInput(name);
                if (rejected || !cleanName) continue;
                const resolved = await findTagRecordByNameOrSlug(tx, cleanName);
                if (resolved.kind !== 'found') continue;
                await tx.delete(imageTags).where(
                    and(inArray(imageTags.imageId, ids), eq(imageTags.tagId, resolved.tag.id))
                );
            }
        });

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'images_bulk_update', 'image', 'bulk', undefined, {
            ids,
            topicMode: topic.mode,
            titlePrefixMode: titlePrefix.mode,
            descriptionMode: description.mode,
            licenseTierMode: licenseTier.mode,
            addTagNames,
            removeTagNames,
            applyAltSuggested: applyAltSuggested ?? null,
        }).catch(console.debug);

        // Revalidate broadly — many images and potentially multiple topics may be affected.
        revalidateAllAppData();

        return { success: true as const, count: ids.length };
    } catch (e) {
        console.error('bulkUpdateImages transaction failed:', e);
        return { error: t('failedToUpdateImage') };
    }
}
