/**
 * C6-A2 / C6-COL-MED-1 / C6-UX-MED-1: lock the `isP3Pipeline` predicate
 * helper and the call-site contract on gamut-aware color-detail surfaces.
 *
 * Two-part fixture-style test:
 *
 * Part 1 — runtime correctness. Walks every value in
 * `COLOR_PIPELINE_DECISIONS` (the cycle-5 canonical source-of-truth)
 * and asserts `isP3Pipeline` returns the expected boolean. Also covers
 * null / undefined / empty-string / non-enum inputs.
 *
 * Part 2 — call-site lock. Source-inspects `color-details-section.tsx`
 * and asserts:
 *   1. They import `isP3Pipeline` from `@/lib/color-pipeline-decisions`.
 *   2. They do NOT contain the inline `startsWith('p3-from-')` literal.
 *
 * Without these locks, a future refactor could regress to the
 * pre-cycle-6 triplicated-literal shape, re-opening the cross-surface
 * label-drift risk that C6-A1 closed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLOR_PIPELINE_DECISIONS, isP3Pipeline } from '@/lib/color-pipeline-decisions';

describe('isP3Pipeline — enum coverage (Part 1, runtime correctness)', () => {
    it.each(COLOR_PIPELINE_DECISIONS)('returns expected boolean for %s', (decision) => {
        const expected = decision.startsWith('p3-from-');
        expect(isP3Pipeline(decision)).toBe(expected);
    });

    it('returns false for null', () => {
        expect(isP3Pipeline(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(isP3Pipeline(undefined)).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isP3Pipeline('')).toBe(false);
    });

    it('returns false for srgb', () => {
        expect(isP3Pipeline('srgb')).toBe(false);
    });

    it('returns false for srgb-from-unknown', () => {
        expect(isP3Pipeline('srgb-from-unknown')).toBe(false);
    });

    it('returns false for non-enum strings without p3-from- prefix', () => {
        expect(isP3Pipeline('not-a-decision')).toBe(false);
        expect(isP3Pipeline('display-p3')).toBe(false);
        expect(isP3Pipeline('p3-only')).toBe(false);
    });

    it('returns true for any string starting with p3-from- (forward-compat)', () => {
        // When WI-09 ships HDR encoding, a future enum value such as
        // 'p3-from-bt2100hlg' would be added to COLOR_PIPELINE_DECISIONS.
        // The prefix predicate must keep returning true for it without
        // any helper change.
        expect(isP3Pipeline('p3-from-displayp3')).toBe(true);
        expect(isP3Pipeline('p3-from-bt2100hlg')).toBe(true);
        expect(isP3Pipeline('p3-from-future-encoder')).toBe(true);
    });
});

describe('isP3Pipeline — call-site lock (Part 2, source inspection)', () => {
    // Cycle 40 moved public download labels off `color_pipeline_decision`
    // because that field is admin-only. `isP3Pipeline` remains the canonical
    // predicate for admin-visible color-detail surfaces.
    const consumerPaths: ReadonlyArray<readonly [name: string, path: string]> = [
        ['color-details-section.tsx', resolve(__dirname, '../components/color-details-section.tsx')],
    ];

    it.each(consumerPaths)('imports isP3Pipeline from @/lib/color-pipeline-decisions (%s)', (_name, path) => {
        const src = readFileSync(path, 'utf8');
        // Match `import { ..., isP3Pipeline, ... } from '@/lib/color-pipeline-decisions';`
        // (single or double quotes; bare or among other named imports).
        expect(src).toMatch(
            /import\s*\{[^}]*\bisP3Pipeline\b[^}]*\}\s*from\s*['"]@\/lib\/color-pipeline-decisions['"]/,
        );
    });

    it.each(consumerPaths)('contains at least one isP3Pipeline call (%s)', (_name, path) => {
        const src = readFileSync(path, 'utf8');
        // Lock that the helper is actually used after being imported.
        expect(src).toMatch(/isP3Pipeline\s*\(/);
    });

    it.each(consumerPaths)('does NOT contain inline startsWith p3-from- literal (%s)', (_name, path) => {
        const src = readFileSync(path, 'utf8');
        // Locks against re-introduction of the inline predicate at any
        // call site. The pre-C6-A1 shape was:
        //   image.color_pipeline_decision?.startsWith('p3-from-')
        // After C6-A1, the only place the literal lives is inside the
        // helper itself (`@/lib/color-pipeline-decisions`); the consumer
        // files must not re-inline it.
        expect(src).not.toMatch(/\.startsWith\(\s*['"]p3-from-['"]\s*\)/);
    });

    it.each(consumerPaths)('does NOT contain bare inline startsWith p3 literal (%s)', (_name, path) => {
        const src = readFileSync(path, 'utf8');
        // C7-A2: lock against re-introduction of the cycle-6-incomplete
        // shape. Pre-cycle-7 `color-details-section.tsx` carried a bare
        //   image.color_pipeline_decision.startsWith('p3')
        // predicate, which was functionally equivalent on every shipping
        // enum value but semantically diverged from `isP3Pipeline` (which
        // matches only `p3-from-*`). C7-A1 replaced it with the helper.
        // This lock prevents regression on every consumer of the predicate.
        expect(src).not.toMatch(/\.startsWith\(\s*['"]p3['"]\s*\)/);
    });
});

describe('download label surfaces — public-safe gamut contract', () => {
    const downloadLabelConsumers: ReadonlyArray<readonly [name: string, path: string]> = [
        ['info-bottom-sheet.tsx', resolve(__dirname, '../components/info-bottom-sheet.tsx')],
        ['photo-viewer.tsx', resolve(__dirname, '../components/photo-viewer.tsx')],
    ];

    it.each(downloadLabelConsumers)('uses getJpegDownloadCopy for JPEG download labels (%s)', (_name, path) => {
        const src = readFileSync(path, 'utf8');
        expect(src).toMatch(
            /import\s*\{[^}]*\bgetJpegDownloadCopy\b[^}]*\}\s*from\s*['"]@\/lib\/download-labels['"]/,
        );
        expect(src).toContain('getJpegDownloadCopy({ isWideGamutSource, forceSrgbDerivatives })');
    });

    it.each(downloadLabelConsumers)('does not read admin-only color_pipeline_decision for download labels (%s)', (_name, path) => {
        const src = readFileSync(path, 'utf8');
        expect(src).not.toContain('isP3Pipeline(image.color_pipeline_decision)');
    });
});
