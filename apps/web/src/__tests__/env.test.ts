import { describe, expect, it } from 'vitest';

import { parseBoundedPositiveInteger } from '@/lib/env';

describe('parseBoundedPositiveInteger', () => {
    it('uses fallback for missing, invalid, non-finite, and non-positive values', () => {
        const opts = { fallback: 3, max: 10 };
        expect(parseBoundedPositiveInteger(undefined, opts)).toBe(3);
        expect(parseBoundedPositiveInteger('abc', opts)).toBe(3);
        expect(parseBoundedPositiveInteger('Infinity', opts)).toBe(3);
        expect(parseBoundedPositiveInteger('1e309', opts)).toBe(3);
        expect(parseBoundedPositiveInteger('0', opts)).toBe(3);
        expect(parseBoundedPositiveInteger('-1', opts)).toBe(3);
    });

    it('floors fractional values and caps oversized values', () => {
        const opts = { fallback: 3, max: 10 };
        expect(parseBoundedPositiveInteger('2.9', opts)).toBe(2);
        expect(parseBoundedPositiveInteger('999', opts)).toBe(10);
    });

    it('rejects invalid bounds supplied by callers', () => {
        expect(() => parseBoundedPositiveInteger('1', { fallback: 0, max: 10 })).toThrow('fallback');
        expect(() => parseBoundedPositiveInteger('1', { fallback: 3, max: 2 })).toThrow('max');
    });
});
