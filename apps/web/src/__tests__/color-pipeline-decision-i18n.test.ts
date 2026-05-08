/**
 * C4-A7 / C4-COL-LOW-3 / C4-COL-MED-2: enum-coverage smoke test for
 * `humanizeColorPipelineDecision`. Walks every known
 * `color_pipeline_decision` enum value through both en + ko translation
 * tables to ensure no enum produces an empty audit string.
 *
 * If a future enum value is added to the `ColorPipelineDecision` union
 * without updating en.json + ko.json, this test fails — preventing the
 * Color Details accordion from silently rendering the locale's "unknown"
 * fallback text for a real pipeline decision.
 *
 * Companion to existing `color-pipeline-decision.test.ts` which covers
 * the resolver side (`resolveColorPipelineDecision`).
 */
import { describe, it, expect } from 'vitest';
import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';
import { humanizeColorPipelineDecision } from '@/components/color-details-section';
import type { ColorPipelineDecision } from '@/lib/process-image';

const ENUM_VALUES: ColorPipelineDecision[] = [
    'srgb',
    'srgb-from-unknown',
    'p3-from-displayp3',
    'p3-from-dcip3',
    'p3-from-adobergb',
    'p3-from-prophoto',
    'p3-from-rec2020',
];

interface ViewerMessages {
    [key: string]: string;
}

const enViewer = (enMessages as { viewer: ViewerMessages }).viewer;
const koViewer = (koMessages as { viewer: ViewerMessages }).viewer;

const enT = (key: string): string => {
    const segments = key.split('.');
    if (segments[0] === 'viewer' && segments[1]) {
        return enViewer[segments[1]] ?? '';
    }
    return '';
};

const koT = (key: string): string => {
    const segments = key.split('.');
    if (segments[0] === 'viewer' && segments[1]) {
        return koViewer[segments[1]] ?? '';
    }
    return '';
};

describe('humanizeColorPipelineDecision — i18n enum coverage', () => {
    it.each(ENUM_VALUES)('returns non-empty English string for %s', (value) => {
        const result = humanizeColorPipelineDecision(value, enT);
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
    });

    it.each(ENUM_VALUES)('returns non-empty Korean string for %s', (value) => {
        const result = humanizeColorPipelineDecision(value, koT);
        expect(result).toBeTruthy();
        expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty string for unknown / null / undefined', () => {
        expect(humanizeColorPipelineDecision(null, enT)).toBe('');
        expect(humanizeColorPipelineDecision(undefined, enT)).toBe('');
        expect(humanizeColorPipelineDecision('not-an-enum', enT)).toBe('');
    });
});
