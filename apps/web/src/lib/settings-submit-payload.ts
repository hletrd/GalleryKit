import { normalizeConfiguredImageSizes } from './gallery-config-shared';

export function buildChangedGallerySettingsPayload(
    settings: Record<string, string>,
    baseline: Record<string, string>,
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(settings)
            .map(([key, value]) => {
                if (key === 'image_sizes' && value.trim()) {
                    return [key, normalizeConfiguredImageSizes(value) ?? value] as const;
                }
                return [key, value] as const;
            })
            .filter(([key, value]) => value !== baseline[key]),
    );
}
