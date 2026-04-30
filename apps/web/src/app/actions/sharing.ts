'use server';

import { createHash } from 'crypto';
import { db, images, sharedGroups, sharedGroupImages } from '@/db';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { generateBase56 } from '@/lib/base56';
import { headers } from 'next/headers';
import { getClientIp, checkRateLimit, decrementRateLimit, getRateLimitBucketStart, incrementRateLimit, isRateLimitExceeded } from '@/lib/rate-limit';
import { createResetAtBoundedMap } from '@/lib/bounded-map';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { hasMySQLErrorCode, safeInsertId } from '@/lib/validation';
import { logAuditEvent } from '@/lib/audit';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { requireSameOriginAdmin } from '@/lib/action-guards';

const PHOTO_SHARE_KEY_LENGTH = 10;
const GROUP_SHARE_KEY_LENGTH = 10;

// C3-AGG-05: use BoundedMap for share rate limiting instead of inline
// Map + manual prune/evict logic that duplicated the bounded-map pattern.
const SHARE_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const SHARE_WRITE_MAX_PER_WINDOW = 20;
const SHARE_WRITE_RATE_LIMIT_MAX_KEYS = 500;
const shareWriteRateLimit = createResetAtBoundedMap<string>(SHARE_WRITE_RATE_LIMIT_MAX_KEYS);
type ShareRateLimitScope = 'share_photo' | 'share_group';

function getShareKeyFingerprint(key: string) {
    return createHash('sha256').update(key).digest('hex').slice(0, 12);
}

function getShareRateLimitKey(ip: string, scope: ShareRateLimitScope) {
    return `${scope}:${ip}`;
}

/** Pre-increment then check — prevents TOCTOU between concurrent requests.
 *  Same pattern as login (A-01) and createAdminUser (C11R2-02). */
function checkShareRateLimit(ip: string, scope: ShareRateLimitScope): boolean {
    const now = Date.now();
    shareWriteRateLimit.prune(now);
    const key = getShareRateLimitKey(ip, scope);
    const entry = shareWriteRateLimit.get(key);
    if (!entry || entry.resetAt <= now) {
        shareWriteRateLimit.set(key, { count: 1, resetAt: now + SHARE_RATE_LIMIT_WINDOW_MS });
    } else {
        entry.count++;
    }
    // Return true if OVER the limit (rate-limited)
    const currentEntry = shareWriteRateLimit.get(key)!;
    return currentEntry.count > SHARE_WRITE_MAX_PER_WINDOW;
}

function rollbackShareRateLimit(ip: string, scope: ShareRateLimitScope) {
    const key = getShareRateLimitKey(ip, scope);
    const currentEntry = shareWriteRateLimit.get(key);
    if (currentEntry && currentEntry.count > 1) {
        currentEntry.count--;
        return;
    }
    shareWriteRateLimit.delete(key);
}

/**
 * C6R-RPL-03 / AGG6R-02 — symmetric rollback of BOTH in-memory and DB
 * counters. Used on over-limit branches and FK-violation recovery paths
 * where the DB counter was pre-incremented but the action did not
 * ultimately execute.
 */
async function rollbackShareRateLimitFull(ip: string, scope: ShareRateLimitScope, bucketStart?: number) {
    rollbackShareRateLimit(ip, scope);
    await decrementRateLimit(ip, scope, SHARE_RATE_LIMIT_WINDOW_MS, bucketStart).catch((err) => {
        console.debug(`Failed to roll back DB share rate limit for scope ${scope}:`, err);
    });
}

export async function createPhotoShareLink(imageId: number) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const shareBucketStart = getRateLimitBucketStart(Date.now(), SHARE_RATE_LIMIT_WINDOW_MS);

    if (!Number.isInteger(imageId) || imageId <= 0) {
        return { error: t('invalidImageId') };
    }

    const [image] = await db.select({ id: images.id, share_key: images.share_key, processed: images.processed })
        .from(images).where(eq(images.id, imageId));
    if (!image) return { error: t('imageNotFound') };
    if (!image.processed) return { error: t('imageStillProcessing') };

    if (image.share_key) {
        // C16-LOW-10: no-op path — share key already exists. Roll back the
        // pre-incremented rate-limit counters so the admin isn't charged
        // for an action that didn't execute.
        await rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart);
        return { success: true, key: image.share_key };
    }

    // In-memory pre-increment (prevents TOCTOU — same pattern as login A-01)
    if (checkShareRateLimit(ip, 'share_photo')) {
        return { error: t('tooManyShareRequests') };
    }
    // DB-backed check for accuracy across restarts (pre-increment before check)
    try {
        await incrementRateLimit(ip, 'share_photo', SHARE_RATE_LIMIT_WINDOW_MS, shareBucketStart);
        const dbLimit = await checkRateLimit(ip, 'share_photo', SHARE_WRITE_MAX_PER_WINDOW, SHARE_RATE_LIMIT_WINDOW_MS, shareBucketStart);
        if (isRateLimitExceeded(dbLimit.count, SHARE_WRITE_MAX_PER_WINDOW, true)) {
            // C6R-RPL-03: roll back BOTH counters so the DB counter doesn't
            // drift ahead of the in-memory counter over the window.
            await rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart);
            return { error: t('tooManyShareRequests') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map (already incremented above)
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
                logAuditEvent(currentUser?.id ?? null, 'share_create', 'image', String(imageId), undefined, {
                    keyFingerprint: getShareKeyFingerprint(key),
                    keyLength: key.length,
                }).catch(console.debug);
                revalidateLocalizedPaths(`/p/${imageId}`, '/admin/dashboard');
                return { success: true, key: key };
            }

            // Another request may have set it — re-fetch
            const [refreshedImage] = await db.select({ share_key: images.share_key })
                .from(images)
                .where(eq(images.id, imageId));

            // Image may have been deleted between the initial check and now
            if (!refreshedImage) {
                await rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart);
                return { error: t('imageNotFound') };
            }

            if (refreshedImage.share_key) {
                await rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart);
                return { success: true, key: refreshedImage.share_key };
            }

            retries++;
        } catch (e) {
            // Only retry on key collision (duplicate entry), not on other errors
            if (hasMySQLErrorCode(e, 'ER_DUP_ENTRY')) {
                retries++;
                continue;
            }
            // Non-retryable error — roll back both rate-limit counters
            // so the admin isn't charged for an infrastructure failure
            // (C7R-RPL-03 / AGG7R-03).
            await rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart);
            return { error: t('failedToGenerateKey') };
        }
    }
    // Exhausted retries — roll back both counters for the same reason.
    await rollbackShareRateLimitFull(ip, 'share_photo', shareBucketStart);
    return { error: t('failedToGenerateKey') };
}

export async function createGroupShareLink(imageIds: number[]) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const shareBucketStart = getRateLimitBucketStart(Date.now(), SHARE_RATE_LIMIT_WINDOW_MS);

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

    // In-memory pre-increment (prevents TOCTOU — same pattern as login A-01)
    if (checkShareRateLimit(ip, 'share_group')) {
        return { error: t('tooManyShareRequests') };
    }
    // DB-backed check for accuracy across restarts (pre-increment before check)
    try {
        await incrementRateLimit(ip, 'share_group', SHARE_RATE_LIMIT_WINDOW_MS, shareBucketStart);
        const dbLimit = await checkRateLimit(ip, 'share_group', SHARE_WRITE_MAX_PER_WINDOW, SHARE_RATE_LIMIT_WINDOW_MS, shareBucketStart);
        if (isRateLimitExceeded(dbLimit.count, SHARE_WRITE_MAX_PER_WINDOW, true)) {
            // C6R-RPL-03: roll back BOTH counters.
            await rollbackShareRateLimitFull(ip, 'share_group', shareBucketStart);
            return { error: t('tooManyShareRequests') };
        }
    } catch {
        // DB unavailable — rely on in-memory Map (already incremented above)
    }

    let retries = 0;
    while (retries < 5) {
        const groupKey = generateBase56(GROUP_SHARE_KEY_LENGTH);
        try {
            const key = await db.transaction(async (tx) => {
                const [result] = await tx.insert(sharedGroups)
                    .values({ key: groupKey });

                // C20-MED-01: use safeInsertId to prevent silent BigInt precision loss
                const groupId = safeInsertId(result.insertId);
                if (groupId <= 0) {
                    throw new Error('Invalid insert ID from shared group creation');
                }

                const [linkResult] = await tx.insert(sharedGroupImages)
                    .values(
                        uniqueImageIds.map((imgId, position) => ({
                            groupId: groupId,
                            imageId: imgId,
                            position,
                        }))
                    );
                if (Number(linkResult.affectedRows ?? 0) !== uniqueImageIds.length) {
                    throw new Error('Shared group image link count mismatch');
                }

                return groupKey;
            });

            revalidateLocalizedPaths('/');
            const currentUser = await getCurrentUser();
            logAuditEvent(currentUser?.id ?? null, 'group_share_create', 'shared_group', undefined, undefined, {
                keyFingerprint: getShareKeyFingerprint(key),
                keyLength: key.length,
                imageCount: uniqueImageIds.length,
            }).catch(console.debug);
            return { success: true, key };
        } catch (e) {
            // Only retry on key collision (duplicate entry), not on other errors
            if (hasMySQLErrorCode(e, 'ER_DUP_ENTRY')) {
                retries++;
                continue;
            }
            if (hasMySQLErrorCode(e, 'ER_NO_REFERENCED_ROW_2')) {
                // C6R-RPL-03: FK violation means the action did NOT execute;
                // roll back the DB rate-limit counter so the admin isn't
                // penalized for a deleted image. In-memory counter rolled
                // back symmetrically.
                await rollbackShareRateLimitFull(ip, 'share_group', shareBucketStart);
                return { error: t('imagesNotFound') };
            }
            // Non-retryable error — roll back both rate-limit counters
            // so the admin isn't charged for an infrastructure failure
            // (C7R-RPL-03 / AGG7R-03).
            await rollbackShareRateLimitFull(ip, 'share_group', shareBucketStart);
            return { error: t('failedToCreateGroup') };
        }
    }
    // Exhausted retries — roll back both counters for the same reason.
    await rollbackShareRateLimitFull(ip, 'share_group', shareBucketStart);
    return { error: t('failedToCreateGroup') };
}

export async function revokePhotoShareLink(imageId: number) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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
    logAuditEvent(currentUser?.id ?? null, 'share_revoke', 'image', String(imageId), undefined, {
        keyFingerprint: getShareKeyFingerprint(oldShareKey),
        keyLength: oldShareKey.length,
    }).catch(console.debug);
    return { success: true };
}

export async function deleteGroupShareLink(groupId: number) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

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
    logAuditEvent(currentUser?.id ?? null, 'group_share_delete', 'shared_group', String(groupId), undefined, {
        keyFingerprint: getShareKeyFingerprint(group.key),
        keyLength: group.key.length,
    }).catch(console.debug);
    return { success: true };
}
