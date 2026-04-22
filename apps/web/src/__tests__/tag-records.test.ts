import { describe, expect, it } from 'vitest';

import { getTagSlug } from '@/lib/tag-records';

describe('getTagSlug', () => {
    it('keeps ASCII tag slugs stable', () => {
        expect(getTagSlug('Night Sky')).toBe('night-sky');
    });

    it('preserves non-Latin letters instead of collapsing to an empty slug', () => {
        expect(getTagSlug('풍경')).toBe('풍경');
        expect(getTagSlug('서울 야경')).toBe('서울-야경');
    });
});
