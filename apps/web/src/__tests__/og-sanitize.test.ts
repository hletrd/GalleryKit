/**
 * AGG-R8-13 / SEC-1 (run-8 c2): the shared OG sanitizer used by BOTH OG routes.
 *
 * Both `api/og/route.tsx` (home/site card) and `api/og/photo/[id]/route.tsx`
 * (per-photo card) now import `sanitizeForOg` from `@/lib/og-sanitize`, so a
 * single test on the shared function proves both routes strip Unicode bidi /
 * zero-width / C0 control chars. Pre-AGG-R8-13 the home route rendered its
 * strings RAW while the per-photo route stripped them — a defense-in-depth
 * symmetry gap. The AGG-4 lineage requires the GLOBAL strip (replace-all), so
 * MULTIPLE leaked chars are the important case (a non-global replace stripped
 * only the first).
 */

import { describe, it, expect } from 'vitest';
import { sanitizeForOg, OG_C0_CONTROL_CHARS } from '@/lib/og-sanitize';

describe('sanitizeForOg (shared OG-text strip)', () => {
    it('strips ALL bidi override/isolate chars, not just the first (global)', () => {
        // U+202E RLO, U+202D LRO, U+2066 LRI, U+2069 PDI — two+ of each.
        const dirty = 'a‮b‮c⁦d⁩e';
        const clean = sanitizeForOg(dirty);
        expect(clean).toBe('abcde');
        expect(/[‪-‮⁦-⁩]/.test(clean)).toBe(false);
    });

    it('strips ALL zero-width / invisible formatting chars', () => {
        // U+200B ZWSP ×2, U+200C ZWNJ, U+FEFF BOM, U+2060 WJ.
        const dirty = 'x​​y‌z﻿⁠w';
        const clean = sanitizeForOg(dirty);
        expect(clean).toBe('xyzw');
    });

    it('strips C0 control chars but keeps tab/newline/CR', () => {
        const dirty = 'a\x00b\x07c\x1F';
        expect(sanitizeForOg(dirty)).toBe('abc');
        // \t \n \r are preserved (not in OG_C0_CONTROL_CHARS).
        expect(sanitizeForOg('a\tb\nc\rd')).toBe('a\tb\nc\rd');
        // The constant itself excludes \t \n \r.
        expect(OG_C0_CONTROL_CHARS.test('\t')).toBe(false);
        OG_C0_CONTROL_CHARS.lastIndex = 0; // reset the /g regex between uses
        expect(OG_C0_CONTROL_CHARS.test('\x01')).toBe(true);
        OG_C0_CONTROL_CHARS.lastIndex = 0;
    });

    it('combines bidi + zero-width + C0 in one pass', () => {
        const dirty = 'Sun‮set​​\x00 #photo';
        expect(sanitizeForOg(dirty)).toBe('Sunset #photo');
    });

    it('leaves ordinary text (incl. emoji / CJK) untouched', () => {
        expect(sanitizeForOg('Golden hour 🌅 写真')).toBe('Golden hour 🌅 写真');
    });
});
