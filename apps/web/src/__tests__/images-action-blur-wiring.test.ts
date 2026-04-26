import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Cycle 3 RPF loop AGG3-L03 / TE3-LOW-02.
 *
 * Lock the wiring contract that the upload server action routes
 * incoming `blur_data_url` values through `assertBlurDataUrl()` (the
 * write-time barrier from `lib/blur-data-url.ts`). The barrier itself
 * is exercised by `__tests__/blur-data-url.test.ts` in isolation, but
 * a refactor that bypasses the barrier (e.g. inlining the value or
 * adding a parallel write path) would not be caught by either test
 * in isolation. This fixture-style scan asserts the call is present.
 *
 * The same shape used by `data-tag-names-sql.test.ts`: read source,
 * walk for the contract, fail loud on regression.
 */

const actionsPath = path.resolve(__dirname, '..', 'app', 'actions', 'images.ts');

function readSource(): string {
    return fs.readFileSync(actionsPath, 'utf8');
}

describe('upload action wiring: assertBlurDataUrl barrier', () => {
    it('imports assertBlurDataUrl from @/lib/blur-data-url', () => {
        const source = readSource();
        expect(source).toMatch(/import\s*\{[^}]*\bassertBlurDataUrl\b[^}]*\}\s*from\s*['"]@\/lib\/blur-data-url['"]/);
    });

    it('routes blur_data_url INSERT/UPDATE values through assertBlurDataUrl()', () => {
        const source = readSource();
        // Match `blur_data_url:` (the column name in the Drizzle
        // insert/update payload) followed by `assertBlurDataUrl(`. The
        // regex tolerates whitespace and an optional comment between
        // the key and the call.
        expect(source).toMatch(/blur_data_url\s*:\s*assertBlurDataUrl\s*\(/);
    });

    it('does NOT write a raw blurDataUrl value to blur_data_url', () => {
        const source = readSource();
        // Catch the most likely refactor regression: a future contributor
        // inlines the value (`blur_data_url: data.blurDataUrl`) instead of
        // wrapping it. The negative assertion locks the barrier path.
        expect(source).not.toMatch(/blur_data_url\s*:\s*data\.blurDataUrl\b/);
        expect(source).not.toMatch(/blur_data_url\s*:\s*processedImage\.blurDataUrl\b/);
    });
});
