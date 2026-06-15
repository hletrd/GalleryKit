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
 * Why red-flower / "빨간 꽃" (re-measured 2026-06-16, jina-clip-v2 q8, Matryoshka-512):
 * the red-flower fixture is the clean argmax over ALL four fixtures in BOTH
 * languages, with a comfortable lead over the 2nd-best image:
 *   EN "a red flower":  red-flower 0.2966 > beach 0.1647 (lead 0.1319)
 *   KO "빨간 꽃":        red-flower 0.2649 > beach 0.1759 (lead 0.0890)
 * The original beach-vs-snowy KO pair separated by only 0.0013 — too thin to
 * survive model/run noise — so this assertion was hardened to argmax + a
 * ≥ 0.03 lead, which both languages clear by a wide margin.
 */

import { describe, it, expect } from 'vitest';
import { join } from 'path';

const RUN = process.env['CLIP_INTEGRATION'] === '1';
const d = RUN ? describe : describe.skip;

/** The fixture that must win, and the rest it must out-score. */
const MATCH = 'red-flower';
const OTHERS = ['beach-sunset', 'snowy-mountain', 'city-night'] as const;
/** Comfortable margin: matching fixture must beat the 2nd-best by at least this. */
const MIN_LEAD = 0.03;

/**
 * Embed the matching fixture + all others, score them against `query`, assert
 * the matching fixture is the global argmax and leads the runner-up by MIN_LEAD.
 */
async function assertArgmaxWithMargin(query: string, label: string): Promise<void> {
    const { embedImageReal, embedTextReal } = await import('@/lib/clip-model');
    const { cosineSimilarity } = await import('@/lib/clip-embeddings');
    const dir = join(process.cwd(), 'src/__tests__/fixtures/clip');

    const q = await embedTextReal(query);
    const matchScore = cosineSimilarity(q, await embedImageReal(join(dir, `${MATCH}.jpg`)));
    const otherScores = await Promise.all(
        OTHERS.map(async (name) => ({
            name,
            score: cosineSimilarity(q, await embedImageReal(join(dir, `${name}.jpg`))),
        }))
    );

    const runnerUp = otherScores.reduce((best, cur) => (cur.score > best.score ? cur : best));
    const lead = matchScore - runnerUp.score;
    const detail = otherScores.map((o) => `${o.name}=${o.score.toFixed(4)}`).join(' ');
    console.log(
        `${label} ${MATCH}=${matchScore.toFixed(4)} ${detail} lead=${lead.toFixed(4)}`
    );

    // The matching image must be the global argmax (beat every other fixture)…
    for (const o of otherScores) {
        expect(matchScore).toBeGreaterThan(o.score);
    }
    // …and by a comfortable margin over the closest non-match.
    expect(lead).toBeGreaterThanOrEqual(MIN_LEAD);
}

d('CLIP integration — real semantic ranking (ko + en)', () => {
    it('ranks the matching fixture as argmax with margin for an English query', async () => {
        await assertArgmaxWithMargin('a red flower', 'EN');
    }, 60_000);

    it('ranks the matching fixture as argmax with margin for a KOREAN query', async () => {
        await assertArgmaxWithMargin('빨간 꽃', 'KO');
    }, 60_000);
});
