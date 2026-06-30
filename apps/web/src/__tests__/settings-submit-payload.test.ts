import { describe, expect, it } from 'vitest';

import { buildChangedGallerySettingsPayload } from '@/lib/settings-submit-payload';

describe('buildChangedGallerySettingsPayload', () => {
    it.each(['disabled', 'stub'] as const)(
        'submits %s to clear a stored inactive production semantic-search row',
        (mode) => {
            expect(buildChangedGallerySettingsPayload(
                {
                    semantic_search_mode: mode,
                    image_quality_jpeg: '90',
                },
                {
                    semantic_search_mode: 'production',
                    image_quality_jpeg: '90',
                },
            )).toEqual({ semantic_search_mode: mode });
        },
    );

    it('omits unchanged settings after image size canonicalization', () => {
        expect(buildChangedGallerySettingsPayload(
            { image_sizes: '1536, 640', image_quality_jpeg: '90' },
            { image_sizes: '640,1536', image_quality_jpeg: '90' },
        )).toEqual({});
    });

    it('omits unchanged image sizes when the stored baseline is non-canonical', () => {
        expect(buildChangedGallerySettingsPayload(
            { image_sizes: '640,1536', image_quality_jpeg: '90' },
            { image_sizes: '1536, 640', image_quality_jpeg: '90' },
        )).toEqual({});
    });
});
