import { describe, expect, it } from 'vitest';
import { ifNoneMatchMatches } from '@/lib/http-etag';

describe('ifNoneMatchMatches', () => {
    it('uses weak comparison for If-None-Match validators', () => {
        expect(ifNoneMatchMatches('"abc"', 'W/"abc"')).toBe(true);
        expect(ifNoneMatchMatches('W/"abc"', '"abc"')).toBe(true);
        expect(ifNoneMatchMatches('W/"other", "abc"', 'W/"abc"')).toBe(true);
    });

    it('honors wildcard and ignores malformed candidates', () => {
        expect(ifNoneMatchMatches('*', 'W/"abc"')).toBe(true);
        expect(ifNoneMatchMatches('not-an-etag, W/"abc"', 'W/"abc"')).toBe(true);
        expect(ifNoneMatchMatches('not-an-etag', 'W/"abc"')).toBe(false);
        expect(ifNoneMatchMatches('"other"', 'W/"abc"')).toBe(false);
    });

    it('does not split commas inside quoted opaque tags', () => {
        expect(ifNoneMatchMatches('"a,b", "c"', 'W/"a,b"')).toBe(true);
    });
});
