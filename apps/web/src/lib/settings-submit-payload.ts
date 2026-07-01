import { normalizeGallerySettingValue } from './settings-normalization';

function normalizeBaselineForDiff(key: string, value: string | undefined): string | undefined {
    return value === undefined ? undefined : normalizeGallerySettingValue(key, value);
}

export function buildChangedGallerySettingsPayload(
    settings: Record<string, string>,
    baseline: Record<string, string>,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(settings)
            .map(([key, value]) => {
                return [key, normalizeGallerySettingValue(key, value)] as const;
            })
            .filter(([key, value]) => value !== normalizeBaselineForDiff(key, baseline[key])),
    );
}
