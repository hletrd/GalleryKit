import { describe, expect, it } from 'vitest';

import {
    DEFAULT_GRID_CARD_TARGET_SIZE,
    DEFAULT_IMAGE_SIZES,
    MAX_IMAGE_SIZE_COUNT,
    findGridCardImageSize,
    getPhotoViewerImageSizes,
    isValidSettingValue,
    normalizeConfiguredImageSizes,
    parseImageSizes,
} from '@/lib/gallery-config-shared';

describe('normalizeConfiguredImageSizes', () => {
    it('sorts and deduplicates valid image sizes', () => {
        expect(normalizeConfiguredImageSizes('2048, 640, 1536, 640')).toBe('640,1536,2048');
    });

    it('rejects malformed values and overlong lists', () => {
        expect(normalizeConfiguredImageSizes('640,,1536')).toBeNull();
        expect(normalizeConfiguredImageSizes('640,wide')).toBeNull();
        expect(normalizeConfiguredImageSizes('640.5,1536')).toBeNull();
        expect(normalizeConfiguredImageSizes(Array.from({ length: MAX_IMAGE_SIZE_COUNT + 1 }, (_, index) => String(index + 1)).join(','))).toBeNull();
    });
});

describe('parseImageSizes', () => {
    it('uses canonical image sizes when the input is valid', () => {
        expect(parseImageSizes('2048, 640, 1536, 640')).toEqual([640, 1536, 2048]);
    });

    it('falls back to defaults when the input is invalid', () => {
        expect(parseImageSizes('bad-value')).toEqual(DEFAULT_IMAGE_SIZES);
        expect(parseImageSizes('')).toEqual(DEFAULT_IMAGE_SIZES);
    });
});

describe('findGridCardImageSize', () => {
    it('prefers a thumbnail-sized derivative for grid cards', () => {
        expect(findGridCardImageSize([640, 1536, 2048, 4096])).toBe(DEFAULT_GRID_CARD_TARGET_SIZE);
    });

    it('falls back to the smallest configured size when no close thumbnail exists', () => {
        expect(findGridCardImageSize([1800, 2400, 3200])).toBe(1800);
    });
});

describe('getPhotoViewerImageSizes', () => {
    it('uses the full viewport when the desktop info panel is closed', () => {
        expect(getPhotoViewerImageSizes(false)).toBe('100vw');
    });

    it('subtracts the desktop info panel from the viewport hint when open', () => {
        expect(getPhotoViewerImageSizes(true)).toBe('(min-width: 1024px) calc(100vw - 414px), 100vw');
    });
});

describe('isValidSettingValue(image_sizes)', () => {
    it('accepts canonicalizable lists and rejects invalid ones', () => {
        expect(isValidSettingValue('image_sizes', '2048,640,1536')).toBe(true);
        expect(isValidSettingValue('image_sizes', '640,,1536')).toBe(false);
        expect(isValidSettingValue('image_sizes', '640.5,1536')).toBe(false);
    });
});
