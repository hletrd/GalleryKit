import {
    DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS,
    getSettingDefaults,
    normalizeConfiguredImageSizes,
    type GallerySettingKey,
} from './gallery-config-shared';

export const SETTINGS_BACKFILL_WARNING_KEYS = DERIVATIVE_BYTE_IMPACTING_SETTING_KEYS
    .filter((key) => key !== 'image_sizes');

export const SETTINGS_BACKFILL_WARNING_KEY_SET = new Set<string>(SETTINGS_BACKFILL_WARNING_KEYS);

export function getEffectiveBackfillSettingValue(
    settings: Record<string, string>,
    defaults: Record<GallerySettingKey, string>,
    key: string,
): string {
    const defaultValue = defaults[key as GallerySettingKey] ?? '';
    const rawValue = settings[key];
    const value = rawValue?.trim() ? rawValue : defaultValue;
    return key === 'image_sizes' ? (normalizeConfiguredImageSizes(value) ?? value) : value;
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
