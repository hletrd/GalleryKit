import { describe, expect, it } from 'vitest';
import { parsePageParam } from '@/lib/pagination';

/**
 * R22C22 T2 (DBG22-03): the admin dashboard previously used
 * `parseInt(pageParam || '1', 10)`, which mis-parses scientific notation
 * (`'1e3'` → 1) and silently paginated `?page=1e3` to page 1 instead of 1000.
 * `parsePageParam` uses `Number()`. These assertions FAIL against the old
 * `parseInt` implementation (the `'1e3'` → 1000 case) and PASS with the fix.
 */
describe('parsePageParam', () => {
    it('parses scientific notation (the DBG22-03 regression)', () => {
        expect(parsePageParam('1e3', 1000)).toBe(1000); // parseInt would give 1
    });

    it('parses a plain integer string', () => {
        expect(parsePageParam('7', 1000)).toBe(7);
    });

    it('clamps above maxPage', () => {
        expect(parsePageParam('2000', 1000)).toBe(1000);
        expect(parsePageParam('999999', 1000)).toBe(1000);
    });

    it('falls back to 1 for non-numeric input', () => {
        expect(parsePageParam('abc', 1000)).toBe(1);
        expect(parsePageParam('', 1000)).toBe(1);
        expect(parsePageParam(undefined, 1000)).toBe(1);
        expect(parsePageParam(null, 1000)).toBe(1);
    });

    it('floors fractional values (matching prior parseInt truncation)', () => {
        expect(parsePageParam('3.9', 1000)).toBe(3);
        expect(parsePageParam('1.2', 1000)).toBe(1);
    });

    it('clamps zero and negatives to 1', () => {
        expect(parsePageParam('0', 1000)).toBe(1);
        expect(parsePageParam('-5', 1000)).toBe(1);
    });

    it('rejects Infinity / NaN-producing input', () => {
        expect(parsePageParam('Infinity', 1000)).toBe(1);
        expect(parsePageParam('  ', 1000)).toBe(1);
    });

    it('keeps maxPage at a sane floor of 1', () => {
        expect(parsePageParam('5', 0)).toBe(1);
        expect(parsePageParam('5', -3)).toBe(1);
    });
});
