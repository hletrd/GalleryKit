/**
 * TEST3-05 / C3-19 (run-10 c3) — first direct coverage for
 * normalizeGallerySettingValue. It sits on the settings-save path
 * (settings-submit-payload, settings-backfill-warning, actions/settings)
 * where a broken trim/short-circuit could persist whitespace-only values
 * or skip the image_sizes canonicalization.
 */
import { describe, expect, it } from 'vitest';
import { normalizeGallerySettingValue } from '@/lib/settings-normalization';
import { normalizeConfiguredImageSizes } from '@/lib/gallery-config-shared';

describe('normalizeGallerySettingValue', () => {
    it('trims ordinary values', () => {
        expect(normalizeGallerySettingValue('seo_title', '  My Gallery  ')).toBe('My Gallery');
    });

    it('collapses whitespace-only values to the empty string', () => {
        expect(normalizeGallerySettingValue('seo_title', '   ')).toBe('');
        expect(normalizeGallerySettingValue('seo_title', '')).toBe('');
    });

    it('delegates image_sizes to the shared canonicalizer', () => {
        const raw = ' 640, 1536 ';
        expect(normalizeGallerySettingValue('image_sizes', raw)).toBe(
            normalizeConfiguredImageSizes(raw.trim()),
        );
    });

    it('falls back to the trimmed raw value when image_sizes cannot be canonicalized', () => {
        expect(normalizeGallerySettingValue('image_sizes', ' not-numbers ')).toBe('not-numbers');
    });

    it('does not canonicalize other keys through the image_sizes path', () => {
        expect(normalizeGallerySettingValue('image_quality_webp', ' 90 ')).toBe('90');
    });
});
