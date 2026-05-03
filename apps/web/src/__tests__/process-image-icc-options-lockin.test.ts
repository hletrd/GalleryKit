/**
 * Source-text contract tests for the post-fix ICC option shape (CM-HIGH-2,
 * CM-HIGH-1, CM-CRIT-1).
 *
 * Mirrors the existing process-image-blur-wiring.test.ts pattern: we read
 * the source as text and assert structural shapes that future refactors
 * must not silently drop.
 *
 * After PR 4 lands these tests verify:
 *   1. process-image.ts calls .withIccProfile(...) (which sets only the ICC
 *      bit, no EXIF leak).
 *   2. process-image.ts does NOT call .withMetadata({icc: ...}) for any
 *      output branch (which would re-introduce CM-HIGH-2).
 *
 * Until PR 4 lands the assertions are skipped; PR 4 un-skips them.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const processImagePath = path.resolve(__dirname, '..', 'lib', 'process-image.ts');

function readSource(): string {
    return fs.readFileSync(processImagePath, 'utf8');
}

describe('process-image ICC option lock-in (CM-CRIT-1, CM-HIGH-1, CM-HIGH-2)', () => {
    // TODO(PR4): un-skip once withIccProfile replaces withMetadata({icc:...}).
    it.skip('calls withIccProfile() at least once on the encode chain', () => {
        const source = readSource();
        // The fix replaces withMetadata({icc:...}) with withIccProfile(...).
        expect(source).toMatch(/\.withIccProfile\s*\(/);
    });

    // TODO(PR4): un-skip once withIccProfile replaces withMetadata({icc:...}).
    it.skip('does NOT call withMetadata({ icc: ... }) for any output branch', () => {
        const source = readSource();
        // Negative assertion: if withMetadata({icc:...}) shows up again,
        // CM-HIGH-2 (EXIF leak via metadata-bit-promotion) regresses.
        expect(source).not.toMatch(/\.withMetadata\s*\(\s*\{\s*icc\s*:/);
    });

    // TODO(PR4): un-skip once toColorspace() is wired into the encode chain.
    it.skip('calls toColorspace() to actually convert pixels (not just relabel)', () => {
        const source = readSource();
        // CM-CRIT-1 fix requires explicit pixel conversion via toColorspace.
        expect(source).toMatch(/\.toColorspace\s*\(/);
    });

    // TODO(PR2): un-skip once autoOrient() lands in processImageFormats.
    it.skip('still calls autoOrient() to honor EXIF orientation (CM-HIGH-4 lock-in)', () => {
        const source = readSource();
        expect(source).toMatch(/\.autoOrient\s*\(\s*\)/);
    });

    // TODO(PR2): un-skip once failOn:'error' lands on every Sharp constructor.
    it.skip('passes failOn to Sharp constructors (CM-HIGH-3 lock-in)', () => {
        const source = readSource();
        // failOn 'error' keeps benign warnings tolerable while rejecting truncated input.
        expect(source).toMatch(/failOn\s*:\s*['"]error['"]/);
    });
});
