'use server';

import { db, images, sharedGroups, sharedGroupImages } from '@/db';
import { eq, and, sql } from 'drizzle-orm';
import { generateBase56 } from '@/lib/base56';

import { isAdmin } from '@/app/actions/auth';

const PHOTO_SHARE_KEY_LENGTH = 10;
const GROUP_SHARE_KEY_LENGTH = 10;

export async function createPhotoShareLink(imageId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    // Validate imageId
    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: 'Invalid image ID' };
    }

    const [image] = await db.select({ id: images.id, share_key: images.share_key })
        .from(images).where(eq(images.id, imageId));
    if (!image) return { error: 'Image not found' };

    if (image.share_key) {
        return { success: true, key: image.share_key };
    }

    // Generate new key with atomic update to prevent race conditions
    let retries = 0;
    while (retries < 5) {
        const key = generateBase56(PHOTO_SHARE_KEY_LENGTH);
        try {
            // Use WHERE clause to ensure we only update if share_key is still null
            // This prevents race condition where two requests try to set the key
            const [result] = await db.update(images)
                .set({ share_key: key })
                .where(and(eq(images.id, imageId), sql`${images.share_key} IS NULL`));

            if (result.affectedRows > 0) {
                return { success: true, key: key };
            }

            // If no rows updated, another request may have set it - re-fetch
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

    // Validate imageIds
    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return { error: 'No images selected' };
    }

    const uniqueImageIds = Array.from(new Set(imageIds));

    // Limit maximum images per group
    if (uniqueImageIds.length > 100) {
        return { error: 'Too many images (max 100)' };
    }

    // Validate all IDs are positive integers
    for (const id of uniqueImageIds) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: 'Invalid image ID' };
        }
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
                        uniqueImageIds.map((imgId) => ({
                            groupId: groupId,
                            imageId: imgId,
                        }))
                    );

                return groupKey;
            });

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

    return { success: true };
}

export async function deleteGroupShareLink(groupId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return { error: 'Invalid group ID' };
    }

    // sharedGroupImages cascade-deletes via FK
    await db.delete(sharedGroups).where(eq(sharedGroups.id, groupId));

    return { success: true };
}
