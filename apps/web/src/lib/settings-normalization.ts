import { normalizeConfiguredImageSizes } from './gallery-config-shared';

export function normalizeGallerySettingValue(key: string, value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (key === 'image_sizes') {
        return normalizeConfiguredImageSizes(trimmed) ?? trimmed;
    }
    return trimmed;
}
