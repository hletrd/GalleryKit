import { describe, expect, it } from 'vitest';

import { getConcisePhotoAltText, getPhotoDisplayTitle, getPhotoDisplayTitleFromTagNames, getPhotoDocumentTitle, isFilenameLikeTitle } from '@/lib/photo-title';

describe('isFilenameLikeTitle', () => {
    it('recognizes filename-like titles', () => {
        expect(isFilenameLikeTitle('sample.JPG')).toBe(true);
        expect(isFilenameLikeTitle('Sunset')).toBe(false);
        expect(isFilenameLikeTitle(null)).toBe(false);
    });
});

describe('getPhotoDisplayTitle', () => {
    it('prefers tag-derived titles', () => {
        expect(getPhotoDisplayTitle({
            title: 'ignored.jpg',
            tags: [{ name: 'Seoul', slug: 'seoul' }, { name: 'Night', slug: 'night' }],
        }, 'Photo 42')).toBe('#Seoul #Night');
    });

    it('keeps a meaningful title by default even when tags are present', () => {
        expect(getPhotoDisplayTitle({
            title: 'Golden Hour',
            tags: [{ name: 'Night', slug: 'night' }],
        }, 'Photo 42')).toBe('Golden Hour');
    });

    it('uses a meaningful title when present', () => {
        expect(getPhotoDisplayTitle({
            title: 'Golden Hour',
            tags: [],
        }, 'Photo 42')).toBe('Golden Hour');
    });

    it('can preserve the historical hashtag formatting for page metadata surfaces', () => {
        expect(getPhotoDisplayTitle({
            title: 'Golden Hour',
            tags: [],
        }, 'Photo 42', { formatTitleAsTags: true })).toBe('#Golden #Hour');
    });

    it('can preserve tag-first metadata behavior when explicitly requested', () => {
        expect(getPhotoDisplayTitle({
            title: 'Golden Hour',
            tags: [{ name: 'Night', slug: 'night' }],
        }, 'Photo 42', { preferTags: true, formatTitleAsTags: true })).toBe('#Night');
    });

    it('falls back deterministically when the title is empty or filename-like', () => {
        expect(getPhotoDisplayTitle({
            title: 'IMG_0001.JPG',
            tags: [],
        }, 'Photo 42')).toBe('Photo 42');

        expect(getPhotoDisplayTitle({
            title: null,
            tags: [],
        }, 'Photo 42')).toBe('Photo 42');
    });
});



describe('lite photo title helpers', () => {
    it('normalizes filename-like lite titles to tag-derived display titles', () => {
        expect(getPhotoDisplayTitleFromTagNames({ title: 'IMG_0001.JPG', tag_names: 'Seoul,Night' }, 'Photo 1')).toBe('#Seoul #Night');
    });

    it('keeps concise alt text instead of verbose hash-prefixed tag strings', () => {
        expect(getConcisePhotoAltText({ title: 'IMG_0001.JPG', tag_names: 'Seoul,Night' }, 'Photo')).toBe('Seoul, Night');
    });
});

describe('getPhotoDocumentTitle', () => {
    it('derives the browser title from the normalized display title when present', () => {
        expect(getPhotoDocumentTitle('#Seoul #Night', 'GalleryKit', 'GalleryKit')).toBe('#Seoul #Night — GalleryKit');
    });

    it('preserves the existing fallback title when no normalized title is available', () => {
        expect(getPhotoDocumentTitle(null, 'GalleryKit', 'Photo 42 | GalleryKit')).toBe('Photo 42 | GalleryKit');
    });
});
