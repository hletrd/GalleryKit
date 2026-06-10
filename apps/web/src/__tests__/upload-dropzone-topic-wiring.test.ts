import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * R4C7 COR-R4C7-04.
 *
 * The upload dropzone's topic <select> stays interactive during a batch
 * upload, and the surface's documented contract (the tag refs) is
 * latest-wins: edits made mid-batch apply to files not yet uploaded.
 * The topic used to be read from the click-time closure instead — a
 * mid-batch topic correction was silently ignored while tag edits on
 * the very same surface applied.
 *
 * This fixture-style scan (same shape as
 * `images-action-blur-wiring.test.ts` / `data-tag-names-sql.test.ts`)
 * pins the wiring: the upload loop must read the topic through
 * `topicRef.current`, and the ref must be kept in sync from state.
 * Driving the full dropzone + sonner + router stack through jsdom is
 * brittle; the wiring contract is what regressed-by-refactor would
 * break, so that is what gets locked.
 */

const dropzonePath = path.resolve(__dirname, '..', 'components', 'upload-dropzone.tsx');

function readSource(): string {
    return fs.readFileSync(dropzonePath, 'utf8');
}

describe('upload-dropzone topic wiring: latest-wins via ref (R4C7 COR-R4C7-04)', () => {
    it('declares a topicRef seeded from topic state', () => {
        const source = readSource();
        expect(source).toMatch(/const\s+topicRef\s*=\s*useRef\s*\(\s*topic\s*\)/);
    });

    it('keeps topicRef in sync with topic state via an effect', () => {
        const source = readSource();
        expect(source).toMatch(/useEffect\s*\(\s*\(\)\s*=>\s*\{\s*topicRef\.current\s*=\s*topic\s*;?\s*\}\s*,\s*\[\s*topic\s*\]\s*\)/);
    });

    it('appends the topic to upload FormData through topicRef.current (not the closure)', () => {
        const source = readSource();
        expect(source).toMatch(/formData\.append\(\s*['"]topic['"]\s*,\s*topicRef\.current\s*\)/);
        // The closure-read regression shape must not come back.
        expect(source).not.toMatch(/formData\.append\(\s*['"]topic['"]\s*,\s*topic\s*\)/);
    });
});
