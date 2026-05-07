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

    it('returns a value in the ColorPipelineDecision union', () => {
        const result = resolveColorPipelineDecision('Display P3');
        const allowed: ColorPipelineDecision[] = [
            'srgb', 'srgb-from-unknown', 'p3-from-displayp3', 'p3-from-dcip3',
            'p3-from-adobergb', 'p3-from-prophoto', 'p3-from-rec2020',
        ];
        expect(allowed).toContain(result);
    });
});
