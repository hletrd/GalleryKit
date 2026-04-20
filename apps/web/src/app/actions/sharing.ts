'use server';

import { db, images, sharedGroups, sharedGroupImages } from '@/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { generateBase56 } from '@/lib/base56';
import { headers } from 'next/headers';
import { getClientIp, checkRateLimit, incrementRateLimit, isRateLimitExceeded } from '@/lib/rate-limit';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { isMySQLError } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';

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

/** Pre-increment then check — prevents TOCTOU between concurrent requests.
 *  Same pattern as login (A-01) and createAdminUser (C11R2-02). */
function checkShareRateLimit(ip: string): boolean {
    pruneShareRateLimit();
    const now = Date.now();
    const entry = shareRateLimit.get(ip);
    if (!entry || entry.resetAt <= now) {
        shareRateLimit.set(ip, { count: 1, resetAt: now + SHARE_RATE_LIMIT_WINDOW_MS });
    } else {
        entry.count++;
    }
    // Return true if OVER the limit (rate-limited)
    const currentEntry = shareRateLimit.get(ip)!;
    return currentEntry.count > SHARE_MAX_PER_WINDOW;
}

export async function createPhotoShareLink(imageId: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    // In-memory pre-increment (prevents TOCTOU — same pattern as login A-01)
    if (checkShareRateLimit(ip)) {
        return { error: t('tooManyShareRequests') };
    }
    // DB-backed check for accuracy across restarts (pre-increment before check)
    try {
        await incrementRateLimit(ip, 'share_photo', SHARE_RATE_LIMIT_WINDOW_MS);
        const dbLimit = await checkRateLimit(ip, 'share_photo', SHARE_MAX_PER_WINDOW, SHARE_RATE_LIMIT_WINDOW_MS);
        if (isRateLimitExceeded(dbLimit.count, SHARE_MAX_PER_WINDOW, true)) {
            // Roll back in-memory pre-increment to stay consistent with DB source of truth.
            // Without this, the in-memory counter over-counts, causing premature rate limiting.
            const currentEntry = shareRateLimit.get(ip);
            if (currentEntry && currentEntry.count > 1) {
                currentEntry.count--;
            } else {
                shareRateLimit.delete(ip);
            }
            return { error: t('tooManyShareRequests') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map (already incremented above)
    }

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: t('invalidImageId') };
    }

    const [image] = await db.select({ id: images.id, share_key: images.share_key, processed: images.processed })
        .from(images).where(eq(images.id, imageId));
    if (!image) return { error: t('imageNotFound') };
    if (!image.processed) return { error: t('imageStillProcessing') };

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
                const currentUser = await getCurrentUser();
                logAuditEvent(currentUser?.id ?? null, 'share_create', 'image', String(imageId), undefined, { key }).catch(console.debug);
                revalidateLocalizedPaths(`/p/${imageId}`, '/admin/dashboard');
                return { success: true, key: key };
            }

            // Another request may have set it — re-fetch
            const [refreshedImage] = await db.select({ share_key: images.share_key })
                .from(images)
                .where(eq(images.id, imageId));

            // Image may have been deleted between the initial check and now
            if (!refreshedImage) {
                return { error: t('imageNotFound') };
            }

            if (refreshedImage.share_key) {
                return { success: true, key: refreshedImage.share_key };
            }

            retries++;
        } catch (e) {
            // Only retry on key collision (duplicate entry), not on other errors
            if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('Duplicate entry'))) {
                retries++;
                continue;
            }
            // Non-retryable error — fail immediately
            return { error: t('failedToGenerateKey') };
        }
    }
    return { error: t('failedToGenerateKey') };
}

export async function createGroupShareLink(imageIds: number[]) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    // In-memory pre-increment (prevents TOCTOU — same pattern as login A-01)
    if (checkShareRateLimit(ip)) {
        return { error: t('tooManyShareRequests') };
    }
    // DB-backed check for accuracy across restarts (pre-increment before check)
    try {
        await incrementRateLimit(ip, 'share_group', SHARE_RATE_LIMIT_WINDOW_MS);
        const dbLimit = await checkRateLimit(ip, 'share_group', SHARE_MAX_PER_WINDOW, SHARE_RATE_LIMIT_WINDOW_MS);
        if (isRateLimitExceeded(dbLimit.count, SHARE_MAX_PER_WINDOW, true)) {
            // Roll back in-memory pre-increment to stay consistent with DB source of truth.
            const currentEntry = shareRateLimit.get(ip);
            if (currentEntry && currentEntry.count > 1) {
                currentEntry.count--;
            } else {
                shareRateLimit.delete(ip);
            }
            return { error: t('tooManyShareRequests') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map (already incremented above)
    }

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
        return { error: t('noImagesSelected') };
    }

    const uniqueImageIds = Array.from(new Set(imageIds));

    if (uniqueImageIds.length > 100) {
        return { error: t('tooManyImages') };
    }

    for (const id of uniqueImageIds) {
        if (!Number.isInteger(id) || id <= 0) {
            return { error: t('invalidImageId') };
        }
    }

    const groupImages = await db.select({
        id: images.id,
        processed: images.processed,
    }).from(images).where(inArray(images.id, uniqueImageIds));

    if (groupImages.length !== uniqueImageIds.length) {
        return { error: t('imagesNotFound') };
    }
    if (groupImages.some((image) => !image.processed)) {
        return { error: t('imagesMustBeProcessed') };
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
            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'group_share_create', 'shared_group', undefined, undefined, { key, imageCount: uniqueImageIds.length }).catch(console.debug);
            return { success: true, key };
        } catch (e) {
            // Only retry on key collision (duplicate entry), not on other errors
            if (isMySQLError(e) && (e.code === 'ER_DUP_ENTRY' || e.message?.includes('Duplicate entry'))) {
                retries++;
                continue;
            }
            // Non-retryable error — fail immediately
            return { error: t('failedToCreateGroup') };
        }
    }
    return { error: t('failedToCreateGroup') };
}

export async function revokePhotoShareLink(imageId: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: t('invalidImageId') };
    }

    const [image] = await db.select({ id: images.id, share_key: images.share_key }).from(images).where(eq(images.id, imageId));
    if (!image) return { error: t('imageNotFound') };
    if (!image.share_key) return { error: t('noActiveShareLink') };

    const oldShareKey = image.share_key;

    // Use conditional WHERE to prevent race with concurrent share-key recreation:
    // if another admin created a new share_key between our SELECT and UPDATE,
    // the conditional WHERE will match 0 rows instead of revoking the new key.
    const [result] = await db.update(images)
        .set({ share_key: null })
        .where(and(eq(images.id, imageId), eq(images.share_key, oldShareKey)));

    if (result.affectedRows === 0) {
        // Share key was changed by a concurrent request — don't revoke the new key
        return { error: t('noActiveShareLink') };
    }

    revalidateLocalizedPaths(`/p/${imageId}`, `/s/${oldShareKey}`, '/admin/dashboard');
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'share_revoke', 'image', String(imageId), undefined, { key: oldShareKey }).catch(console.debug);
    return { success: true };
}

export async function deleteGroupShareLink(groupId: number) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    if (!Number.isInteger(groupId) || groupId <= 0) {
        return { error: t('invalidGroupId') };
    }

    // Fetch group key before deletion for cache revalidation
    const [group] = await db.select({ key: sharedGroups.key }).from(sharedGroups).where(eq(sharedGroups.id, groupId));
    if (!group) return { error: t('groupNotFound') };

    // Delete sharedGroupImages explicitly before group (defense in depth alongside FK cascade)
    try {
        await db.transaction(async (tx) => {
            await tx.delete(sharedGroupImages).where(eq(sharedGroupImages.groupId, groupId));
            const [result] = await tx.delete(sharedGroups).where(eq(sharedGroups.id, groupId));
            if (result.affectedRows === 0) {
                throw new Error('GROUP_NOT_FOUND');
            }
        });
    } catch (e) {
        if (e instanceof Error && e.message === 'GROUP_NOT_FOUND') {
            return { error: t('groupNotFound') };
        }
        console.error('Failed to delete group share link:', e);
        return { error: t('failedToDeleteGroup') };
    }

    revalidateLocalizedPaths('/', `/g/${group.key}`, '/admin/dashboard');
    const currentUser = await getCurrentUser();
    logAuditEvent(currentUser?.id ?? null, 'group_share_delete', 'shared_group', String(groupId), undefined, { key: group.key }).catch(console.debug);
    return { success: true };
}
