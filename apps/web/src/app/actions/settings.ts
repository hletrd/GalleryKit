'use server';

import { db, adminSettings } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { revalidateLocalizedPaths } from '@/lib/revalidation';
import { stripControlChars } from '@/lib/sanitize';
import { switchStorageBackend } from '@/lib/storage';
import { GALLERY_SETTING_KEYS, isValidSettingValue } from '@/lib/gallery-config-shared';
import type { GallerySettingKey } from '@/lib/gallery-config-shared';

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

    // Validate all provided keys are allowed
    const allowedKeys = new Set<string>(GALLERY_SETTING_KEYS);
    for (const key of Object.keys(settings)) {
        if (!allowedKeys.has(key)) {
            return { error: t('invalidSettingKey') };
        }
    }

    // Validate individual setting values
    for (const [key, value] of Object.entries(settings)) {
        const trimmedValue = value.trim();
        if (trimmedValue === '') continue; // Empty means "use default" — will be deleted
        if (!isValidSettingValue(key as GallerySettingKey, trimmedValue)) {
            return { error: t('invalidSettingValue', { key }) };
        }
    }

    try {
        // Upsert each setting atomically in a transaction to prevent partial writes on crash
        await db.transaction(async (tx) => {
            for (const [key, value] of Object.entries(settings)) {
                const sanitizedValue = stripControlChars(value.trim());
                if (!sanitizedValue) {
                    // Delete empty settings so defaults take effect
                    await tx.delete(adminSettings).where(eq(adminSettings.key, key));
                } else {
                    await tx.insert(adminSettings)
                        .values({ key, value: sanitizedValue })
                        .onDuplicateKeyUpdate({ set: { value: sanitizedValue } });
                }
            }
        });

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'gallery_settings_update', 'admin_settings', undefined, undefined, { keys: Object.keys(settings).join(',') }).catch(console.debug);

        // If storage backend changed, switch the live backend.
        // If the switch fails, roll back the DB setting to prevent a
        // DB/live inconsistency (DB shows the new backend but live
        // module still uses the old one). Deleting the row lets the
        // default ("local") take effect, matching the pre-change state.
        const newStorageBackend = settings.storage_backend?.trim();
        if (newStorageBackend && ['local', 'minio', 's3'].includes(newStorageBackend)) {
            try {
                await switchStorageBackend(newStorageBackend as 'local' | 'minio' | 's3');
            } catch (switchErr) {
                console.error('[Settings] Failed to switch storage backend:', switchErr);
                // Roll back the DB setting so getGalleryConfig() returns
                // the default backend instead of the broken one
                try {
                    await db.delete(adminSettings).where(eq(adminSettings.key, 'storage_backend'));
                } catch (rollbackErr) {
                    console.error('[Settings] Failed to roll back storage_backend setting:', rollbackErr);
                }
                // Return generic message to avoid leaking internal details
                // (e.g., S3 endpoint, bucket name) to the admin UI
                return { error: t('failedToSwitchStorageBackend') };
            }
        }

        // Revalidate admin settings page and homepage
        revalidateLocalizedPaths('/', '/admin/settings', '/admin/dashboard');

        return { success: true as const };
    } catch (err) {
        console.error('Failed to update gallery settings', err);
        return { error: t('failedToUpdateGallerySettings') };
    }
}
