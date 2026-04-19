'use server';

import { db, adminSettings } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { revalidateLocalizedPaths } from '@/lib/revalidation';

const SEO_SETTING_KEYS = [
    'seo_title',
    'seo_description',
    'seo_nav_title',
    'seo_author',
    'seo_locale',
    'seo_og_image_url',
] as const;

// Validation constraints
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAV_TITLE_LENGTH = 100;
const MAX_AUTHOR_LENGTH = 200;
const MAX_LOCALE_LENGTH = 10;
const MAX_OG_IMAGE_URL_LENGTH = 500;

export async function getSeoSettingsAdmin() {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    try {
        const rows = await db.select({ key: adminSettings.key, value: adminSettings.value })
            .from(adminSettings)
            .where(inArray(adminSettings.key, [...SEO_SETTING_KEYS]));

        const settingsMap = new Map(rows.map(r => [r.key, r.value]));
        return {
            success: true as const,
            settings: {
                seo_title: settingsMap.get('seo_title') || '',
                seo_description: settingsMap.get('seo_description') || '',
                seo_nav_title: settingsMap.get('seo_nav_title') || '',
                seo_author: settingsMap.get('seo_author') || '',
                seo_locale: settingsMap.get('seo_locale') || '',
                seo_og_image_url: settingsMap.get('seo_og_image_url') || '',
            },
        };
    } catch (err) {
        console.error('Failed to fetch SEO settings', err);
        return { error: t('failedToFetchSeoSettings') };
    }
}

export async function updateSeoSettings(settings: Record<string, string>) {
    const t = await getTranslations('serverActions');
    if (!(await isAdmin())) return { error: t('unauthorized') };

    // Validate all provided keys are allowed
    const allowedKeys = new Set(SEO_SETTING_KEYS);
    for (const key of Object.keys(settings)) {
        if (!allowedKeys.has(key as typeof SEO_SETTING_KEYS[number])) {
            return { error: t('invalidSeoKey') };
        }
    }

    // Validate individual field lengths
    if (settings.seo_title && settings.seo_title.length > MAX_TITLE_LENGTH) {
        return { error: t('seoTitleTooLong') };
    }
    if (settings.seo_description && settings.seo_description.length > MAX_DESCRIPTION_LENGTH) {
        return { error: t('seoDescriptionTooLong') };
    }
    if (settings.seo_nav_title && settings.seo_nav_title.length > MAX_NAV_TITLE_LENGTH) {
        return { error: t('seoNavTitleTooLong') };
    }
    if (settings.seo_author && settings.seo_author.length > MAX_AUTHOR_LENGTH) {
        return { error: t('seoAuthorTooLong') };
    }
    if (settings.seo_locale && settings.seo_locale.length > MAX_LOCALE_LENGTH) {
        return { error: t('seoLocaleTooLong') };
    }
    if (settings.seo_og_image_url && settings.seo_og_image_url.length > MAX_OG_IMAGE_URL_LENGTH) {
        return { error: t('seoOgImageUrlTooLong') };
    }

    // Validate OG image URL format if provided
    if (settings.seo_og_image_url && settings.seo_og_image_url.trim()) {
        try {
            const url = new URL(settings.seo_og_image_url.trim());
            if (!['http:', 'https:'].includes(url.protocol)) {
                return { error: t('seoOgImageUrlInvalid') };
            }
        } catch {
            return { error: t('seoOgImageUrlInvalid') };
        }
    }

    try {
        // Upsert each setting using INSERT ... ON DUPLICATE KEY UPDATE
        for (const [key, value] of Object.entries(settings)) {
            const trimmedValue = value.trim();
            if (trimmedValue === '') {
                // Delete empty settings so the JSON fallback takes effect
                await db.delete(adminSettings).where(eq(adminSettings.key, key));
            } else {
                await db.insert(adminSettings)
                    .values({ key, value: trimmedValue })
                    .onDuplicateKeyUpdate({ set: { value: trimmedValue } });
            }
        }

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'seo_settings_update', 'admin_settings', undefined, undefined, { keys: Object.keys(settings).join(',') }).catch(console.debug);

        // Revalidate all public pages so new SEO metadata is reflected
        revalidateLocalizedPaths('/', '/admin/seo', '/admin/dashboard');

        return { success: true as const };
    } catch (err) {
        console.error('Failed to update SEO settings', err);
        return { error: t('failedToUpdateSeoSettings') };
    }
}
