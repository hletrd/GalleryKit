import { describe, expect, it } from 'vitest';
import { countCodePoints } from '@/lib/utils';

describe('countCodePoints', () => {
    it('counts BMP characters as 1 each', () => {
        expect(countCodePoints('hello')).toBe(5);
    });

    it('counts supplementary characters (emoji) as 1 each, not 2', () => {
        // U+1F600 (😀) is a supplementary character — 2 UTF-16 code units but 1 code point
        const emoji = '😀';
        expect(emoji.length).toBe(2); // JS .length counts surrogate pairs
        expect(countCodePoints(emoji)).toBe(1);
    });

    it('counts mixed BMP + supplementary correctly', () => {
        const mixed = 'Hi😀!';
        expect(mixed.length).toBe(5); // H(1) + i(1) + 😀(2) + !(1) = 5 code units
        expect(countCodePoints(mixed)).toBe(4); // H + i + 😀 + ! = 4 code points
    });

    it('handles long emoji strings that exceed .length but not code-point limit', () => {
        // 128 emoji = 256 code units (exceeds varchar(255) by .length) but only 128 code points
        const emoji128 = '😀'.repeat(128);
        expect(emoji128.length).toBe(256); // exceeds 255 if using .length
        expect(countCodePoints(emoji128)).toBe(128); // well within varchar(255)
    });

    it('counts CJK characters correctly', () => {
        // CJK Unified Ideographs are BMP — 1 code unit each
        const cjk = '日本語';
        expect(cjk.length).toBe(3);
        expect(countCodePoints(cjk)).toBe(3);
    });

    it('counts rare CJK supplementary ideographs as 1 each', () => {
        // U+20000 (CJK Unified Ideograph Extension B) is supplementary
        const rareCjk = '\u{20000}';
        expect(rareCjk.length).toBe(2); // surrogate pair
        expect(countCodePoints(rareCjk)).toBe(1);
    });

    it('handles empty string', () => {
        expect(countCodePoints('')).toBe(0);
    });

    it('handles string at exact boundary — 255 code points', () => {
        // 255 ASCII characters — exactly at the varchar(255) limit
        const s = 'a'.repeat(255);
        expect(countCodePoints(s)).toBe(255);
        expect(countCodePoints(s) > 255).toBe(false);
    });

    it('handles string just over boundary — 256 code points', () => {
        const s = 'a'.repeat(256);
        expect(countCodePoints(s)).toBe(256);
        expect(countCodePoints(s) > 255).toBe(true);
    });
});
