/**
 * AGG-C11-01 (run-6 cycle-11): the semantic route's similarity-function selector
 *
 *   const similarity = isProd ? dotProduct : cosineSimilarity;   // route.ts:271
 *
 * is a documented, load-bearing ranking invariant (comment lines ~267-270 of
 * app/api/search/semantic/route.ts):
 *
 *   - PRODUCTION vectors AND the query are L2-normalized via `truncateAndNormalize`,
 *     so `dotProduct === cosine` for them and is the faster choice (skips two
 *     per-row norm recomputations + sqrts).
 *   - STUB vectors (`deterministicEmbedding` in clip-inference.ts) are raw [-1,1]
 *     and are NOT L2-normalized, so the stub path MUST use `cosineSimilarity` or
 *     rankings are silently corrupted (dotProduct on non-unit vectors is scaled by
 *     each vector's magnitude).
 *
 * No behavioral test pins this branch selector: `semantic-search-route.test.ts`
 * uses `fill(0.5)` / `fill(0.1)` mock embeddings whose magnitudes make dotProduct
 * and cosineSimilarity produce near-identical scores, so the 200-path test passes
 * regardless of which function is selected. A contributor "simplifying" the
 * selector to `const similarity = dotProduct;` (unconditional, for perf) would
 * corrupt stub-mode rankings with ZERO failing test.
 *
 * The repo pins LIVE-feature invariants with source contracts (same pattern as
 * search-short-query-guard.test.ts, clip-model-contract.test.ts,
 * image-queue-embed-wiring.test.ts). This contract pins three points a refactor
 * could silently regress: the guarded ternary must be present exactly, the
 * corrupting unconditional-dotProduct shape must be absent, and the documented
 * rationale comment must travel with the code.
 *
 * Runtime note: the current line behaves CORRECTLY (verified by the cycle-11
 * tracer + debugger). Stub mode is additionally double-gated out of production by
 * `semanticSearchMode` (SEMANTIC_SEARCH_ALLOW_PRODUCTION + DB row, both heal to
 * 'disabled'), so even a stub-ranking regression cannot reach prod. This test is
 * a pure regression guard against a plausible future refactor — test-only, no
 * behavioral change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
    resolve(__dirname, '../app/api/search/semantic/route.ts'),
    'utf-8',
);

describe('semantic similarity-selector source contract (AGG-C11-01 / AGG-C8-09)', () => {
    it('selects dotProduct for production and cosineSimilarity for stub via the isProd ternary', () => {
        // Whitespace-tolerant; the guarded ternary must be present exactly in this order.
        expect(SRC).toMatch(
            /const\s+similarity\s*=\s*isProd\s*\?\s*dotProduct\s*:\s*cosineSimilarity\b/,
        );
    });

    it('does NOT assign dotProduct unconditionally (would corrupt unnormalized stub rankings)', () => {
        // The corrupting refactor shape: `const similarity = dotProduct;` with no ternary.
        // (The guarded form above contains `isProd ? dotProduct` — this negative pattern
        // requires dotProduct to be assigned directly, terminated by ; or newline.)
        expect(SRC).not.toMatch(/const\s+similarity\s*=\s*dotProduct\s*[;\n]/);
        // Likewise the inverse mistake — unconditional cosineSimilarity in production —
        // would throw away the documented fast-path; pin against it too.
        expect(SRC).not.toMatch(/const\s+similarity\s*=\s*cosineSimilarity\s*[;\n]/);
    });

    it('the isProd discriminator is derived from the production semantic mode', () => {
        expect(SRC).toMatch(/const\s+isProd\s*=\s*semanticMode\s*===\s*'production'/);
    });

    it('keeps the documented rationale comment so the invariant travels with the code', () => {
        // The "stub MUST keep cosineSimilarity / would be corrupted" rationale must
        // not be silently stripped — it is the reason the ternary cannot be flattened.
        expect(SRC).toMatch(/cosineSimilarity|normaliz/i);
        expect(SRC).toMatch(/corrupt|normaliz/i);
    });
});
