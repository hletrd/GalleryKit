import {
    DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS,
    getSettingDefaults,
    type GallerySettingKey,
} from './gallery-config-shared';
import { normalizeGallerySettingValue } from './settings-normalization';

export const SETTINGS_BACKFILL_WARNING_KEYS = DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS
    .filter((key) => key !== 'image_sizes');

export const SETTINGS_BACKFILL_WARNING_KEY_SET = new Set<string>(SETTINGS_BACKFILL_WARNING_KEYS);

export function getEffectiveBackfillSettingValue(
    settings: Record<string, string>,
    defaults: Record<GallerySettingKey, string>,
    key: string,
): string {
    const defaultValue = normalizeGallerySettingValue(key, defaults[key as GallerySettingKey] ?? '');
    const rawValue = settings[key];
    const value = rawValue === undefined ? '' : normalizeGallerySettingValue(key, rawValue);
    return value || defaultValue;
}

export function hasBackfillRelevantDifference(
    current: Record<string, string>,
    baseline: Record<string, string>,
    defaults: Record<GallerySettingKey, string> = getSettingDefaults(),
): boolean {
    return SETTINGS_BACKFILL_WARNING_KEYS.some((key) => (
        getEffectiveBackfillSettingValue(current, defaults, key)
        !== getEffectiveBackfillSettingValue(baseline, defaults, key)
    ));
}

export interface SavedBackfillPendingTransition {
    hasSavedBackfillPending: boolean;
    pendingBaseline: Record<string, string> | null;
}

export function resolveSavedBackfillPendingTransition({
    hasExistingImages,
    savedBackfillRelevantChange,
    previousBaseline,
    nextSettings,
    pendingBaseline,
    defaults = getSettingDefaults(),
}: {
    hasExistingImages: boolean;
    savedBackfillRelevantChange: boolean;
    previousBaseline: Record<string, string>;
    nextSettings: Record<string, string>;
    pendingBaseline: Record<string, string> | null;
    defaults?: Record<GallerySettingKey, string>;
}): SavedBackfillPendingTransition {
    if (!hasExistingImages) {
        return { hasSavedBackfillPending: false, pendingBaseline: null };
    }

    const baselineForPending = pendingBaseline
        ?? (savedBackfillRelevantChange ? previousBaseline : null);
    if (!baselineForPending) {
        return { hasSavedBackfillPending: false, pendingBaseline: null };
    }

    const hasSavedBackfillPending = hasBackfillRelevantDifference(
        nextSettings,
        baselineForPending,
        defaults,
    );
    return {
        hasSavedBackfillPending,
        pendingBaseline: hasSavedBackfillPending ? baselineForPending : null,
    };
}
