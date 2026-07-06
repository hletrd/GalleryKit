import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CR3-01 / C3-06 (run-10 c3): the similar-image route's TARGET embedding is
 * retained across a later pool query (`await db.select` for the scan rows),
 * unlike the transient per-row decodes inside the synchronous scoring
 * `.map()`. A zero-copy Float32Array view over a mysql2 wire buffer held
 * across further pool I/O couples correctness to undocumented driver
 * buffer-lifetime internals (the C1-31 coupling class) — so the retained
 * vector MUST be defensively copied at the retention site. This pin fails if
 * a future edit reverts to retaining the raw decode result.
 */

const routeSource = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'api', 'search', 'similar', '[id]', 'route.ts'),
    'utf8',
);

describe('similar route defensively copies the retained target embedding (C3-06)', () => {
    it('assigns targetEmbedding from a fresh Float32Array copy, never the raw decode', () => {
        expect(routeSource).toMatch(/targetEmbedding = new Float32Array\(decoded\);/);
        expect(routeSource).not.toMatch(/targetEmbedding = decoded;/);
    });

    it('clip-embeddings.ts documents the retention contract for future callers', () => {
        const libSource = fs.readFileSync(
            path.join(__dirname, '..', 'lib', 'clip-embeddings.ts'),
            'utf8',
        );
        expect(libSource).toContain('RETENTION CONTRACT');
        expect(libSource).toContain('MUST copy first');
    });
});
