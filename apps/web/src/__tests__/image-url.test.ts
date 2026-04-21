import { describe, expect, it } from 'vitest';

import { imageUrl, sizedImageFilename, sizedImageUrl } from '@/lib/image-url';

describe('sizedImageFilename', () => {
    it('uses the nearest configured derivative size for the requested target', () => {
        expect(sizedImageFilename('sample.jpg', 48, [640, 1536, 2048])).toBe('sample_640.jpg');
        expect(sizedImageFilename('sample.webp', 1700, [640, 1536, 2048])).toBe('sample_1536.webp');
    });

    it('returns the original filename when no extension is present', () => {
        expect(sizedImageFilename('sample', 48, [640, 1536])).toBe('sample');
    });
});

describe('sizedImageUrl', () => {
    it('builds a derivative URL inside the requested directory', () => {
        expect(sizedImageUrl('/uploads/jpeg', 'sample.jpg', 128, [640, 1536, 2048])).toBe(
            imageUrl('/uploads/jpeg/sample_640.jpg')
        );
    });
});
