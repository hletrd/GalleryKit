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
import { describe, it, expect, vi } from 'vitest';
import { humanizeColorPrimaries } from '@/components/color-details-section';
import { humanizeColorPrimariesOrLabel } from '@/lib/color-label';

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

// C2-48/TEST-03: humanizeColorPrimariesOrLabel (@/lib/color-label) is the
// never-null variant — same known-value behavior as humanizeColorPrimaries,
// but falls back to a caller-supplied localized string instead of null.
describe('humanizeColorPrimariesOrLabel — never-null variant', () => {
    it('returns the humanized string for a known primary, same as humanizeColorPrimaries', () => {
        const t = vi.fn((key: string) => `translated:${key}`);
        expect(humanizeColorPrimariesOrLabel('p3-d65', t)).toBe('Display P3');
        expect(humanizeColorPrimariesOrLabel('p3-d65', t)).toBe(humanizeColorPrimaries('p3-d65'));
        expect(t).not.toHaveBeenCalled();
    });

    it('falls back to t("viewer.colorUnknown") for an unknown/null value', () => {
        const t = vi.fn((key: string) => `translated:${key}`);
        expect(humanizeColorPrimariesOrLabel('not-a-real-primary', t)).toBe('translated:viewer.colorUnknown');
        expect(humanizeColorPrimariesOrLabel(null, t)).toBe('translated:viewer.colorUnknown');
        expect(t).toHaveBeenCalledWith('viewer.colorUnknown');
        expect(t).toHaveBeenCalledTimes(2);
    });
});
