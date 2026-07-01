'use server';

import { db, adminSettings, images } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { revalidateAllAppData } from '@/lib/revalidation';
import { normalizeStringRecord } from '@/lib/sanitize';
import { GALLERY_SETTING_KEYS, getSettingDefaults, isValidSettingValue, normalizeConfiguredImageSizes } from '@/lib/gallery-config-shared';
import type { GallerySettingKey } from '@/lib/gallery-config-shared';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { requireSameOriginAdmin } from '@/lib/action-guards';
import { hasActiveUploadClaims } from '@/lib/upload-tracker-state';
import { acquireUploadProcessingContractLock } from '@/lib/upload-processing-contract-lock';
import { normalizeGallerySettingValue } from '@/lib/settings-normalization';

/** @action-origin-exempt: read-only admin getter */
export async function getGallerySettingsAdmin() {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    try {
        const rows = await db.select({ key: adminSettings.key, value: adminSettings.value })
            .from(adminSettings)
            .where(inArray(adminSettings.key, [...GALLERY_SETTING_KEYS]));

        const settingsMap = new Map(rows.map(r => [r.key, r.value]));
        const settings: Record<string, string> = {};
        for (const key of GALLERY_SETTING_KEYS) {
            settings[key] = settingsMap.get(key) || '';
        }
        return { success: true as const, settings };
    } catch (err) {
        console.error('Failed to fetch gallery settings', err);
        return { error: t('failedToFetchGallerySettings') };
    }
}

export async function updateGallerySettings(settings: Record<string, string>) {
    const t = await getTranslations('serverActions');
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const defaults = getSettingDefaults();

    // Validate all provided keys are allowed and all values are strings.
    // normalizeStringRecord guards against non-string runtime payloads
    // (null, number, array) that would cause TypeError on .trim().
    const allowedKeys = new Set<string>(GALLERY_SETTING_KEYS);
    const normalized = normalizeStringRecord(settings, allowedKeys);
    if (!normalized.ok) {
        return { error: t(normalized.error) };
    }
    const sanitizedSettings = Object.fromEntries(
        Object.entries(normalized.record).map(([key, value]) => [
            key,
            normalizeGallerySettingValue(key, value),
        ]),
    );

    // Validate individual setting values (on sanitized values)
    for (const [key, value] of Object.entries(sanitizedSettings)) {
        if (!value) continue; // Empty means "use default" — will be deleted
        if (!isValidSettingValue(key as GallerySettingKey, value)) {
            return { error: t('invalidSettingValue', { key }) };
        }
        if (key === 'semantic_search_mode' && value === 'production') {
            return { error: t('semanticSearchProductionUiUnsupported') };
        }
    }

    let uploadContractLock: Awaited<ReturnType<typeof acquireUploadProcessingContractLock>> | null = null;
    try {
        const changedUploadProcessingKeys = new Set<GallerySettingKey>();

        if (Object.prototype.hasOwnProperty.call(sanitizedSettings, 'image_sizes')) {
            const requestedImageSizes = sanitizedSettings.image_sizes;
            const normalizedImageSizes = requestedImageSizes
                ? normalizeConfiguredImageSizes(requestedImageSizes)
                : defaults.image_sizes;
            if (!normalizedImageSizes) {
                return { error: t('invalidSettingValue', { key: 'image_sizes' }) };
            }
            if (requestedImageSizes) {
                sanitizedSettings.image_sizes = normalizedImageSizes;
            }

            const [currentImageSizesSetting] = await db
                .select({ value: adminSettings.value })
                .from(adminSettings)
                .where(eq(adminSettings.key, 'image_sizes'))
                .limit(1);

            const currentImageSizes = normalizeConfiguredImageSizes(currentImageSizesSetting?.value ?? defaults.image_sizes)
                ?? defaults.image_sizes;

            if (normalizedImageSizes !== currentImageSizes) {
                changedUploadProcessingKeys.add('image_sizes');
            } else {
                delete sanitizedSettings.image_sizes;
            }
        }

        if (Object.prototype.hasOwnProperty.call(sanitizedSettings, 'strip_gps_on_upload')) {
            const requestedStripGps = sanitizedSettings.strip_gps_on_upload || defaults.strip_gps_on_upload;
            const [currentStripGpsSetting] = await db
                .select({ value: adminSettings.value })
                .from(adminSettings)
                .where(eq(adminSettings.key, 'strip_gps_on_upload'))
                .limit(1);
            const currentStripGps = currentStripGpsSetting?.value ?? defaults.strip_gps_on_upload;

            if (requestedStripGps !== currentStripGps) {
                changedUploadProcessingKeys.add('strip_gps_on_upload');
            } else {
                delete sanitizedSettings.strip_gps_on_upload;
            }
        }

        const changesUploadProcessingContract = changedUploadProcessingKeys.size > 0;
        if (changesUploadProcessingContract && hasActiveUploadClaims()) {
            return { error: t('uploadSettingsLocked') };
        }

        uploadContractLock = changesUploadProcessingContract
            ? await acquireUploadProcessingContractLock()
            : null;
        if (changesUploadProcessingContract && !uploadContractLock) {
            return { error: t('uploadSettingsLocked') };
        }

        if (changedUploadProcessingKeys.has('image_sizes')) {
            const [existingImage] = await db
                .select({ id: images.id })
                .from(images)
                .limit(1);

            if (existingImage) {
                return { error: t('imageSizesLocked') };
            }
        }

        if (changedUploadProcessingKeys.has('strip_gps_on_upload')) {
            const [existingImage] = await db
                .select({ id: images.id })
                .from(images)
                .limit(1);

            if (existingImage) {
                return { error: t('uploadSettingsLocked') };
            }
        }

        if (Object.keys(sanitizedSettings).length === 0) {
            return { success: true as const, settings: sanitizedSettings };
        }

        // Upsert each setting atomically in a transaction to prevent partial writes on crash
        await db.transaction(async (tx) => {
            for (const [key, value] of Object.entries(sanitizedSettings)) {
                if (!value) {
                    // Delete empty settings so defaults take effect
                    await tx.delete(adminSettings).where(eq(adminSettings.key, key));
                } else {
                    await tx.insert(adminSettings)
                        .values({ key, value })
                        .onDuplicateKeyUpdate({ set: { value } });
                }
            }
        });

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'gallery_settings_update', 'admin_settings', undefined, undefined, { keys: Object.keys(sanitizedSettings).join(',') }).catch(console.debug);

        // Supported gallery settings affect public routes, metadata, and admin surfaces.
        // Revalidate the full app tree so stale cached photo/share pages do not linger.
        revalidateAllAppData();

        // C1R-04: return the normalized values (including the canonicalized
        // image_sizes string) so the admin settings client can rehydrate from
        // what was actually persisted.
        return { success: true as const, settings: sanitizedSettings };
    } catch (err) {
        console.error('Failed to update gallery settings', err);
        return { error: t('failedToUpdateGallerySettings') };
    } finally {
        await uploadContractLock?.release();
    }
}
