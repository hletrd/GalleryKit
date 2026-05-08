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
 *
 * C5-A3 / C5-COL-MED-2: walks the canonical `COLOR_PIPELINE_DECISIONS`
 * array from `@/lib/color-pipeline-decisions` rather than an inline
 * literal list. The cycle-4 inline list could drift from the resolver
 * source; the cycle-5 import locks the test against silent enum drift —
 * a new decision added to the canonical module that lacks a translation
 * key now fails this test even if the contributor never touches this
 * file.
 */
import { describe, it, expect } from 'vitest';
import enMessages from '../../messages/en.json';
import koMessages from '../../messages/ko.json';
import { humanizeColorPipelineDecision } from '@/components/color-details-section';
import { COLOR_PIPELINE_DECISIONS } from '@/lib/color-pipeline-decisions';

const ENUM_VALUES = COLOR_PIPELINE_DECISIONS;

// next-intl message tables are deeply-typed unions of strings + nested
// objects (e.g. viewer.histogramModes is itself an object). For this fixture
// we only need the leaf string entries under `viewer.*`, so we narrow to
// `Record<string, unknown>` and only use values that are string at runtime.
const enViewer = (enMessages as unknown as { viewer: Record<string, unknown> }).viewer;
const koViewer = (koMessages as unknown as { viewer: Record<string, unknown> }).viewer;

function lookup(table: Record<string, unknown>, key: string): string {
    const segments = key.split('.');
    if (segments[0] !== 'viewer' || !segments[1]) return '';
    const value = table[segments[1]];
    return typeof value === 'string' ? value : '';
}

const enT = (key: string): string => lookup(enViewer, key);
const koT = (key: string): string => lookup(koViewer, key);

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
        // P4-E3: parameter type tightened to `ColorPipelineDecision | null
        // | undefined`; the runtime contract still accepts unknown strings
        // via the `default` arm. The cast here exercises that runtime
        // tolerance — a future caller passing a stale enum from a DB
        // backfill should still get the empty fallback.
        expect(
            humanizeColorPipelineDecision(
                'not-an-enum' as unknown as Parameters<typeof humanizeColorPipelineDecision>[0],
                enT,
            ),
        ).toBe('');
    });
});
