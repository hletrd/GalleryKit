import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const appRoot = resolve(__dirname, '..', '..');
const readApp = (rel: string) => readFileSync(resolve(appRoot, rel), 'utf8');

describe('cycle 89 color-backfill pixel-limit contracts', () => {
    it('uses the operator-tuned full-image pixel cap for sidecar detection', () => {
        const source = readApp('scripts/backfill-color-pipeline.ts');
        const detectionBlock = source.slice(
            source.indexOf('// R7-M4: re-run color detection after successful re-encode'),
            source.indexOf('const metadata = await image.metadata();', source.indexOf('// R7-M4: re-run color detection after successful re-encode')),
        );

        expect(source).toContain('MAX_INPUT_PIXELS');
        expect(detectionBlock).toContain('limitInputPixels: MAX_INPUT_PIXELS');
        expect(detectionBlock).not.toContain('256 * 1024 * 1024');
    });

    it('uses the operator-tuned full-image pixel cap for in-app runner detection', () => {
        const source = readApp('src/lib/admin-backfill-runner.ts');
        const detectionBlock = source.slice(
            source.indexOf('// Re-detect color signals from the original'),
            source.indexOf('const metadata = await image.metadata();', source.indexOf('// Re-detect color signals from the original')),
        );

        expect(source).toContain('MAX_INPUT_PIXELS');
        expect(detectionBlock).toContain('limitInputPixels: MAX_INPUT_PIXELS');
        expect(detectionBlock).not.toContain('256 * 1024 * 1024');
    });
});
