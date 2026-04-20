'use server';

import { db, adminSettings } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { revalidateAllAppData, revalidateLocalizedPaths } from '@/lib/revalidation';
import { stripControlChars } from '@/lib/sanitize';
import { SEO_SETTING_KEYS } from '@/lib/gallery-config-shared';
import type { SeoSettingKey } from '@/lib/gallery-config-shared';

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
        if (!allowedKeys.has(key as SeoSettingKey)) {
            return { error: t('invalidSeoKey') };
        }
    }

    // Sanitize before validation so length checks operate on the same
    // value that will be stored. Without this, control characters pass
    // the length check but are stripped later, causing a mismatch
    // between validated and persisted data (matches settings.ts pattern).
    const sanitizedSettings: Record<string, string> = {};
    for (const [key, value] of Object.entries(settings)) {
        sanitizedSettings[key] = stripControlChars(value.trim()) ?? '';
    }

    // Validate individual field lengths (on sanitized values)
    if (sanitizedSettings.seo_title && sanitizedSettings.seo_title.length > MAX_TITLE_LENGTH) {
        return { error: t('seoTitleTooLong') };
    }
    if (sanitizedSettings.seo_description && sanitizedSettings.seo_description.length > MAX_DESCRIPTION_LENGTH) {
        return { error: t('seoDescriptionTooLong') };
    }
    if (sanitizedSettings.seo_nav_title && sanitizedSettings.seo_nav_title.length > MAX_NAV_TITLE_LENGTH) {
        return { error: t('seoNavTitleTooLong') };
    }
    if (sanitizedSettings.seo_author && sanitizedSettings.seo_author.length > MAX_AUTHOR_LENGTH) {
        return { error: t('seoAuthorTooLong') };
    }
    if (sanitizedSettings.seo_locale && sanitizedSettings.seo_locale.length > MAX_LOCALE_LENGTH) {
        return { error: t('seoLocaleTooLong') };
    }
    if (sanitizedSettings.seo_og_image_url && sanitizedSettings.seo_og_image_url.length > MAX_OG_IMAGE_URL_LENGTH) {
        return { error: t('seoOgImageUrlTooLong') };
    }

    // Validate OG image URL format if provided
    if (sanitizedSettings.seo_og_image_url && sanitizedSettings.seo_og_image_url.trim()) {
        try {
            const url = new URL(sanitizedSettings.seo_og_image_url.trim());
            if (!['http:', 'https:'].includes(url.protocol)) {
                return { error: t('seoOgImageUrlInvalid') };
            }
        } catch {
            return { error: t('seoOgImageUrlInvalid') };
        }
    }

    try {
        // Upsert each setting atomically in a transaction to prevent partial writes on crash
        await db.transaction(async (tx) => {
            for (const [key, value] of Object.entries(sanitizedSettings)) {
                if (!value) {
                    // Delete empty settings so the JSON fallback takes effect
                    await tx.delete(adminSettings).where(eq(adminSettings.key, key));
                } else {
                    await tx.insert(adminSettings)
                        .values({ key, value })
                        .onDuplicateKeyUpdate({ set: { value } });
                }
            }
        });

        const currentUser = await getCurrentUser();
        logAuditEvent(currentUser?.id ?? null, 'seo_settings_update', 'admin_settings', undefined, undefined, { keys: Object.keys(sanitizedSettings).join(',') }).catch(console.debug);

        // SEO data is consumed by the localized root layout and long-lived
        // public metadata pages, so use layout-level invalidation instead of
        // a short hand-maintained path list.
        revalidateAllAppData();
        revalidateLocalizedPaths('/admin/seo', '/admin/dashboard');

        return { success: true as const };
    } catch (err) {
        console.error('Failed to update SEO settings', err);
        return { error: t('failedToUpdateSeoSettings') };
    }
}
