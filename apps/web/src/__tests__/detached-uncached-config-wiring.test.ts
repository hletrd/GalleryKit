import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * WP19 (C2-10, run-10 cycle-2) + WP3 (C3-04, run-10 cycle-3): config resolver
 * for non-request (DETACHED) contexts.
 *
 * React's cache() de-dupes gallery-config lookups within the
 * AsyncLocalStorage store React maintains for a single request. Detached
 * background tasks — the image queue's PQueue job closures/bootstrap AND the
 * admin backfill runner's fire-and-forget runBackfill — run OUTSIDE that
 * store, so calling the cached getGalleryConfig() there risks memoizing far
 * longer than intended (e.g. a semantic_search_mode or color/quality-setting
 * flip never observed by an already-running background task; for the backfill
 * runner that silently defeats the flip-setting-then-reencode operator
 * workflow). gallery-config.ts exports an explicit uncached accessor, and
 * EVERY detached-context call site must use it.
 *
 * Source-shape pin (same idiom as image-queue-embed-wiring.test.ts): the
 * regression risk is a future call site importing getGalleryConfig again
 * without proof it runs inside a request — cycle-2 fixed image-queue and
 * missed the backfill-runner sibling one file over (ARCH3-02), so this test
 * now pins BOTH detached modules.
 */

const queueSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'image-queue.ts'), 'utf8');
const backfillSource = fs.readFileSync(
    path.join(__dirname, '..', 'lib', 'admin-backfill-runner.ts'),
    'utf8',
);
const configSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'gallery-config.ts'), 'utf8');

describe('detached modules use the uncached gallery-config accessor (C2-10 + C3-04)', () => {
    it('gallery-config.ts exports getGalleryConfigDetached', () => {
        expect(configSource).toMatch(/export const getGalleryConfigDetached/);
    });

    it('image-queue.ts imports getGalleryConfigDetached instead of the request-cached getGalleryConfig', () => {
        expect(queueSource).toMatch(/import\s*\{\s*getGalleryConfigDetached[^}]*\}\s*from\s*'@\/lib\/gallery-config'/);
        expect(queueSource).not.toMatch(/\bgetGalleryConfig\s*\(/);
    });

    it('image-queue.ts calls the uncached accessor at all three detached-context call sites', () => {
        // bootstrapMissingActiveEmbeddings, the bootstrap/legacy re-enqueue
        // config gate, and the post-processing embedding side-effect.
        const matches = queueSource.match(/await\s+getGalleryConfigDetached\s*\(\s*\)/g) ?? [];
        expect(matches.length).toBe(3);
    });

    it('admin-backfill-runner.ts imports getGalleryConfigDetached instead of the request-cached getGalleryConfig', () => {
        expect(backfillSource).toMatch(/import\s*\{\s*getGalleryConfigDetached\s*\}\s*from\s*'@\/lib\/gallery-config'/);
        expect(backfillSource).not.toMatch(/\bgetGalleryConfig\s*\(/);
    });

    it('admin-backfill-runner.ts reads config via the uncached accessor in the detached runBackfill', () => {
        const matches = backfillSource.match(/await\s+getGalleryConfigDetached\s*\(\s*\)/g) ?? [];
        expect(matches.length).toBe(1);
    });
});
