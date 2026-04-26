import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 4 RPF loop AGG4-L01 / TE4-LOW-01 / V4-LOW-01.
 *
 * Lock the producer-side wiring contract that `lib/process-image.ts`
 * routes the blur data URI literal through `assertBlurDataUrl()`
 * (the write-time barrier from `lib/blur-data-url.ts`). Previously
 * only the upload action (consumer side) called the contract, leaving
 * the producer free to drift MIME without any test catching it.
 *
 * The same fixture-style shape used by
 * `images-action-blur-wiring.test.ts`: read source, walk for the
 * contract, fail loud on regression.
 */

const processImagePath = path.resolve(__dirname, '..', 'lib', 'process-image.ts');

function readSource(): string {
    return fs.readFileSync(processImagePath, 'utf8');
}

describe('process-image producer wiring: assertBlurDataUrl barrier', () => {
    it('imports assertBlurDataUrl from @/lib/blur-data-url', () => {
        const source = readSource();
        expect(source).toMatch(/import\s*\{[^}]*\bassertBlurDataUrl\b[^}]*\}\s*from\s*['"]@\/lib\/blur-data-url['"]/);
    });

    it('routes the blur data URI literal through assertBlurDataUrl()', () => {
        const source = readSource();
        // Match `blurDataUrl = assertBlurDataUrl(`. The implementation
        // builds the literal into a `candidate` local first; this
        // assertion locks the wrapped-assignment shape.
        expect(source).toMatch(/blurDataUrl\s*=\s*assertBlurDataUrl\s*\(/);
    });

    it('does NOT directly assign the unwrapped data URI literal to blurDataUrl', () => {
        const source = readSource();
        // Catch the most likely refactor regression: a future
        // contributor inlines the literal back to a direct
        // assignment, bypassing the contract. The negative
        // assertion locks the barrier path.
        expect(source).not.toMatch(/blurDataUrl\s*=\s*`data:image\/jpeg;base64,/);
    });
});
