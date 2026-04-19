'use server';

import { db, images, sharedGroups, sharedGroupImages } from '@/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { generateBase56 } from '@/lib/base56';
import { headers } from 'next/headers';
import { getClientIp } from '@/lib/rate-limit';

import { isAdmin } from '@/app/actions/auth';
import { revalidateLocalizedPaths } from '@/lib/revalidation';

const PHOTO_SHARE_KEY_LENGTH = 10;
const GROUP_SHARE_KEY_LENGTH = 10;

// In-memory rate limit for share link creation (per admin IP, per window)
const SHARE_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const SHARE_MAX_PER_WINDOW = 20;
const SHARE_RATE_LIMIT_MAX_KEYS = 500;
const shareRateLimit = new Map<string, { count: number; resetAt: number }>();

function pruneShareRateLimit() {
    const now = Date.now();
    for (const [key, entry] of shareRateLimit) {
        if (entry.resetAt <= now) shareRateLimit.delete(key);
    }
    if (shareRateLimit.size > SHARE_RATE_LIMIT_MAX_KEYS) {
        const excess = shareRateLimit.size - SHARE_RATE_LIMIT_MAX_KEYS;
        let evicted = 0;
        for (const key of shareRateLimit.keys()) {
            if (evicted >= excess) break;
            shareRateLimit.delete(key);
            evicted++;
        }
    }
}

function checkShareRateLimit(ip: string): boolean {
    pruneShareRateLimit();
    const now = Date.now();
    const entry = shareRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        shareRateLimit.set(ip, { count: 1, resetAt: now + SHARE_RATE_LIMIT_WINDOW_MS });
        return false;
    }
    entry.count++;
    return entry.count > SHARE_MAX_PER_WINDOW;
}

export async function createPhotoShareLink(imageId: number) {
    if (!(await isAdmin())) return { error: 'Unauthorized' };

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    if (checkShareRateLimit(ip)) {
        return { error: 'Too many share link requests. Please try again later.' };
    }

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

            // Image may have been deleted between the initial check and now
            if (!refreshedImage) {
                return { error: 'Image not found' };
            }

            if (refreshedImage.share_key) {
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

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    if (checkShareRateLimit(ip)) {
        return { error: 'Too many share link requests. Please try again later.' };
    }

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

                const groupId = Number(result.insertId);
                if (!Number.isFinite(groupId) || groupId <= 0) {
                    throw new Error('Invalid insert ID from shared group creation');
                }

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

    const [image] = await db.select({ id: images.id, share_key: images.share_key }).from(images).where(eq(images.id, imageId));
    if (!image) return { error: 'Image not found' };
    if (!image.share_key) return { error: 'Image does not have an active share link' };

    const [result] = await db.update(images)
        .set({ share_key: null })
        .where(eq(images.id, imageId));

    if (result.affectedRows === 0) {
        return { error: 'Failed to revoke share link' };
    }

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
