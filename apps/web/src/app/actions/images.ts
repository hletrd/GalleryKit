'use server';

import path from 'path';
import fs from 'fs/promises';
import { db, images, tags, imageTags } from '@/db';
import { eq, sql, desc, inArray } from 'drizzle-orm';
import { saveOriginalAndGetMetadata, extractExifForDb, deleteImageVariants, UPLOAD_DIR_ORIGINAL, UPLOAD_DIR_WEBP, UPLOAD_DIR_AVIF, UPLOAD_DIR_JPEG } from '@/lib/process-image';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { isValidSlug, isValidFilename, isValidTagName } from '@/lib/validation';
import { enqueueImageProcessing, getProcessingQueueState } from '@/lib/image-queue';
import { logAuditEvent } from '@/lib/audit';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { formatUploadLimit, MAX_TOTAL_UPLOAD_BYTES } from '@/lib/upload-limits';

export async function uploadImages(formData: FormData) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    const files = formData.getAll('files').filter((f): f is File => f instanceof File);
    // Topic is now a string slug
    const topic = formData.get('topic')?.toString() ?? '';
    const tagsString = formData.get('tags')?.toString() ?? '';

    if (tagsString && tagsString.length > 1000) {
        return { error: 'Tags string is too long (max 1000 chars)' };
    }

    const tagNames = tagsString
        ? tagsString.split(',').map(t => t.trim()).filter(t => t.length > 0 && isValidTagName(t))
        : [];

    if (tagsString && tagNames.length !== tagsString.split(',').map(t => t.trim()).filter(Boolean).length) {
        return { error: 'Tag names must be 1-100 characters and cannot contain commas' };
    }

    if (!files.length) return { error: 'No files provided' };
    if (files.length > 100) return { error: 'Too many files at once (max 100)' };

    // Disk space pre-check: require at least 1GB free before accepting uploads
    try {
        const { statfs } = await import('fs/promises');
        const stats = await statfs(UPLOAD_DIR_ORIGINAL);
        const freeBytes = stats.bfree * stats.bsize;
        if (freeBytes < 1024 * 1024 * 1024) {
            return { error: 'Insufficient disk space for upload' };
        }
    } catch {
        // statfs may fail on some platforms; proceed anyway
    }

    // Validate total upload size
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    if (totalSize > MAX_TOTAL_UPLOAD_BYTES) {
        return { error: `Total upload size exceeds ${formatUploadLimit(MAX_TOTAL_UPLOAD_BYTES)} limit` };
    }

    if (!topic) return { error: 'Topic required' };

    // Validate topic slug format
    if (!isValidSlug(topic)) {
        return { error: 'Invalid topic format' };
    }

    let successCount = 0;
    const failedFiles: string[] = [];
    const replacedFiles: string[] = [];

    for (const file of files) {
        try {
            const originalFilename = path.basename(file.name).trim();

            const existingImage = originalFilename.length > 0
                ? (await db.select({
                        id: images.id,
                        filename_original: images.filename_original,
                        filename_webp: images.filename_webp,
                        filename_avif: images.filename_avif,
                        filename_jpeg: images.filename_jpeg,
                    })
                    .from(images)
                    // Match only on user_filename — title fallback was removed because a
                    // different image with the same title as a new file's name caused silent overwrite.
                    .where(eq(images.user_filename, originalFilename))
                    .orderBy(desc(images.id))
                    .limit(1))[0]
                : null;

            const existingId = existingImage
                ? path.basename(existingImage.filename_webp, path.extname(existingImage.filename_webp))
                : null;

            if (existingImage) {
                if (
                    !isValidFilename(existingImage.filename_original)
                    || !isValidFilename(existingImage.filename_webp)
                    || !isValidFilename(existingImage.filename_avif)
                    || !isValidFilename(existingImage.filename_jpeg)
                ) {
                    throw new Error('Invalid filename in database record');
                }
            }

            // Phase 1: Save original and get metadata (fast)
            const data = await saveOriginalAndGetMetadata(
                file,
                existingId ? { id: existingId } : undefined
            );

            // Extract EXIF
            const exifDb = extractExifForDb(data.exifData);

            if (existingImage && existingId) {
                await db.update(images)
                    .set({
                        filename_original: data.filenameOriginal,
                        filename_webp: data.filenameWebp,
                        filename_avif: data.filenameAvif,
                        filename_jpeg: data.filenameJpeg,
                        width: data.width,
                        height: data.height,
                        original_width: data.originalWidth,
                        original_height: data.originalHeight,
                        user_filename: originalFilename, // Ensure user_filename is set on update (migration-like)
                        blur_data_url: data.blurDataUrl,
                        processed: false,
                        updated_at: sql`CURRENT_TIMESTAMP`,
                        ...exifDb,
                        color_space: data.iccProfileName || exifDb.color_space,
                        bit_depth: data.bitDepth,
                        original_format: data.filenameOriginal.split('.').pop()?.toUpperCase() || null,
                        original_file_size: file.size,
                    })
                    .where(eq(images.id, existingImage.id));

                replacedFiles.push(originalFilename || file.name);

                // Phase 4: Queue heavy processing (Fire and Forget)
                enqueueImageProcessing({
                    id: existingImage.id,
                    filenameOriginal: data.filenameOriginal,
                    filenameWebp: data.filenameWebp,
                    filenameAvif: data.filenameAvif,
                    filenameJpeg: data.filenameJpeg,
                    width: data.width,
                });

                successCount++;
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
                blur_data_url: data.blurDataUrl,
                processed: false,
                ...exifDb,
                color_space: data.iccProfileName || exifDb.color_space,
                bit_depth: data.bitDepth,
                original_format: data.filenameOriginal.split('.').pop()?.toUpperCase() || null,
                original_file_size: file.size,
            };

            const [result] = await db.insert(images).values(insertValues);
            if (!result.insertId) {
                console.error(`Insert failed for file: ${file.name}`);
                failedFiles.push(file.name);
                continue;
            }
            const insertedImage = { id: result.insertId, ...insertValues };

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
                            const slugs = tagEntries.map(t => t.slug);
                            // Single batch fetch for all tag records
                            const tagRecords = await db.select().from(tags).where(inArray(tags.slug, slugs));
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
            }
        } catch (e) {
            // Log full error server-side; only return filename to client (no internal details)
            console.error(`Failed to process file ${file.name}:`, e);
            failedFiles.push(file.name);
        }
    }

    if (failedFiles.length > 0 && successCount === 0) {
        return { error: 'All uploads failed' };
    }

    // Revalidate so newly uploaded (unprocessed) images appear in admin dashboard
    revalidateLocalizedPaths('/', '/admin/dashboard');

    return {
        success: true,
        count: successCount,
        failed: failedFiles,
        replaced: replacedFiles
    };
}

export async function deleteImage(id: number) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid image ID' };
    }

    // Get image to find filenames — select only needed columns
    const [image] = await db.select({
        id: images.id,
        filename_original: images.filename_original,
        filename_webp: images.filename_webp,
        filename_avif: images.filename_avif,
        filename_jpeg: images.filename_jpeg,
    }).from(images).where(eq(images.id, id));
    if (!image) return { error: 'Image not found' };

    // Validate filenames before attempting to delete (security check)
    if (
        !isValidFilename(image.filename_original)
        || !isValidFilename(image.filename_webp)
        || !isValidFilename(image.filename_avif)
        || !isValidFilename(image.filename_jpeg)
    ) {
         return { error: 'Invalid filename in database record' };
    }

    // US-001: Remove from processing queue so the queue detects deletion
    const queueState = getProcessingQueueState();
    queueState.enqueued.delete(id);

    // US-008: Delete DB records in a transaction for consistency
    await db.transaction(async (tx) => {
        await tx.delete(imageTags).where(eq(imageTags.imageId, id));
        await tx.delete(images).where(eq(images.id, id));
    });

    // Delete files deterministically (no readdir) — best effort, all in parallel
    try {
        await Promise.all([
            fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, image.filename_original)).catch(() => {}),
            deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp),
            deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif),
            deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg),
        ]);
    } catch {
        console.error("Error deleting files");
    }

    revalidateLocalizedPaths('/', '/admin/dashboard');

    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'image_delete', 'image', String(id), undefined, {}).catch(console.debug);

    return { success: true };
}

export async function deleteImages(ids: number[]) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    if (!Array.isArray(ids) || ids.length === 0) {
        return { error: 'No images selected' };
    }

    // Limit batch size to prevent DoS
    if (ids.length > 100) {
        return { error: 'Too many images to delete at once (max 100)' };
    }

    // Validate all IDs upfront
    for (const id of ids) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: 'Invalid image ID in selection' };
        }
    }

    // Fetch all images in one query — select only needed columns
    const imageRecords = await db.select({
        id: images.id,
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
            return { error: 'Invalid filename in database record' };
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

    // Delete DB records in a transaction (imageTags cascade via FK, but explicit for safety)
    if (foundIds.length > 0) {
        await db.transaction(async (tx) => {
            await tx.delete(imageTags).where(inArray(imageTags.imageId, foundIds));
            await tx.delete(images).where(inArray(images.id, foundIds));
        });
    }

    // Clean up files deterministically (no readdir) for all images concurrently
    await Promise.all(imageRecords.map(async (image) => {
        try {
            await Promise.all([
                fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, image.filename_original)).catch(() => {}),
                deleteImageVariants(UPLOAD_DIR_WEBP, image.filename_webp),
                deleteImageVariants(UPLOAD_DIR_AVIF, image.filename_avif),
                deleteImageVariants(UPLOAD_DIR_JPEG, image.filename_jpeg),
            ]);
        } catch {
            console.error(`Error deleting files for image ${image.id}`);
        }
    }));

    const successCount = foundIds.length;
    const errorCount = notFoundCount;

    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'images_batch_delete', 'image', foundIds.join(','), undefined, { count: successCount }).catch(console.debug);

    revalidateLocalizedPaths('/', '/admin/dashboard');
    return { success: true, count: successCount, errors: errorCount };
}

export async function updateImageMetadata(id: number, title: string | null, description: string | null) {
    if (!(await isAdmin())) {
        return { error: 'Unauthorized' };
    }

    if (!Number.isInteger(id) || id <= 0) {
        return { error: 'Invalid image ID' };
    }

    if (title && title.length > 255) {
        return { error: 'Title is too long (max 255 chars)' };
    }

    if (description && description.length > 5000) {
        return { error: 'Description is too long (max 5000 chars)' };
    }

    try {
        const [existingImage] = await db.select({ topic: images.topic })
            .from(images).where(eq(images.id, id));

        const [result] = await db.update(images)
            .set({
                title: title?.trim() || null,
                description: description?.trim() || null,
                updated_at: sql`CURRENT_TIMESTAMP`
            })
            .where(eq(images.id, id));

        if (result.affectedRows === 0) {
            return { error: 'Image not found' };
        }

        const topicPath = existingImage?.topic ? `/${existingImage.topic}` : undefined;
        revalidateLocalizedPaths(`/p/${id}`, '/admin/dashboard', '/', ...(topicPath ? [topicPath] : []));
        return { success: true };
    } catch (e) {
        console.error("Failed to update image metadata", e);
        return { error: 'Failed to update image' };
    }
}
