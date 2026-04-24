import { describe, expect, it } from 'vitest';

import { filterExistingTagSlugs, parseRequestedTagSlugs } from '@/lib/tag-slugs';

describe('tag slug parsing', () => {
    it('deduplicates repeated query values while preserving order', () => {
        expect(parseRequestedTagSlugs('landscape, portrait,landscape,portrait , macro')).toEqual([
            'landscape',
            'portrait',
            'macro',
        ]);
    });

    it('drops empty segments', () => {
        expect(parseRequestedTagSlugs('landscape,, ,macro,')).toEqual([
            'landscape',
            'macro',
        ]);
    });

    it('rejects overlong tag query strings', () => {
        expect(parseRequestedTagSlugs('a'.repeat(257))).toEqual([]);
    });
});

describe('existing tag filtering', () => {
    const availableTags = [
        { slug: 'landscape' },
        { slug: 'portrait' },
        { slug: 'macro' },
    ];

    it('preserves only existing slugs and keeps them unique', () => {
        expect(filterExistingTagSlugs(
            ['landscape', 'portrait', 'landscape', 'missing', 'macro', 'portrait'],
            availableTags,
        )).toEqual(['landscape', 'portrait', 'macro']);
    });
});
