import { describe, it, expect } from 'vitest';
import { generateBase56, isBase56, BASE56_CHARS } from '@/lib/base56';

describe('generateBase56', () => {
    it('produces a string of the requested length', () => {
        expect(generateBase56(8)).toHaveLength(8);
        expect(generateBase56(16)).toHaveLength(16);
        expect(generateBase56(1)).toHaveLength(1);
    });

    it('produces only valid Base56 characters', () => {
        const result = generateBase56(200);
        for (const ch of result) {
            expect(BASE56_CHARS).toContain(ch);
        }
    });

    it('produces different values on successive calls', () => {
        const a = generateBase56(16);
        const b = generateBase56(16);
        expect(a).not.toBe(b);
    });
});

describe('isBase56', () => {
    it('accepts valid Base56 strings', () => {
        expect(isBase56('abc23DEF')).toBe(true);
    });

    it('rejects empty string', () => {
        expect(isBase56('')).toBe(false);
    });

    it('rejects strings with excluded characters (0, 1, O, I, l)', () => {
        expect(isBase56('abc0')).toBe(false);
        expect(isBase56('abc1')).toBe(false);
        expect(isBase56('abcO')).toBe(false);
        expect(isBase56('abcI')).toBe(false);
        expect(isBase56('abcl')).toBe(false);
    });

    it('validates exact length when expectedLength is a number', () => {
        expect(isBase56('abcd', 4)).toBe(true);
        expect(isBase56('abcd', 5)).toBe(false);
    });

    it('validates length against array of allowed lengths', () => {
        expect(isBase56('abcd', [3, 4, 5])).toBe(true);
        expect(isBase56('abcd', [3, 5])).toBe(false);
    });

    it('rejects non-string input', () => {
        expect(isBase56(null as unknown as string)).toBe(false);
        expect(isBase56(undefined as unknown as string)).toBe(false);
    });
});
