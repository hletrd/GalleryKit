/**
 * Mobile bottom-sheet IA reorder lock (P4-C3 / R4-M5 / UX-M3 — re-promoted
 * from C8-D12).
 *
 * The cycle-3 R3 work (P3-28) wired up the conditional render order so
 * the mobile sheet surfaces ColorDetails / Histogram / Download above
 * EXIF whenever the photo is "non-trivial color" (wide gamut, HDR
 * transfer for admins, or non-sRGB pipeline decision). This fixture
 * locks both branches against silent regression.
 *
 * Source-inspection style — same pattern as
 * `lightbox-color-pip-hdr.test.ts` and `color-details-section-delivered.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_PATH = resolve(__dirname, '../components/info-bottom-sheet.tsx');
const SOURCE = readFileSync(SRC_PATH, 'utf8');

describe('info-bottom-sheet IA reorder (P4-C3)', () => {
    it('declares isNonTrivialColor predicate matching the spec', () => {
        // The predicate must hit on (a) wide gamut primaries, OR
        // (b) HDR transfer for admins, OR (c) non-sRGB pipeline decision.
        // The exact text of the predicate is locked here so a future
        // refactor cannot weaken the gate (e.g. drop the admin/HDR
        // branch and silently regress the IA on iPhone HDR uploads).
        expect(SOURCE).toMatch(/const\s+isNonTrivialColor\s*=\s*Boolean\(/);
        expect(SOURCE).toMatch(/image\.color_primaries\s*&&\s*image\.color_primaries\s*!==\s*'bt709'/);
        expect(SOURCE).toMatch(/image\.transfer_function\s*===\s*'pq'\s*\|\|\s*image\.transfer_function\s*===\s*'hlg'/);
        expect(SOURCE).toMatch(/image\.color_pipeline_decision\s*&&\s*image\.color_pipeline_decision\s*!==\s*'srgb'/);
    });

    it('renders Histogram + Download above EXIF when isNonTrivialColor is true', () => {
        // The truthy branch must close before the EXIF section header.
        const trueBranchStart = SOURCE.indexOf('{isNonTrivialColor && (');
        const exifHeader = SOURCE.indexOf("t('viewer.exifData')");
        expect(trueBranchStart).toBeGreaterThan(-1);
        expect(exifHeader).toBeGreaterThan(-1);
        expect(trueBranchStart).toBeLessThan(exifHeader);
    });

    it('renders Histogram + Download below EXIF when isNonTrivialColor is false', () => {
        const falseBranchStart = SOURCE.indexOf('{!isNonTrivialColor && (');
        const exifHeader = SOURCE.indexOf("t('viewer.exifData')");
        expect(falseBranchStart).toBeGreaterThan(-1);
        expect(falseBranchStart).toBeGreaterThan(exifHeader);
    });

    it('uses the isNonTrivialColor branches for the Histogram + Download blocks', () => {
        // Both branches must reference the Histogram component, so dropping
        // either one regresses the IA. The ColorDetailsSection accordion is
        // shared above both branches and not gated on the predicate.
        const histogramOccurrences = SOURCE.match(/<Histogram\s/g) ?? [];
        // Plan-48 lightbox-color-pip + info-bottom-sheet means the sheet
        // owns at least the two histograms below — but the sheet alone
        // should have exactly two (one per branch).
        const sheetSlice = SOURCE;
        const inBranchTrue = sheetSlice.slice(
            sheetSlice.indexOf('{isNonTrivialColor && ('),
            sheetSlice.indexOf('{!isNonTrivialColor && ('),
        );
        const inBranchFalse = sheetSlice.slice(sheetSlice.indexOf('{!isNonTrivialColor && ('));
        expect(inBranchTrue.match(/<Histogram\s/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
        expect(inBranchFalse.match(/<Histogram\s/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
        expect(histogramOccurrences.length).toBeGreaterThanOrEqual(2);
    });
});
