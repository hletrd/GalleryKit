/**
 * C4-A5 / C4-COL-LOW-1: lock the Source / Delivered / DeliveredFormats row
 * contract in `color-details-section.tsx`. The rows render fixed
 * translation keys; this fixture verifies the wiring so a future refactor
 * can't silently swap key names (e.g. flip `deliveredBitDepthSrgb` ↔
 * `deliveredBitDepthP3`) or remove the row gate without a test failure.
 *
 * The project convention is to use source-inspection fixtures over
 * React Testing Library for components — same pattern as
 * `images-action-blur-wiring.test.ts` and `process-image-blur-wiring.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_PATH = resolve(__dirname, '../components/color-details-section.tsx');
const SOURCE = readFileSync(SRC_PATH, 'utf8');

describe('ColorDetailsSection — delivered rows wiring (C4-A5)', () => {
    describe('Source bit depth row (C4-A2)', () => {
        it('renders viewer.sourceBitDepth label inside the accordion', () => {
            // The row uses `image.bit_depth != null && image.bit_depth > 0` as
            // its gate, with `viewer.sourceBitDepth` as the label key.
            expect(SOURCE).toMatch(/image\.bit_depth\s*!=\s*null\s*&&\s*image\.bit_depth\s*>\s*0/);
            expect(SOURCE).toContain("t('viewer.sourceBitDepth')");
        });

        it('renders the bit-depth value with `-bit` suffix', () => {
            // Format: {image.bit_depth}-bit
            expect(SOURCE).toMatch(/\{image\.bit_depth\}-bit/);
        });
    });

    describe('Delivered bit depth row (P3-5)', () => {
        it('gates on color_pipeline_decision or color_primaries presence', () => {
            expect(SOURCE).toMatch(/\(image\.color_pipeline_decision\s*\|\|\s*image\.color_primaries\)\s*&&/);
        });

        it('renders viewer.deliveredBitDepth label', () => {
            expect(SOURCE).toContain("t('viewer.deliveredBitDepth')");
        });

        it('switches between viewer.deliveredBitDepthP3 and viewer.deliveredBitDepthSrgb based on the isP3Pipeline helper', () => {
            // C7-A1 / C7-COL-MED-1 / C7-UX-MED-1 / C7-CRIT-MED-1: lock the
            // helper-call pattern instead of the inline literal. The helper
            // (`isP3Pipeline`) lives in `@/lib/color-pipeline-decisions` and
            // is locked for enum coverage by `is-p3-pipeline.test.ts`.
            //
            // Pre-cycle-7 this row used a bare `decision.startsWith('p3')`
            // predicate — functionally equivalent on every shipping enum
            // value but semantically diverging from the cycle-6 helper
            // (which matches only `p3-from-*`). C7-A1 closed the gap so all
            // four call sites of the predicate share one source of truth.
            expect(SOURCE).toMatch(
                /isP3Pipeline\s*\([\s\S]*?image\.color_pipeline_decision[\s\S]*?\)[\s\S]*?t\('viewer\.deliveredBitDepthP3'\)[\s\S]*?t\('viewer\.deliveredBitDepthSrgb'\)/,
            );
        });
    });

    describe('Delivered formats row (P3-22)', () => {
        it('gates on at least one filename being present', () => {
            expect(SOURCE).toMatch(/image\.filename_webp\s*\|\|\s*image\.filename_avif\s*\|\|\s*image\.filename_jpeg/);
        });

        it('renders viewer.deliveredFormats label', () => {
            expect(SOURCE).toContain("t('viewer.deliveredFormats')");
        });

        it('renders WebP / AVIF / JPEG chip strings only when the corresponding filename is set', () => {
            // The render uses [image.filename_webp && 'WebP', image.filename_avif && 'AVIF', image.filename_jpeg && 'JPEG'].filter(Boolean)
            expect(SOURCE).toMatch(/image\.filename_webp\s*&&\s*'WebP'/);
            expect(SOURCE).toMatch(/image\.filename_avif\s*&&\s*'AVIF'/);
            expect(SOURCE).toMatch(/image\.filename_jpeg\s*&&\s*'JPEG'/);
        });
    });

    describe('Source / Delivered ordering (C4-A2 acceptance)', () => {
        it('renders Source bit depth row BEFORE the Delivered bit depth row', () => {
            const sourceMatch = SOURCE.indexOf("t('viewer.sourceBitDepth')");
            const deliveredMatch = SOURCE.indexOf("t('viewer.deliveredBitDepth')");
            expect(sourceMatch).toBeGreaterThan(-1);
            expect(deliveredMatch).toBeGreaterThan(-1);
            // Multiple occurrences may exist across files; we look at the
            // first occurrence inside this file. The C4-A2 spec places
            // `sourceBitDepth` immediately before `deliveredBitDepth` in
            // the accordion grid.
            expect(sourceMatch).toBeLessThan(deliveredMatch);
        });
    });
});
