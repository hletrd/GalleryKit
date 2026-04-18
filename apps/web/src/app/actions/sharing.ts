'use server';

import { db, images, sharedGroups, sharedGroupImages } from '@/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { generateBase56 } from '@/lib/base56';

import { isAdmin } from '@/app/actions/auth';
import { revalidateLocalizedPaths } from '@/lib/revalidation';

const PHOTO_SHARE_KEY_LENGTH = 10;
const GROUP_SHARE_KEY_LENGTH = 10;

export async function createPhotoShareLink(imageId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: 'Invalid image ID' };
    }

    const [image] = await db.select({ id: images.id, share_key: images.share_key, processed: images.processed })
        .from(images).where(eq(images.id, imageId));
    if (!image) return { error: 'Image not found' };
    if (!image.processed) return { error: 'Image is still processing' };

    if (image.share_key) {
        return { success: true, key: image.share_key };
    }

    // Atomic update to prevent race conditions
    let retries = 0;
    while (retries < 5) {
        const key = generateBase56(PHOTO_SHARE_KEY_LENGTH);
        try {
            // Only update if share_key is still null (prevents race)
            const [result] = await db.update(images)
                .set({ share_key: key })
                .where(and(eq(images.id, imageId), sql`${images.share_key} IS NULL`));

            if (result.affectedRows > 0) {
                revalidateLocalizedPaths(`/p/${imageId}`);
                return { success: true, key: key };
            }

            // Another request may have set it — re-fetch
            const [refreshedImage] = await db.select({ share_key: images.share_key })
                .from(images)
                .where(eq(images.id, imageId));

            if (refreshedImage?.share_key) {
                return { success: true, key: refreshedImage.share_key };
            }

            retries++;
        } catch {
            // Likely unique constraint violation - retry with new key
            retries++;
        }
    }
    return { error: 'Failed to generate unique key' };
}

export async function createGroupShareLink(imageIds: number[]) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return { error: 'No images selected' };
    }

    const uniqueImageIds = Array.from(new Set(imageIds));

    if (uniqueImageIds.length > 100) {
        return { error: 'Too many images (max 100)' };
    }

    for (const id of uniqueImageIds) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: 'Invalid image ID' };
        }
    }

    const groupImages = await db.select({
        id: images.id,
        processed: images.processed,
    }).from(images).where(inArray(images.id, uniqueImageIds));

    if (groupImages.length !== uniqueImageIds.length) {
        return { error: 'One or more selected images could not be found' };
    }
    if (groupImages.some((image) => !image.processed)) {
        return { error: 'All selected images must finish processing before sharing' };
    }

    let retries = 0;
    while (retries < 5) {
        const groupKey = generateBase56(GROUP_SHARE_KEY_LENGTH);
        try {
            const key = await db.transaction(async (tx) => {
                const [result] = await tx.insert(sharedGroups)
                    .values({ key: groupKey });

                const groupId = result.insertId;

                await tx.insert(sharedGroupImages)
                    .ignore()
                    .values(
                        uniqueImageIds.map((imgId, position) => ({
                            groupId: groupId,
                            imageId: imgId,
                            position,
                        }))
                    );

                return groupKey;
            });

            revalidateLocalizedPaths('/');
            return { success: true, key };
        } catch {
            // Key collision or other error - retry with new key
            retries++;
        }
    }
    return { error: 'Failed to create group' };
}

export async function revokePhotoShareLink(imageId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: 'Invalid image ID' };
    }

    const [image] = await db.select({ id: images.id }).from(images).where(eq(images.id, imageId));
    if (!image) return { error: 'Image not found' };

    await db.update(images)
        .set({ share_key: null })
        .where(eq(images.id, imageId));

    revalidateLocalizedPaths(`/p/${imageId}`);
    return { success: true };
}

export async function deleteGroupShareLink(groupId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return { error: 'Invalid group ID' };
    }

    // sharedGroupImages cascade-deletes via FK
    const [result] = await db.delete(sharedGroups).where(eq(sharedGroups.id, groupId));

    if (result.affectedRows === 0) {
        return { error: 'Group not found' };
    }

    revalidateLocalizedPaths('/');
    return { success: true };
}
