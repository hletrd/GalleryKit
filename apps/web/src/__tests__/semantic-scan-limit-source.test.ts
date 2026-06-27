/**
 * Cycle-17 TE gap: SEMANTIC_SCAN_LIMIT hard cap not source-pinned.
 *
 * The semantic search route applies `.limit(SEMANTIC_SCAN_LIMIT)` to the
 * embedding DB scan so a natural-language query never reads more than 2000
 * rows on a large database (CLAUDE.md "Runtime limits"). The mock-based
 * route tests (semantic-search-route.test.ts) intercept the DB call but do
 * NOT assert the limit value — removing `.limit(SEMANTIC_SCAN_LIMIT)` from
 * the route would allow an unbounded vector scan but all prior tests would
 * still pass.
 *
 * This source-contract test makes a removal detectable at `npm test`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROUTE_SRC = readFileSync(
    resolve(__dirname, '../app/api/search/semantic/route.ts'),
    'utf8',
);

describe('semantic route SEMANTIC_SCAN_LIMIT source contract (cycle-17 TE gap)', () => {
    it('imports SEMANTIC_SCAN_LIMIT from the clip-embeddings module', () => {
        // The constant must be imported (not inlined as a magic number) so the
        // single authoritative definition in clip-embeddings.ts controls both
        // the runtime cap and the CLAUDE.md documentation value.
        expect(ROUTE_SRC).toMatch(
            /import\s*\{[^}]*\bSEMANTIC_SCAN_LIMIT\b[^}]*\}\s*from\s*['"]@\/lib\/clip-embeddings['"]/,
        );
    });

    it('applies .limit(SEMANTIC_SCAN_LIMIT) to the embedding DB scan query', () => {
        // Without this limit, every semantic search reads ALL embedding rows —
        // O(n) memory + CPU on every query. Removing the call would regress
        // the runtime cap silently without breaking any mock-based route test.
        expect(ROUTE_SRC).toMatch(/\.limit\(\s*SEMANTIC_SCAN_LIMIT\s*\)/);
    });
});
