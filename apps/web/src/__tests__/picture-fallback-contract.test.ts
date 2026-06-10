import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * R4C8 COR-R4C8-04 + COR-R4C8-05.
 *
 * 05: a bare `img.src = base` swap inside a <picture> cannot recover
 * from a 404ing sized derivative — mutating src re-runs the HTML
 * image-selection algorithm, which re-picks the matching <source>
 * (verified live: currentSrc stayed on the 404 AVIF, naturalWidth 0).
 * The fallback must be STATE-driven: drop the <source> rows, then point
 * the <img> at the base JPEG (verified live: currentSrc recovers).
 *
 * 04: the histogram draw effect must depend on `canvasDims` — assigning
 * canvas width/height attributes clears the drawing buffer, so crossing
 * the 768 px breakpoint blanked the histogram with no redraw.
 *
 * Fixture-style source pins (same convention as
 * `upload-dropzone-topic-wiring.test.ts`).
 */

const lightboxPath = path.resolve(__dirname, '..', 'components', 'lightbox.tsx');
const viewerPath = path.resolve(__dirname, '..', 'components', 'photo-viewer.tsx');
const histogramPath = path.resolve(__dirname, '..', 'components', 'histogram.tsx');

describe('picture sized-derivative fallback is state-driven (R4C8 COR-R4C8-05)', () => {
    for (const [name, file] of [['lightbox', lightboxPath], ['photo-viewer', viewerPath]] as const) {
        it(`${name} declares sizedSourcesFailed state and resets it per photo`, () => {
            const source = fs.readFileSync(file, 'utf8');
            expect(source).toMatch(/const \[sizedSourcesFailed, setSizedSourcesFailed\] = useState\(false\)/);
            expect(source).toMatch(/setSizedSourcesFailed\(false\)/);
        });

        it(`${name} onError flips the state instead of swapping img.src in place`, () => {
            const source = fs.readFileSync(file, 'utf8');
            expect(source).toMatch(/setSizedSourcesFailed\(true\)/);
            // The regression shape: assigning the base URL onto the live
            // element while <source> siblings still exist. Scope the scan to
            // the <picture> JSX region — photo-viewer's plain next/image
            // branch legitimately keeps the in-place swap (no <source>
            // siblings). lastIndexOf skips prose mentions of "<picture>"
            // inside comments earlier in the file.
            const pictureStart = source.lastIndexOf('<picture');
            expect(pictureStart).toBeGreaterThan(0);
            const pictureEnd = source.indexOf('</picture>', pictureStart);
            expect(pictureEnd).toBeGreaterThan(pictureStart);
            const pictureRegion = source.slice(pictureStart, pictureEnd);
            expect(pictureRegion).not.toMatch(/\.src = jpegBaseSrc/);
            expect(pictureRegion).toMatch(/setSizedSourcesFailed\(true\)/);
        });

        it(`${name} drops the <source> rows once the state is set`, () => {
            const source = fs.readFileSync(file, 'utf8');
            expect(source).toMatch(/!sizedSourcesFailed &&|sizedSourcesFailed && jpegBaseSrc/);
        });
    }
});

describe('histogram redraw on canvas dimension change (R4C8 COR-R4C8-04)', () => {
    it('the draw effect dependency array includes canvasDims', () => {
        const source = fs.readFileSync(histogramPath, 'utf8');
        expect(source).toMatch(/\[histogramData, mode, collapsed, isDark, canvasDims\]/);
    });
});
