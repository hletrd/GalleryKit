/**
 * US-P52: Alt-text fallback resolver tests
 *
 * Verifies the fallback chain:
 *   title > tag-derived > alt_text_suggested > generic 'photo' fallback
 */

import { describe, expect, it } from 'vitest';
import { getConcisePhotoAltText } from '@/lib/photo-title';

const FALLBACK = 'Photo';

describe('getConcisePhotoAltText — alt_text_suggested fallback chain (US-P52)', () => {
    it('returns title when title is set and meaningful', () => {
        expect(getConcisePhotoAltText(
            { title: 'Golden Hour', tag_names: null, alt_text_suggested: 'Photo taken with Canon EOS R5' },
            FALLBACK,
        )).toBe('Golden Hour');
    });

    it('returns tag-derived text when title is absent but tags are present', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: 'Seoul,Night', alt_text_suggested: 'Photo taken with Canon EOS R5' },
            FALLBACK,
        )).toBe('Seoul, Night');
    });

    it('returns alt_text_suggested when title and tags are both absent', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: 'Photo taken with Canon EOS R5' },
            FALLBACK,
        )).toBe('Photo taken with Canon EOS R5');
    });

    it('returns alt_text_suggested when title is filename-like and tags are absent', () => {
        expect(getConcisePhotoAltText(
            { title: 'IMG_0001.JPG', tag_names: null, alt_text_suggested: 'Photo taken with Sony A7R V' },
            FALLBACK,
        )).toBe('Photo taken with Sony A7R V');
    });

    it('returns generic fallback when title, tags, and alt_text_suggested are all absent', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: null },
            FALLBACK,
        )).toBe(FALLBACK);
    });

    it('returns generic fallback when alt_text_suggested is empty string', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: '' },
            FALLBACK,
        )).toBe(FALLBACK);
    });

    it('returns generic fallback when alt_text_suggested is whitespace only', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: '   ' },
            FALLBACK,
        )).toBe(FALLBACK);
    });

    it('title takes precedence over alt_text_suggested even when tags are absent', () => {
        expect(getConcisePhotoAltText(
            { title: 'Sunset over the mountains', tag_names: null, alt_text_suggested: 'Photo taken with Nikon Z9' },
            FALLBACK,
        )).toBe('Sunset over the mountains');
    });

    it('tags take precedence over alt_text_suggested', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: 'Landscape,Forest', alt_text_suggested: 'Photo taken with Nikon Z9' },
            FALLBACK,
        )).toBe('Landscape, Forest');
    });

    it('works when alt_text_suggested is undefined (backward compat)', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: null },
            FALLBACK,
        )).toBe(FALLBACK);
    });

    it('trims whitespace from alt_text_suggested', () => {
        expect(getConcisePhotoAltText(
            { title: null, tag_names: null, alt_text_suggested: '  Photo taken with Fujifilm X-T5  ' },
            FALLBACK,
        )).toBe('Photo taken with Fujifilm X-T5');
    });
});
