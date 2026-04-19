'use server';

import path from 'path';
import fs, { statfs } from 'fs/promises';
import { db, images, tags, imageTags } from '@/db';
import { eq, sql, inArray } from 'drizzle-orm';
import { saveOriginalAndGetMetadata, extractExifForDb, deleteImageVariants } from '@/lib/process-image';
import { UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/upload-paths';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isValidSlug, isValidFilename, isValidTagName } from '@/lib/validation';
import { enqueueImageProcessing, getProcessingQueueState } from '@/lib/image-queue';
import { logAuditEvent } from '@/lib/audit';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { MAX_TOTAL_UPLOAD_BYTES } from '@/lib/upload-limits';
import { getGalleryConfig } from '@/lib/gallery-config';
import { getClientIp } from '@/lib/rate-limit';
import { headers } from 'next/headers';

// Server-side upload tracking to enforce cumulative limits across per-file invocations.
// The client sends files individually, so per-call batch limits are ineffective.
const uploadTracker = new Map<string, { count: number; bytes: number; windowStart: number }>();
const UPLOAD_TRACKING_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const UPLOAD_MAX_FILES_PER_WINDOW = 100;
const UPLOAD_TRACKER_MAX_KEYS = 2000;

/** Prune expired upload tracker entries to prevent unbounded memory growth. */
function pruneUploadTracker() {
    const now = Date.now();
    for (const [key, entry] of uploadTracker) {
        if (now - entry.windowStart > UPLOAD_TRACKING_WINDOW_MS * 2) {
            uploadTracker.delete(key);
        }
    }
    // Hard cap: evict oldest if still over limit after expiry pruning
    if (uploadTracker.size > UPLOAD_TRACKER_MAX_KEYS) {
        const excess = uploadTracker.size - UPLOAD_TRACKER_MAX_KEYS;
        let evicted = 0;
        for (const key of uploadTracker.keys()) {
            if (evicted >= excess) break;
            uploadTracker.delete(key);
            evicted++;
        }
    }
}

export async function uploadImages(formData: FormData) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }

    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    // Topic is now a string slug
    const topic = formData.get('topic')?.toString() ?? '';
    const tagsString = formData.get('tags')?.toString() ?? '';

    if (tagsString && tagsString.length > 1000) {
        return { error: t('tagsStringTooLong') };
    }

    const tagNames = tagsString
        ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0 && isValidTagName(t))
        : [];

    if (tagsString && tagNames.length !== tagsString.split(',').map(t => t.trim()).filter(Boolean).length) {
        return { error: t('invalidTagNames') };
    }

    if (!files.length) return { error: t('noFilesProvided') };
    if (files.length > 100) return { error: t('tooManyFiles') };

    // Server-side cumulative upload tracking across per-file invocations.
    // The client sends files individually, so per-call limits are insufficient.
    const requestHeaders = await headers();
    const uploadIp = getClientIp(requestHeaders);
    const now = Date.now();
    // Prune stale entries unconditionally to prevent unbounded memory growth
    pruneUploadTracker();
    const tracker = uploadTracker.get(uploadIp) || { count: 0, bytes: 0, windowStart: now };
    if (now - tracker.windowStart > UPLOAD_TRACKING_WINDOW_MS) {
        tracker.count = 0;
        tracker.bytes = 0;
        tracker.windowStart = now;
    }
    if (tracker.count + files.length > UPLOAD_MAX_FILES_PER_WINDOW) {
        return { error: t('uploadLimitReached') };
    }

    // Disk space pre-check: require at least 1GB free before accepting uploads
    try {
        const stats = await statfs(UPLOAD_DIR_ORIGINAL);
        const freeBytes = stats.bfree * stats.bsize;
        if (freeBytes < 1024 * 1024 * 1024) {
            return { error: t('insufficientDiskSpace') };
        }
    } catch {
        // statfs may fail on some platforms; proceed anyway
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

    // Pre-increment tracker to prevent TOCTOU race: concurrent uploads from
    // the same IP could all read the same tracker state and bypass the limit.
    // We optimistically claim the bytes now and adjust after processing.
    // This is placed after all validation checks so no manual rollback is needed.
    tracker.bytes += totalSize;
    tracker.count += files.length;
    uploadTracker.set(uploadIp, tracker);

    let successCount = 0;
    let uploadedBytes = 0;
    const failedFiles: string[] = [];

    for (const file of files) {
        try {
            const originalFilename = path.basename(file.name).trim();

            // Phase 1: Save original and get metadata (fast)
            const data = await saveOriginalAndGetMetadata(file);

            // Extract EXIF
            const exifDb = extractExifForDb(data.exifData);

            // Strip GPS coordinates if the privacy setting is enabled
            try {
                const config = await getGalleryConfig();
                if (config.stripGpsOnUpload) {
                    exifDb.latitude = null;
                    exifDb.longitude = null;
                }
            } catch {
                // DB unavailable — proceed without stripping (privacy-safe default is to keep)
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
                blur_data_url: data.blurDataUrl,
                processed: false,
                ...exifDb,
                color_space: data.iccProfileName || exifDb.color_space,
                bit_depth: data.bitDepth,
                original_format: (data.filenameOriginal.split('.').pop()?.toUpperCase() || '').slice(0, 10) || null,
                original_file_size: file.size,
            };

            const [result] = await db.insert(images).values(insertValues);
            const insertedId = Number(result.insertId);
            if (!Number.isFinite(insertedId) || insertedId <= 0) {
                console.error(`Invalid insertId for file: ${file.name}`);
                failedFiles.push(file.name);
                continue;
            }
            const insertedImage = { id: insertedId, ...insertValues };

            {
                // Phase 3: Process Tags (batched)
                if (tagNames.length > 0) {
                    try {
                        const uniqueTagNames = Array.from(new Set(tagNames))
                            .map(t => t.trim()).filter(Boolean);
                        if (uniqueTagNames.length > 0) {
                            const tagEntries = uniqueTagNames.map(cleanName => ({
                                name: cleanName,
                                slug: cleanName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
                            }));
                            // Single batch insert for all tags
                            await db.insert(tags).ignore().values(tagEntries);
                            // Look up by exact name first, then fall back to slug — avoids returning
                            // the wrong tag when two different names produce the same slug (slug collision).
                            // Same pattern as addTagToImage, batchAddTags, and batchUpdateImageTags.
                            const tagRecordsByName = await db.select().from(tags).where(inArray(tags.name, uniqueTagNames));
                            const foundByName = new Set(tagRecordsByName.map(r => r.name));
                            const missingNames = uniqueTagNames.filter(n => !foundByName.has(n));
                            const missingSlugs = missingNames.map(n => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                            const tagRecordsBySlug = missingSlugs.length > 0
                                ? await db.select().from(tags).where(inArray(tags.slug, missingSlugs))
                                : [];
                            // Merge: prefer name-match records, then slug-fallback records
                            const tagRecords = [
                                ...tagRecordsByName,
                                ...tagRecordsBySlug.filter(r => !foundByName.has(r.name) && !tagRecordsByName.some(nr => nr.id === r.id)),
                            ];
                            // US-002: Warn on tag slug collisions
                            const intendedBySlug = new Map(tagEntries.map(t => [t.slug, t.name]));
                            for (const rec of tagRecords) {
                                const intended = intendedBySlug.get(rec.slug);
                                if (intended && rec.name !== intended) {
                                    console.warn(`Tag slug collision: "${intended}" collides with existing "${rec.name}" on slug "${rec.slug}"`);
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
                    } catch (err) {
                        console.error('Failed to process tags for image', insertedImage.id, err);
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
                });

                successCount++;
                uploadedBytes += file.size;
            }
        } catch (e) {
            // Log full error server-side; only return filename to client (no internal details)
            console.error(`Failed to process file ${file.name}:`, e);
            failedFiles.push(file.name);
        }
    }

    if (failedFiles.length > 0 && successCount === 0) {
        return { error: t('allUploadsFailed') };
    }

    // Update cumulative upload tracker with actual (not pre-incremented) values.
    // Use additive adjustment instead of absolute assignment to avoid overwriting
    // concurrent requests' pre-incremented contributions for the same IP.
    // Only adjust if the entry still exists in the Map — if pruneUploadTracker()
    // evicted this IP's entry during the upload loop, the entry is gone and
    // there's nothing to correct. Using the stale `tracker` fallback would
    // overwrite concurrent requests' pre-incremented contributions.
    const currentTracker = uploadTracker.get(uploadIp);
    if (currentTracker) {
        currentTracker.count += (successCount - files.length);
        currentTracker.bytes += (uploadedBytes - totalSize);
        uploadTracker.set(uploadIp, currentTracker);
    }

    // Audit log for upload action
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'image_upload', 'image', undefined, undefined, {
        count: successCount,
        failed: failedFiles.length,
        topic,
    }).catch(console.debug);

    // Revalidate so newly uploaded (unprocessed) images appear in admin dashboard
    revalidateLocalizedPaths('/', '/admin/dashboard');

    return {
        success: true,
        count: successCount,
        failed: failedFiles,
        replaced: []
    };
}

export async function deleteImage(id: number) {
    const t = await getTranslations('serverActions');
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

    const currentUser = await getCurrentUser();

    // US-001: Remove from processing queue so the queue detects deletion
    const queueState = getProcessingQueueState();
    queueState.enqueued.delete(id);

    // US-008: Delete DB records in a transaction for consistency
    await db.transaction(async (tx) => {
        await tx.delete(imageTags).where(eq(imageTags.imageId, id));
        await tx.delete(images).where(eq(images.id, id));
    });

    // Log audit event after the transaction succeeds — avoids false-positive entries
    // when concurrent deletion causes the transaction to delete 0 rows.
    logAuditEvent(currentUser?.id ?? null, 'image_delete', 'image', String(id), undefined, {}).catch(console.debug);

    // Delete files deterministically (no readdir) — best effort, all in parallel
    // Read configured sizes to ensure all variants are cleaned up
    let deleteSizes: number[] | undefined;
    try {
        const config = await getGalleryConfig();
        deleteSizes = config.imageSizes.length > 0 ? config.imageSizes : undefined;
    } catch {
        // DB unavailable — use default sizes
    }
    try {
        await Promise.all([
            fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, image.filename_original)).catch(() => {}),
            deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp, deleteSizes),
            deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif, deleteSizes),
            deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg, deleteSizes),
        ]);
    } catch {
        console.error("Error deleting files");
    }

    revalidateLocalizedPaths('/', `/p/${id}`, `/${imageTopic}`, '/admin/dashboard');

    return { success: true };
}

export async function deleteImages(ids: number[]) {
    const t = await getTranslations('serverActions');
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

    // Remove from processing queue so queue detects deletion (matches deleteImage behavior)
    const queueState = getProcessingQueueState();
    for (const id of foundIds) {
        queueState.enqueued.delete(id);
    }

    // Log audit event before the transaction — we already verified the images exist
    // and have admin context. Logging here ensures the audit is recorded even if
    // concurrent deletion causes the transaction to delete 0 rows (matches deleteImage pattern).
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'images_batch_delete', 'image', foundIds.join(','), undefined, { count: foundIds.length, requested: ids.length, notFound: notFoundCount }).catch(console.debug);

    // Delete DB records in a transaction (imageTags cascade via FK, but explicit for safety)
    if (foundIds.length > 0) {
        await db.transaction(async (tx) => {
            await tx.delete(imageTags).where(inArray(imageTags.imageId, foundIds));
            await tx.delete(images).where(inArray(images.id, foundIds));
        });
    }

    // Clean up files deterministically (no readdir) for all images concurrently
    // Read configured sizes to ensure all variants are cleaned up
    let batchDeleteSizes: number[] | undefined;
    try {
        const config = await getGalleryConfig();
        batchDeleteSizes = config.imageSizes.length > 0 ? config.imageSizes : undefined;
    } catch {
        // DB unavailable — use default sizes
    }
    await Promise.all(imageRecords.map(async (image) => {
        try {
            await Promise.all([
                fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, image.filename_original)).catch(() => {}),
                deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp, batchDeleteSizes),
                deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif, batchDeleteSizes),
                deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg, batchDeleteSizes),
            ]);
        } catch {
            console.error(`Error deleting files for image ${image.id}`);
        }
    }));

    const successCount = foundIds.length;
    const errorCount = notFoundCount;

    const affectedTopics = new Set(imageRecords.map(r => r.topic));

    // For large batches, use layout-level revalidation to avoid ISR cache thrash
    // from hundreds of individual revalidatePath calls
    if (foundIds.length > 20) {
        revalidateLocalizedPaths('/', '/admin/dashboard');
    } else {
        revalidateLocalizedPaths(
            '/',
            '/admin/dashboard',
            ...foundIds.map(id => `/p/${id}`),
            ...[...affectedTopics].map(topic => `/${topic}`)
        );
    }
    return { success: true, count: successCount, errors: errorCount };
}

/** Strip null bytes and control characters that can cause MySQL truncation or display issues. */
function stripControlChars(s: string | null): string | null {
    if (!s) return s;
    return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export async function updateImageMetadata(id: number, title: string | null, description: string | null) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) {
        return { error: t('unauthorized') };
    }

    if (!Number.isInteger(id) || id <= 0) {
        return { error: t('invalidImageId') };
    }

    if (title && title.length > 255) {
        return { error: t('titleTooLong') };
    }

    if (description && description.length > 5000) {
        return { error: t('descriptionTooLong') };
    }

    // Sanitize title and description: strip control characters after trimming
    const sanitizedTitle = stripControlChars(title ? title.trim() : null) || null;
    const sanitizedDescription = stripControlChars(description ? description.trim() : null) || null;

    try {
        const [existingImage] = await db.select({ topic: images.topic })
            .from(images).where(eq(images.id, id));

        const [result] = await db.update(images)
            .set({
                title: sanitizedTitle,
                description: sanitizedDescription,
                updated_at: sql`CURRENT_TIMESTAMP`
            })
            .where(eq(images.id, id));

        if (result.affectedRows === 0) {
            return { error: t('imageNotFound') };
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'image_update', 'image', String(id)).catch(console.debug);

        const topicPath = existingImage?.topic ? `/${existingImage.topic}` : undefined;
        revalidateLocalizedPaths(`/p/${id}`, '/admin/dashboard', '/', ...(topicPath ? [topicPath] : []));
        return { success: true };
    } catch (e) {
        console.error("Failed to update image metadata", e);
        return { error: t('failedToUpdateImage') };
    }
}
