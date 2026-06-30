import { normalizeConfiguredImageSizes } from './gallery-config-shared';

function normalizeSettingForDiff(key: string, value: string): string {
    if (key === 'image_sizes' && value.trim()) {
        return normalizeConfiguredImageSizes(value) ?? value;
    }
    return value;
}

function normalizeBaselineForDiff(key: string, value: string | undefined): string | undefined {
    return value === undefined ? undefined : normalizeSettingForDiff(key, value);
}

export function buildChangedGallerySettingsPayload(
    settings: Record<string, string>,
    baseline: Record<string, string>,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(settings)
            .map(([key, value]) => {
                return [key, normalizeSettingForDiff(key, value)] as const;
            })
            .filter(([key, value]) => value !== normalizeBaselineForDiff(key, baseline[key])),
    );
}
