'use server';

import { db, adminSettings, images } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { revalidateAllAppData } from '@/lib/revalidation';
import { stripControlChars } from '@/lib/sanitize';
import { GALLERY_SETTING_KEYS, getSettingDefaults, isValidSettingValue, normalizeConfiguredImageSizes } from '@/lib/gallery-config-shared';
import type { GallerySettingKey } from '@/lib/gallery-config-shared';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';

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
    if (!(await isAdmin())) return { error: t('unauthorized') };
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    const defaults = getSettingDefaults();

    // Validate all provided keys are allowed
    const allowedKeys = new Set<string>(GALLERY_SETTING_KEYS);
    for (const key of Object.keys(settings)) {
        if (!allowedKeys.has(key)) {
            return { error: t('invalidSettingKey') };
        }
    }

    // Sanitize before validation so length/format checks operate on the same
    // value that will be stored. Without this, control characters pass
    // validation but are stripped later, causing a mismatch between validated
    // and persisted data (same pattern as seo.ts C29-09 fix).
    const sanitizedSettings: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
        sanitizedSettings[key] = stripControlChars(value.trim()) ?? '';
    }

    // Validate individual setting values (on sanitized values)
    for (const [key, value] of Object.entries(sanitizedSettings)) {
        if (!value) continue; // Empty means "use default" — will be deleted
        if (!isValidSettingValue(key as GallerySettingKey, value)) {
            return { error: t('invalidSettingValue', { key }) };
        }
    }

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
            const [processedImage] = await db
                .select({ id: images.id })
                .from(images)
                .where(eq(images.processed, true))
                .limit(1);

            if (processedImage) {
                return { error: t('imageSizesLocked') };
            }
        }
    }

    try {
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
    }
}
