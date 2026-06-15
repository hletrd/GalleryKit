/**
 * clip-semantic-integration.test.ts
 *
 * Anti-vacuity smoke test: proves the real CLIP encoder (jina-clip-v2 q8,
 * Matryoshka-512) produces genuinely semantic rankings — not the sha256 stub
 * (random vectors).
 *
 * GATED: only runs when CLIP_INTEGRATION=1 is set in the environment. Default
 * CI (no model weights) skips the whole suite via describe.skip.
 *
 * Fixtures (committed by Task 14):
 *   src/__tests__/fixtures/clip/beach-sunset.jpg
 *   src/__tests__/fixtures/clip/snowy-mountain.jpg
 *   src/__tests__/fixtures/clip/city-night.jpg
 *   src/__tests__/fixtures/clip/red-flower.jpg
 *
 * Proven-separating pair (Task 14 measurement, jina-clip-v2 q8, Matryoshka-512):
 *   EN "a sunset over the ocean": beach 0.277 > snowy 0.190
 *   KO "노을 진 바다":             beach 0.295 > snowy 0.258
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';

const RUN = process.env['CLIP_INTEGRATION'] === '1';
const d = RUN ? describe : describe.skip;

d('CLIP integration — real semantic ranking (ko + en)', () => {
    it('ranks the matching fixture first for an English query', async () => {
        const { embedImageReal, embedTextReal } = await import('@/lib/clip-model');
        const { cosineSimilarity } = await import('@/lib/clip-embeddings');
        const dir = join(process.cwd(), 'src/__tests__/fixtures/clip');
        const beach = await embedImageReal(join(dir, 'beach-sunset.jpg'));
        const mountain = await embedImageReal(join(dir, 'snowy-mountain.jpg'));
        const q = await embedTextReal('a sunset over the ocean');
        const scoreBeach = cosineSimilarity(q, beach);
        const scoreMountain = cosineSimilarity(q, mountain);
        console.log(`EN beach=${scoreBeach.toFixed(4)} snowy=${scoreMountain.toFixed(4)}`);
        expect(scoreBeach).toBeGreaterThan(scoreMountain);
    }, 60_000);

    it('ranks the matching fixture first for a KOREAN query', async () => {
        const { embedImageReal, embedTextReal } = await import('@/lib/clip-model');
        const { cosineSimilarity } = await import('@/lib/clip-embeddings');
        const dir = join(process.cwd(), 'src/__tests__/fixtures/clip');
        const beach = await embedImageReal(join(dir, 'beach-sunset.jpg'));
        const mountain = await embedImageReal(join(dir, 'snowy-mountain.jpg'));
        const q = await embedTextReal('노을 진 바다');
        const scoreBeach = cosineSimilarity(q, beach);
        const scoreMountain = cosineSimilarity(q, mountain);
        console.log(`KO beach=${scoreBeach.toFixed(4)} snowy=${scoreMountain.toFixed(4)}`);
        expect(scoreBeach).toBeGreaterThan(scoreMountain);
    }, 60_000);
});
