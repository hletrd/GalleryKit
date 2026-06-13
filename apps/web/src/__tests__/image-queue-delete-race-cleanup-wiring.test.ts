/**
 * AGG-C5-T2 (run-9 c2 TE-6) — upload-queue delete-race cleanup call-path pin.
 *
 * The AGG-C4-04 fix (commit 18de78eb) made the queue worker's
 * `affectedRows===0 → "deleted during processing"` cleanup pass `[]` as the 3rd
 * `deleteImageVariants` arg, so the FULL DIRECTORY SCAN removes every
 * `{name}_{size}{ext}` variant regardless of the configured `image_sizes` list
 * (the 2-arg form only deletes the default-size filenames, orphaning non-default
 * sizes). The dir-scan contract itself is proven by
 * `process-image-variant-scan.test.ts`, but the queue worker call path is hard to
 * unit-isolate (it's inside the PQueue job), so the commit message acknowledged
 * "the contract test stands" — leaving NO test that the queue actually passes `[]`.
 *
 * A regression to the 2-arg default-sizes form would re-open the non-default-size
 * orphan leak with a green suite. This is a cheap SOURCE-SHAPE pin (same idiom as
 * images-action-blur-wiring.test.ts) that asserts the cleanup block passes the
 * `[]` dir-scan arg for all three formats.
 *
 * Proven NON-VACUOUS: removing the `, []` from any of the three calls flips the
 * corresponding assertion RED.
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const queuePath = path.resolve(__dirname, '..', 'lib', 'image-queue.ts');

function source(): string {
    return fs.readFileSync(queuePath, 'utf8');
}

describe('upload-queue delete-race cleanup wiring: [] dir-scan arg', () => {
    it('passes the [] (full dir-scan) sizes arg to deleteImageVariants for webp/avif/jpeg', () => {
        const src = source();
        // Each format's cleanup must use the 3-arg form with an EMPTY array, so
        // the directory scan removes every variant regardless of size config.
        // (`\s*` tolerates formatting; the load-bearing token is the trailing `[]`.)
        expect(
            src,
            'webp cleanup must pass [] (dir scan), not default sizes (AGG-C5-T2 / AGG-C4-04)',
        ).toMatch(/deleteImageVariants\(\s*UPLOAD_DIR_WEBP\s*,\s*[^,()]+,\s*\[\]\s*\)/);
        expect(
            src,
            'avif cleanup must pass [] (dir scan)',
        ).toMatch(/deleteImageVariants\(\s*UPLOAD_DIR_AVIF\s*,\s*[^,()]+,\s*\[\]\s*\)/);
        expect(
            src,
            'jpeg cleanup must pass [] (dir scan)',
        ).toMatch(/deleteImageVariants\(\s*UPLOAD_DIR_JPEG\s*,\s*[^,()]+,\s*\[\]\s*\)/);
    });

    it('does NOT use the 2-arg default-sizes deleteImageVariants form in the cleanup block', () => {
        const src = source();
        // The 2-arg form (no 3rd arg) defaults to DEFAULT_OUTPUT_SIZES and skips
        // the dir scan — exactly the non-default-size orphan bug. Assert none of
        // the three UPLOAD_DIR_* cleanup calls omit the sizes arg.
        expect(
            src,
            'no UPLOAD_DIR_* deleteImageVariants call may use the 2-arg (default-sizes) form',
        ).not.toMatch(/deleteImageVariants\(\s*UPLOAD_DIR_(?:WEBP|AVIF|JPEG)\s*,\s*[^,()]+\)/);
    });
});
