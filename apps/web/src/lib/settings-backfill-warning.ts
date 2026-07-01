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
