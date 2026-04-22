import { describe, expect, it } from 'vitest';

import { hasSelectedTag, normalizeTagInputValue, resolveCanonicalTagName, type Tag } from '@/components/tag-input';

const availableTags: Tag[] = [
    { id: 1, name: 'Nature', slug: 'nature' },
    { id: 2, name: 'Night Sky', slug: 'night-sky' },
];

describe('normalizeTagInputValue', () => {
    it('trims and normalizes casing for comparisons', () => {
        expect(normalizeTagInputValue('  Nature  ')).toBe('nature');
    });

    it('normalizes compatibility-equivalent Unicode forms', () => {
        expect(normalizeTagInputValue('Ａ')).toBe('a');
    });
});

describe('hasSelectedTag', () => {
    it('treats selected tags as case-insensitive', () => {
        expect(hasSelectedTag(['Nature'], 'nature')).toBe(true);
        expect(hasSelectedTag(['Night Sky'], 'night sky')).toBe(true);
        expect(hasSelectedTag(['Nature'], 'portrait')).toBe(false);
    });
});

describe('resolveCanonicalTagName', () => {
    it('reuses existing tag casing when the user types a case variant', () => {
        expect(resolveCanonicalTagName(availableTags, 'nature')).toBe('Nature');
        expect(resolveCanonicalTagName(availableTags, ' Night Sky ')).toBe('Night Sky');
        expect(resolveCanonicalTagName(availableTags, 'Portrait')).toBe('Portrait');
    });
});
