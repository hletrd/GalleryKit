'use server';

import { db, adminSettings } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { revalidateAllAppData } from '@/lib/revalidation';
import { validateSeoOgImageUrl } from '@/lib/seo-og-url';
import { normalizeOpenGraphLocale } from '@/lib/locale-path';
import { normalizeStringRecord, sanitizeAdminString } from '@/lib/sanitize';
import { SEO_SETTING_KEYS } from '@/lib/gallery-config-shared';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { requireSameOriginAdmin } from '@/lib/action-guards';

// Validation constraints
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_NAV_TITLE_LENGTH = 100;
const MAX_AUTHOR_LENGTH = 200;
const MAX_LOCALE_LENGTH = 10;
const MAX_OG_IMAGE_URL_LENGTH = 500;

/** @action-origin-exempt: read-only admin getter */
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
    const maintenanceError = getRestoreMaintenanceMessage(t('restoreInProgress'));
    if (maintenanceError) return { error: maintenanceError };
    if (!(await isAdmin())) return { error: t('unauthorized') };
    // C2R-02: defense-in-depth same-origin check for mutating server actions.
    const originError = await requireSameOriginAdmin();
    if (originError) return { error: originError };

    // C7-AGG7R-03: check Unicode formatting on RAW values BEFORE
    // normalizeStringRecord strips them (stripControlChars now removes
    // bidi/zero-width chars). Guard with typeof because runtime Server
    // Action payloads can contain non-strings.
    // C6L-SEC-01: `seo_locale` and `seo_og_image_url` skip this gate
    // because their existing validators (`normalizeOpenGraphLocale`,
    // `validateSeoOgImageUrl`) are stricter than the Unicode-formatting
    // filter.
    if (typeof settings.seo_title === 'string' && sanitizeAdminString(settings.seo_title).rejected) {
        return { error: t('seoTitleInvalid') };
    }
    if (typeof settings.seo_description === 'string' && sanitizeAdminString(settings.seo_description).rejected) {
        return { error: t('seoDescriptionInvalid') };
    }
    if (typeof settings.seo_nav_title === 'string' && sanitizeAdminString(settings.seo_nav_title).rejected) {
        return { error: t('seoNavTitleInvalid') };
    }
    if (typeof settings.seo_author === 'string' && sanitizeAdminString(settings.seo_author).rejected) {
        return { error: t('seoAuthorInvalid') };
    }

    // Validate all provided keys are allowed and all values are strings.
    // normalizeStringRecord guards against non-string runtime payloads
    // (null, number, array) that would cause TypeError on .trim().
    const allowedKeys = new Set(SEO_SETTING_KEYS);
    const normalized = normalizeStringRecord(settings, allowedKeys);
    if (!normalized.ok) {
        return { error: t(normalized.error === 'invalidSettingKey' ? 'invalidSeoKey' : normalized.error) };
    }
    const sanitizedSettings = normalized.record;

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
    if (sanitizedSettings.seo_locale && !normalizeOpenGraphLocale(sanitizedSettings.seo_locale)) {
        return { error: t('seoLocaleInvalid') };
    }
    if (sanitizedSettings.seo_og_image_url && sanitizedSettings.seo_og_image_url.length > MAX_OG_IMAGE_URL_LENGTH) {
        return { error: t('seoOgImageUrlTooLong') };
    }

    // Validate OG image URL format if provided.
    // Restrict to relative paths (starting with /) or same-origin URLs
    // to prevent admins from setting tracker/malicious external URLs
    // in every public page's <meta og:image> tag.
    if (sanitizedSettings.seo_og_image_url && sanitizedSettings.seo_og_image_url.trim()) {
        if (!validateSeoOgImageUrl(sanitizedSettings.seo_og_image_url)) {
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

        // C1R-04: surface the sanitized values so the client can rehydrate
        // from what was actually persisted rather than its pre-submit state.
        return { success: true as const, settings: sanitizedSettings };
    } catch (err) {
        console.error('Failed to update SEO settings', err);
        return { error: t('failedToUpdateSeoSettings') };
    }
}
