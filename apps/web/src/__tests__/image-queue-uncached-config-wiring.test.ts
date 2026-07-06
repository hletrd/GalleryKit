import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * WP19 (C2-10, run-10 cycle-2): config resolver for non-request contexts.
 *
 * React's cache() de-dupes gallery-config lookups within the
 * AsyncLocalStorage store React maintains for a single request. The image
 * queue's PQueue job closures and background bootstrap run OUTSIDE that
 * store, so calling the cached getGalleryConfig() there risks memoizing far
 * longer than intended (e.g. a semantic_search_mode flip never observed by
 * an already-running background task). gallery-config.ts now exports an
 * explicit uncached accessor, and every detached-context call site in
 * image-queue.ts must use it instead.
 *
 * Source-shape pin (same idiom as image-queue-embed-wiring.test.ts): the
 * regression risk is a future call site importing getGalleryConfig again
 * without proof it runs inside a request.
 */

const queueSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'image-queue.ts'), 'utf8');
const configSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'gallery-config.ts'), 'utf8');

describe('WP19 (C2-10): detached queue call sites use the uncached gallery-config accessor', () => {
    it('gallery-config.ts exports getGalleryConfigUncached as a direct alias of _getGalleryConfig', () => {
        expect(configSource).toMatch(/export const getGalleryConfigUncached[^=]*=\s*_getGalleryConfig;/);
    });

    it('image-queue.ts imports getGalleryConfigUncached instead of the request-cached getGalleryConfig', () => {
        expect(queueSource).toMatch(/import\s*\{\s*getGalleryConfigUncached[^}]*\}\s*from\s*'@\/lib\/gallery-config'/);
        expect(queueSource).not.toMatch(/\bgetGalleryConfig\s*\(/);
    });

    it('calls the uncached accessor at all three detached-context call sites', () => {
        // bootstrapMissingActiveEmbeddings, the bootstrap/legacy re-enqueue
        // config gate, and the post-processing embedding side-effect.
        const matches = queueSource.match(/await\s+getGalleryConfigUncached\s*\(\s*\)/g) ?? [];
        expect(matches.length).toBe(3);
    });
});
