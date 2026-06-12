/**
 * AGG-R5C2-54 (TEST-R5C2-14): standalone unit tests for countCodePoints
 * in apps/web/src/lib/utils.ts.
 *
 * countCodePoints counts Unicode code points (not UTF-16 code units), matching
 * MySQL utf8mb4 varchar(N) semantics. JavaScript's String.prototype.length
 * counts UTF-16 code units, which double-counts supplementary characters
 * (emoji, rare CJK Extension B+) that use surrogate pairs.
 *
 * These tests pin the actual semantics of the implementation, including the
 * distinctions between code points and grapheme clusters (combining mark
 * sequences count as multiple code points, not one grapheme).
 */

import { describe, it, expect } from 'vitest';
import { countCodePoints } from '@/lib/utils';

describe('countCodePoints', () => {
    // ── Empty / trivial ──────────────────────────────────────────────────────

    it('returns 0 for an empty string', () => {
        expect(countCodePoints('')).toBe(0);
    });

    it('returns 1 for a single ASCII character', () => {
        expect(countCodePoints('A')).toBe(1);
    });

    // ── ASCII strings ────────────────────────────────────────────────────────

    it('counts ASCII characters correctly', () => {
        expect(countCodePoints('hello')).toBe(5);
    });

    it('equals String.length for pure ASCII (no surrogates)', () => {
        const s = 'The quick brown fox';
        expect(countCodePoints(s)).toBe(s.length);
    });

    it('handles ASCII with spaces and punctuation', () => {
        expect(countCodePoints('Hello, World!')).toBe(13);
    });

    // ── Surrogate pairs (emoji, supplementary chars) ─────────────────────────

    it('counts a single emoji as 1 code point (not 2 JS .length units)', () => {
        // '😀' U+1F600 — uses a surrogate pair in JS (length = 2)
        expect(countCodePoints('😀')).toBe(1);
        expect('😀'.length).toBe(2); // sanity: JS .length double-counts
    });

    it('counts multiple emoji correctly', () => {
        // '🎉🎊🎈' — three emoji, each a surrogate pair
        const s = '🎉🎊🎈';
        expect(countCodePoints(s)).toBe(3);
        expect(s.length).toBe(6); // JS .length = 6
    });

    it('handles a mix of ASCII and emoji', () => {
        // 'Hi 😀' — 3 ASCII + 1 emoji = 4 code points, but JS .length = 5
        expect(countCodePoints('Hi 😀')).toBe(4);
    });

    it('counts flag emoji (ZWJ sequence components) by code point not grapheme', () => {
        // '🇰🇷' (South Korean flag) = 2 regional indicator code points (U+1F1F0 U+1F1F7)
        // JS .length = 4 (two surrogate pairs), countCodePoints = 2
        const flag = '🇰🇷';
        expect(countCodePoints(flag)).toBe(2);
        expect(flag.length).toBe(4);
    });

    it('counts a high Unicode math character as 1 code point', () => {
        // '𝄞' U+1D11E MUSICAL SYMBOL G CLEF — surrogate pair in JS
        expect(countCodePoints('𝄞')).toBe(1);
        expect('𝄞'.length).toBe(2);
    });

    // ── CJK characters ───────────────────────────────────────────────────────

    it('counts BMP CJK correctly (1 code point = 1 JS .length unit)', () => {
        // '你好' — two CJK characters in BMP, no surrogate pairs
        expect(countCodePoints('你好')).toBe(2);
        expect('你好'.length).toBe(2);
    });

    it('counts a string of Korean characters', () => {
        // '한국어' — 3 Hangul syllable code points
        expect(countCodePoints('한국어')).toBe(3);
    });

    it('counts Japanese characters', () => {
        expect(countCodePoints('写真')).toBe(2);
    });

    it('counts CJK extension B characters (surrogate pairs)', () => {
        // U+20000 (CJK Unified Ideograph Extension B) — surrogate pair
        const extB = '𠀀'; // U+20000
        expect(countCodePoints(extB)).toBe(1);
        expect(extB.length).toBe(2);
    });

    // ── Combining marks ──────────────────────────────────────────────────────
    // NOTE: countCodePoints counts CODE POINTS, not graphemes.
    // A base character + combining mark = 2 code points but 1 grapheme cluster.

    it('counts combining marks as separate code points (not graphemes)', () => {
        // 'e' + U+0301 COMBINING ACUTE ACCENT = 'é' (decomposed, 2 code points)
        // This is distinct from the precomposed 'é' (U+00E9, 1 code point).
        const decomposed = 'é'; // 2 code points, renders as 'é'
        expect(countCodePoints(decomposed)).toBe(2);

        const precomposed = 'é'; // 1 code point
        expect(countCodePoints(precomposed)).toBe(1);
    });

    it('counts multiple combining marks on one base as N+1 code points', () => {
        // 'a' + combining grave + combining diaeresis = 3 code points
        const s = 'à̈';
        expect(countCodePoints(s)).toBe(3);
    });

    // ── MySQL varchar(N) semantic equivalence ─────────────────────────────────

    it('128 emoji fit in varchar(255) by code-point count even though JS .length = 256', () => {
        const s = '😀'.repeat(128);
        expect(countCodePoints(s)).toBe(128);  // fits in varchar(255)
        expect(s.length).toBe(256);             // JS .length would falsely exceed 255
    });

    it('255 ASCII characters exactly fills a varchar(255)', () => {
        const s = 'x'.repeat(255);
        expect(countCodePoints(s)).toBe(255);
    });

    it('256 ASCII characters overflows varchar(255)', () => {
        const s = 'x'.repeat(256);
        expect(countCodePoints(s)).toBe(256);
    });
});
