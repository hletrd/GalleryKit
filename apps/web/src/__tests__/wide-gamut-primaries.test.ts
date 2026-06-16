/**
 * C3-A1 / C3-COL-LOW-1 / C3-ARCH-MED-2: lock the canonical wide-gamut
 * primaries set in lib/color-primaries.ts so the upload pipeline
 * (process-image.ts, actions/images.ts) and the viewer surface
 * (photo-viewer.tsx, histogram.tsx, wide-gamut-hint.tsx, info-bottom-sheet.tsx)
 * agree on the membership.
 *
 * Adding a new wide-gamut primary in only ONE call site silently breaks
 * histogram / preview / chroma decisions on the others — this test fails
 * if the canonical set drifts away from the documented membership.
 *
 * AGG-C3-18 (architect A6): import from the client-safe leaf
 * lib/color-primaries directly — the previous import via the
 * lib/color-detection re-export pulled the heavy fs/sharp detection module
 * into a test that only needs the predicate. That re-export was removed.
 */
import { describe, it, expect } from 'vitest';
import { WIDE_GAMUT_PRIMARIES, isWideGamutPrimary } from '@/lib/color-primaries';

describe('WIDE_GAMUT_PRIMARIES — canonical wide-gamut primaries set', () => {
    it('contains exactly the 5 documented members', () => {
        expect(WIDE_GAMUT_PRIMARIES.size).toBe(5);
        expect(WIDE_GAMUT_PRIMARIES.has('p3-d65')).toBe(true);
        expect(WIDE_GAMUT_PRIMARIES.has('dci-p3')).toBe(true);
        expect(WIDE_GAMUT_PRIMARIES.has('adobergb')).toBe(true);
        expect(WIDE_GAMUT_PRIMARIES.has('prophoto')).toBe(true);
        expect(WIDE_GAMUT_PRIMARIES.has('bt2020')).toBe(true);
    });

    it('does NOT contain sRGB / BT.709 (narrow-gamut)', () => {
        // Casting through ReadonlySet<string> for the runtime check; the
        // type-level set is ReadonlySet<ColorSignals['colorPrimaries']> so
        // 'srgb' is not in the type union but membership stays well-defined.
        const runtime = WIDE_GAMUT_PRIMARIES as ReadonlySet<string>;
        expect(runtime.has('bt709')).toBe(false);
        expect(runtime.has('srgb')).toBe(false);
        expect(runtime.has('unknown')).toBe(false);
    });
});

describe('isWideGamutPrimary — convenience helper', () => {
    it('returns true for each wide-gamut primary', () => {
        expect(isWideGamutPrimary('p3-d65')).toBe(true);
        expect(isWideGamutPrimary('dci-p3')).toBe(true);
        expect(isWideGamutPrimary('adobergb')).toBe(true);
        expect(isWideGamutPrimary('prophoto')).toBe(true);
        expect(isWideGamutPrimary('bt2020')).toBe(true);
    });

    it('returns false for narrow-gamut and unknown values', () => {
        expect(isWideGamutPrimary('bt709')).toBe(false);
        expect(isWideGamutPrimary('srgb')).toBe(false);
        expect(isWideGamutPrimary('unknown')).toBe(false);
    });

    it('returns false for null / undefined / empty string', () => {
        expect(isWideGamutPrimary(null)).toBe(false);
        expect(isWideGamutPrimary(undefined)).toBe(false);
        expect(isWideGamutPrimary('')).toBe(false);
    });

    it('returns false for unrelated strings (defense against typos)', () => {
        expect(isWideGamutPrimary('p3')).toBe(false);
        expect(isWideGamutPrimary('Display P3')).toBe(false); // ICC-name form, not the canonical key
        expect(isWideGamutPrimary('rec2020')).toBe(false);    // canonical key is 'bt2020'
    });
});
