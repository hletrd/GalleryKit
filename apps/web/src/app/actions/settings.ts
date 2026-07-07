'use server';

import { db, adminSettings, images } from '@/db';
import { eq, inArray } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { isAdmin, getCurrentUser } from '@/app/actions/auth';
import { logAuditEvent } from '@/lib/audit';
import { revalidateAllAppData } from '@/lib/revalidation';
import { invalidateDetachedGalleryConfigCache } from '@/lib/gallery-config';
import { normalizeStringRecord } from '@/lib/sanitize';
import { GALLERY_SETTING_KEYS, getSettingDefaults, isValidSettingValue, normalizeConfiguredImageSizes } from '@/lib/gallery-config-shared';
import type { GallerySettingKey } from '@/lib/gallery-config-shared';
import { SETTINGS_BACKFILL_WARNING_KEYS, hasBackfillRelevantDifference } from '@/lib/settings-backfill-warning';
import { getRestoreMaintenanceMessage } from '@/lib/restore-maintenance';
import { acquireAdminMutationSlot } from '@/lib/admin-mutation-barrier';
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
    // C1-03 (run-10 cycle-1, closes C77-ARCH-01): hold a shared restore-fence
    // slot for the WHOLE mutation body (released on every exit path via
    // Symbol.dispose) so a mutation admitted before the restore marker flips
    // cannot write into the freshly restored database mid-import.
    using mutationSlot = acquireAdminMutationSlot();
    if (!mutationSlot.acquired) return { error: t('restoreInProgress') };
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

        // C2-02 (run-10 c2): the byte-impacting keys other than image_sizes
        // (already hard-fenced above) have no admission fence at all — an
        // admin can freely change encoder quality/gamut settings even with
        // photos already on disk. Rather than a hard block, surface a soft
        // signal: if one of those keys actually changes value (checked
        // against a fresh DB read, not just the client's own diff) AND at
        // least one image has already been processed (so it already carries
        // derivative bytes encoded under the old settings), tell the caller a
        // re-encode is now required. Derived from the authoritative
        // SETTINGS_BACKFILL_WARNING_KEYS export so this can never drift from
        // the settings UI's own warning logic.
        let requiresBackfill = false;
        const requestedBackfillWarningKeys = SETTINGS_BACKFILL_WARNING_KEYS.filter((key) =>
            Object.prototype.hasOwnProperty.call(sanitizedSettings, key));

        if (requestedBackfillWarningKeys.length > 0) {
            const currentBackfillWarningRows = await db
                .select({ key: adminSettings.key, value: adminSettings.value })
                .from(adminSettings)
                .where(inArray(adminSettings.key, requestedBackfillWarningKeys));
            const currentBackfillWarningSettings: Record<string, string> = {};
            for (const row of currentBackfillWarningRows) {
                currentBackfillWarningSettings[row.key] = row.value;
            }

            if (hasBackfillRelevantDifference(sanitizedSettings, currentBackfillWarningSettings, defaults)) {
                const [existingProcessedImage] = await db
                    .select({ id: images.id })
                    .from(images)
                    .where(eq(images.processed, true))
                    .limit(1);
                requiresBackfill = !!existingProcessedImage;
            }
        }

        if (Object.keys(sanitizedSettings).length === 0) {
            return { success: true as const, settings: sanitizedSettings, requiresBackfill };
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

        // C4-07 / PERF4-08 (run-10 c4): also drop the detached-accessor
        // micro-cache so background consumers (image-queue side-effect gates,
        // the admin backfill runner's per-run snapshot) observe this commit
        // immediately instead of up to DETACHED_CONFIG_TTL_MS later — a
        // flip-setting-then-reencode sequence must never re-encode at the
        // pre-flip settings.
        invalidateDetachedGalleryConfigCache();

        // C1R-04: return the normalized values (including the canonicalized
        // image_sizes string) so the admin settings client can rehydrate from
        // what was actually persisted.
        return { success: true as const, settings: sanitizedSettings, requiresBackfill };
    } catch (err) {
        console.error('Failed to update gallery settings', err);
        return { error: t('failedToUpdateGallerySettings') };
    } finally {
        await uploadContractLock?.release();
    }
}
