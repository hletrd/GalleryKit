import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * R4C8 PERF-R4C8-03.
 *
 * The `type` attribute on `<link rel="preload" as="image">` only gates
 * MIME SUPPORT — it does NOT know which source the eventual <picture>
 * will select. Chromium (verified live) fetches EVERY supported-format
 * preload, so the old shape (server page hints emitting jpeg+avif+webp
 * per neighbor at a fixed 1536 px with fetchPriority=high, plus the
 * client effect emitting avif+webp) multi-fetched several large files
 * per photo view that were never rendered.
 *
 * Contract pinned here (fixture-style source scan, same shape as
 * `upload-dropzone-topic-wiring.test.ts`):
 *  1. The photo page emits NO server-side neighbor preload hints.
 *  2. The viewer effect chooses exactly ONE format per neighbor, gated
 *     on the AVIF decode probe (if/else-if chain — no unconditional
 *     dual-format emission).
 */

const pagePath = path.resolve(
    __dirname, '..', 'app', '[locale]', '(public)', 'p', '[id]', 'page.tsx',
);
const viewerPath = path.resolve(__dirname, '..', 'components', 'photo-viewer.tsx');

describe('neighbor preload single-fetch contract (R4C8 PERF-R4C8-03)', () => {
    it('p/[id]/page.tsx renders no preload <link> hints', () => {
        const source = fs.readFileSync(pagePath, 'utf8');
        expect(source).not.toMatch(/rel="preload"/);
        expect(source).not.toMatch(/preloadHints/);
        // The neighbor fetches existed only to build the hints.
        expect(source).not.toMatch(/getImageCached\(image\.prevId\)/);
        expect(source).not.toMatch(/getImageCached\(image\.nextId\)/);
    });

    it('photo-viewer preload effect is gated on the AVIF decode probe', () => {
        const source = fs.readFileSync(viewerPath, 'utf8');
        expect(source).toMatch(/getAvifSupportPromise\(\)\.then\(\s*\(avifSupported\)/);
    });

    it('photo-viewer emits at most one format per neighbor (else-if chain)', () => {
        const source = fs.readFileSync(viewerPath, 'utf8');
        expect(source).toMatch(/if \(avifSupported && baseAvif\) \{/);
        expect(source).toMatch(/\} else if \(baseWebp\) \{/);
        expect(source).toMatch(/\} else if \(baseJpeg\) \{/);
        // The regression shape: independent `if (baseAvif)` + `if (baseWebp)`
        // blocks that emit preloads unconditionally side by side.
        expect(source).not.toMatch(/^\s*if \(baseAvif\) \{/m);
        expect(source).not.toMatch(/^\s*if \(baseWebp\) \{/m);
    });
});
