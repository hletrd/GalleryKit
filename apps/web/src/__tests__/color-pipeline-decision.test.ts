import { describe, it, expect } from 'vitest';
import { resolveColorPipelineDecision, type ColorPipelineDecision } from '@/lib/process-image';

describe('resolveColorPipelineDecision', () => {
    const cases: [string | null | undefined, ColorPipelineDecision][] = [
        // Exact P3 families
        ['Display P3', 'p3-from-displayp3'],
        ['display p3', 'p3-from-displayp3'],
        ['Display P3 - ACES', 'p3-from-displayp3'],
        ['P3-D65', 'p3-from-displayp3'],
        ['p3-d65', 'p3-from-displayp3'],
        ['DCI-P3', 'p3-from-dcip3'],
        ['dci-p3', 'p3-from-dcip3'],

        // Wider gamuts (P3 gamut-mapped path)
        ['Adobe RGB (1998)', 'p3-from-adobergb'],
        ['AdobeRGB', 'p3-from-adobergb'],
        ['adobe rgb', 'p3-from-adobergb'],
        ['ProPhoto RGB', 'p3-from-prophoto'],
        ['ProPhoto', 'p3-from-prophoto'],
        ['prophoto rgb', 'p3-from-prophoto'],
        ['Rec.2020', 'p3-from-rec2020'],
        ['BT.2020', 'p3-from-rec2020'],
        ['rec.2020', 'p3-from-rec2020'],
        ['bt.2020', 'p3-from-rec2020'],

        // sRGB
        ['sRGB IEC61966-2.1', 'srgb'],
        ['sRGB', 'srgb'],
        ['srgb', 'srgb'],

        // Unknown / null
        [null, 'srgb-from-unknown'],
        [undefined, 'srgb-from-unknown'],
        ['Some Random Profile', 'srgb-from-unknown'],
        ['', 'srgb-from-unknown'],
    ];

    it.each(cases)('resolves %j → %s', (input, expected) => {
        expect(resolveColorPipelineDecision(input)).toBe(expected);
    });

    // R7-H1: chromaticity-derived fallback when ICC name is opaque
    it('falls back to signals.colorPrimaries for opaque ICC names', () => {
        expect(resolveColorPipelineDecision('Eizo Custom Profile', { colorPrimaries: 'p3-d65' })).toBe('p3-from-displayp3');
        expect(resolveColorPipelineDecision('X-Rite Calibrated', { colorPrimaries: 'bt2020' })).toBe('p3-from-rec2020');
        expect(resolveColorPipelineDecision('BenQ SW Profile', { colorPrimaries: 'adobergb' })).toBe('p3-from-adobergb');
        expect(resolveColorPipelineDecision('Unknown Monitor', { colorPrimaries: 'bt709' })).toBe('srgb');
    });

    // R7-H1: opaque names with no signals still resolve to srgb-from-unknown
    it('returns srgb-from-unknown for opaque names without chromaticity signal', () => {
        expect(resolveColorPipelineDecision('Eizo Custom Profile')).toBe('srgb-from-unknown');
        expect(resolveColorPipelineDecision('Generic RGB', { colorPrimaries: null })).toBe('srgb-from-unknown');
    });

    // R7-M1: normalized ICC name matching (strip non-alphanumeric, lowercase)
    it('resolves DisplayP3 (no space) to p3-from-displayp3', () => {
        expect(resolveColorPipelineDecision('DisplayP3')).toBe('p3-from-displayp3');
    });

    it('resolves P3D65 (no hyphen) to p3-from-displayp3', () => {
        expect(resolveColorPipelineDecision('P3D65')).toBe('p3-from-displayp3');
    });

    it('resolves DCI_P3 (underscore) to p3-from-dcip3', () => {
        expect(resolveColorPipelineDecision('DCI_P3')).toBe('p3-from-dcip3');
    });

    it('resolves Adobe_RGB (underscore) to p3-from-adobergb', () => {
        expect(resolveColorPipelineDecision('Adobe_RGB')).toBe('p3-from-adobergb');
    });

    it('returns a value in the ColorPipelineDecision union', () => {
        const result = resolveColorPipelineDecision('Display P3');
        const allowed: ColorPipelineDecision[] = [
            'srgb', 'srgb-from-unknown', 'p3-from-displayp3', 'p3-from-dcip3',
            'p3-from-adobergb', 'p3-from-prophoto', 'p3-from-rec2020',
        ];
        expect(allowed).toContain(result);
    });
});
