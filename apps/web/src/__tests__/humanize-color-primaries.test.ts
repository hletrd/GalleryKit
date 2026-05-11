/**
 * C4-A8 / C4-COL-LOW-4: lock the Latinate-by-convention rule (cycle-3
 * C3-D2) so a future contributor cannot silently translate one of the
 * primaries names. Convention: primaries names stay un-translated;
 * descriptive transfer-function values get translated via
 * humanizeTransferFunction(value, t).
 *
 * Photographers across en/ko locales read the same Latinate technical
 * names that match camera-vendor docs and CSS color-space spec wording.
 */
import { describe, it, expect } from 'vitest';
import { humanizeColorPrimaries } from '@/components/color-details-section';

describe('humanizeColorPrimaries — Latinate-by-convention', () => {
    it.each([
        ['bt709', 'BT.709'],
        ['p3-d65', 'Display P3'],
        ['dci-p3', 'DCI-P3'],
        ['bt2020', 'Rec. 2020'],
        ['adobergb', 'Adobe RGB'],
        ['prophoto', 'ProPhoto RGB'],
    ])('humanizes %j → %s (Latinate, locale-independent)', (input, expected) => {
        expect(humanizeColorPrimaries(input)).toBe(expected);
    });

    // R5-L1: humanizer returns null for unknown so callers can distinguish
    // "no value" from "zero-length string" via `??` / `||` fallbacks.
    it.each([
        ['unknown', null],
        ['', null],
        [null, null],
        [undefined, null],
        ['srgb', null],         // not a primaries enum; only transfer functions use 'srgb'
        ['p3', null],            // not the canonical key
        ['rec2020', null],        // canonical is 'bt2020', not 'rec2020'
    ])('returns null for unknown / non-canonical %j', (input, expected) => {
        expect(humanizeColorPrimaries(input as string | null | undefined)).toBe(expected);
    });
});
