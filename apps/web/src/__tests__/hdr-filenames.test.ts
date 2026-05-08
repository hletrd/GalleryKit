import { describe, it, expect } from 'vitest';
import { deriveHdrAvifFilename } from '@/lib/hdr-filenames';

describe('deriveHdrAvifFilename', () => {
    it('appends _hdr before .avif extension', () => {
        expect(deriveHdrAvifFilename('photo.avif')).toBe('photo_hdr.avif');
    });

    it('handles filenames with dots before the extension', () => {
        expect(deriveHdrAvifFilename('photo.v2.final.avif')).toBe('photo.v2.final_hdr.avif');
    });

    it('is case-insensitive for the extension', () => {
        expect(deriveHdrAvifFilename('photo.AVIF')).toBe('photo_hdr.AVIF');
        expect(deriveHdrAvifFilename('photo.AvIf')).toBe('photo_hdr.AvIf');
    });

    it('does not modify non-.avif filenames', () => {
        expect(deriveHdrAvifFilename('photo.webp')).toBe('photo.webp');
        expect(deriveHdrAvifFilename('photo.jpg')).toBe('photo.jpg');
    });
});
