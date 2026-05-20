/**
 * Mobile bottom-sheet IA order lock (R10-M12, updated by R27-UX-MED-3).
 *
 * R10-M12 removed the conditional reordering based on `isNonTrivialColor`.
 * R27-UX-MED-3 promotes the histogram above the EXIF grid so it's visible
 * without scrolling past camera/lens/aperture/shutter rows on a 375 px
 * viewport. The histogram is the photographer's on-the-go color-craft
 * surface; EXIF is reference reading.
 *
 * Current ordering for ALL photos:
 * Title/tags → Color details → Wide-gamut hint → Histogram → EXIF →
 * Capture date → Download.
 *
 * Source-inspection style — same pattern as
 * `lightbox-color-pip-hdr.test.ts` and `color-details-section-delivered.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC_PATH = resolve(__dirname, '../components/info-bottom-sheet.tsx');
const SOURCE = readFileSync(SRC_PATH, 'utf8');

describe('info-bottom-sheet IA order (R10-M12)', () => {
    it('has no isNonTrivialColor conditional branches for reordering', () => {
        // R10-M12: removed conditional reordering entirely.
        // R10-L19: isNonTrivialColor may still exist for the peek-state chip.
        // Verify any isNonTrivialColor conditional is BEFORE the expanded
        // content div (i.e. in the peek section) and does NOT wrap large blocks.
        const expandedMarker = SOURCE.indexOf('max-h-[calc(95dvh-140px)]');
        const isNonTrivialIdx = SOURCE.indexOf('{isNonTrivialColor');
        expect(SOURCE).not.toMatch(/\{!isNonTrivialColor\s*&&/);
        if (isNonTrivialIdx !== -1) {
            expect(isNonTrivialIdx).toBeLessThan(expandedMarker);
        }
    });

    it('renders Histogram BEFORE EXIF section for all photos (R27-UX-MED-3)', () => {
        // R27-UX-MED-3: histogram precedes EXIF so it's visible without
        // scrolling past camera/lens/aperture/shutter on a 375 px viewport.
        const exifHeader = SOURCE.indexOf("t('viewer.exifData')");
        const histogram = SOURCE.indexOf('<Histogram');
        expect(exifHeader).toBeGreaterThan(-1);
        expect(histogram).toBeGreaterThan(-1);
        expect(histogram).toBeLessThan(exifHeader);
    });

    it('renders exactly one Histogram component', () => {
        const histogramOccurrences = SOURCE.match(/<Histogram\s/g) ?? [];
        expect(histogramOccurrences.length).toBe(1);
    });

    it('renders the consistent content order: ColorDetails → WideGamutHint → Histogram → EXIF → Capture → Download (R27-UX-MED-3)', () => {
        const colorDetails = SOURCE.indexOf('<ColorDetailsSection');
        const wideGamutHint = SOURCE.indexOf('<WideGamutHint');
        const exifHeader = SOURCE.indexOf("t('viewer.exifData')");
        const histogram = SOURCE.indexOf('<Histogram');
        const captureDate = SOURCE.indexOf("t('viewer.capturedAt')");
        const download = SOURCE.indexOf("t('viewer.downloadJpeg')");

        expect(colorDetails).toBeGreaterThan(-1);
        expect(wideGamutHint).toBeGreaterThan(-1);
        expect(exifHeader).toBeGreaterThan(-1);
        expect(histogram).toBeGreaterThan(-1);
        expect(captureDate).toBeGreaterThan(-1);
        expect(download).toBeGreaterThan(-1);

        expect(colorDetails).toBeLessThan(wideGamutHint);
        expect(wideGamutHint).toBeLessThan(histogram);
        // R27-UX-MED-3: histogram now precedes EXIF.
        expect(histogram).toBeLessThan(exifHeader);
        expect(exifHeader).toBeLessThan(captureDate);
        expect(captureDate).toBeLessThan(download);
    });
});
