/**
 * Run-7 cycle-2 / AGG-R7C2-02 (TE-R7C2-01): source-text contract test for the
 * BROWSER upload action's GPS-strip-on-upload guard (app/actions/images.ts).
 *
 * This is the privacy-critical guard that keeps a photographer's home GPS out
 * of the on-disk ORIGINAL (the admin-downloadable source file)
 * (PP-BUG-3). `strip_gps_on_upload` defaults to false, so this conditional is
 * the SOLE gate. The PARALLEL Lightroom path has a source-contract pin
 * (lr-upload-hdr-gate.test.ts:101-104) but the PRIMARY browser path had ZERO
 * test coverage of `uploadConfig.stripGpsOnUpload` — this closes that
 * asymmetry so a future refactor of uploadImages() that drops or relocates the
 * guard turns a test RED instead of silently leaking GPS in the on-disk original.
 *
 * Source-contract tier (matching the LR sibling): a behavioral test would need
 * to mock getGalleryConfig + saveOriginalAndGetMetadata + extractExifForDb +
 * stripGpsFromOriginal + the DB insert through the full server action — heavy
 * and brittle. The realistic regression (guard dropped/moved) is caught by the
 * import + ordering + same-block assertions below.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const IMAGES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', 'app', 'actions', 'images.ts'),
    'utf8',
);

const GUARD = 'uploadConfig.stripGpsOnUpload';

describe('uploadImages GPS-toggle wiring (AGG-R7C2-02)', () => {
    it('imports stripGpsFromOriginal from @/lib/process-image', () => {
        expect(IMAGES_SRC).toMatch(
            /import\s*\{[^}]*\bstripGpsFromOriginal\b[^}]*\}\s*from\s*['"]@\/lib\/process-image['"]/,
        );
    });

    it('calls stripGpsFromOriginal on the saved original', () => {
        expect(IMAGES_SRC).toMatch(/stripGpsFromOriginal\(/);
    });

    it('guards the GPS-original strip behind uploadConfig.stripGpsOnUpload', () => {
        const guardIndex = IMAGES_SRC.indexOf(GUARD);
        const stripIndex = IMAGES_SRC.search(/stripGpsFromOriginal\(/);
        expect(guardIndex).toBeGreaterThan(-1);
        expect(stripIndex).toBeGreaterThan(-1);
        // The strip call must appear AFTER (inside) the toggle guard so GPS is
        // only re-encoded when the admin enabled the setting — never
        // unconditionally. Parity with the Lightroom path.
        expect(stripIndex).toBeGreaterThan(guardIndex);
    });

    it('nulls exifDb.latitude/longitude AND strips the original inside the same guard block', () => {
        const guardIndex = IMAGES_SRC.indexOf(GUARD);
        expect(guardIndex).toBeGreaterThan(-1);
        // AGG-R7C2-02 REFINE (critic): do NOT use indexOf('}') to find the
        // block end — a future nested object literal or `${}` template would
        // make the first '}' close early and false-pass. Use a fixed character
        // window after the guard instead (the guarded block is a handful of
        // short statements; 400 chars comfortably covers it without reaching
        // the next unrelated statement).
        const block = IMAGES_SRC.slice(guardIndex, guardIndex + 400);
        expect(block).toMatch(/exifDb\.latitude\s*=\s*null/);
        expect(block).toMatch(/exifDb\.longitude\s*=\s*null/);
        expect(block).toMatch(/stripGpsFromOriginal\(/);
    });
});
