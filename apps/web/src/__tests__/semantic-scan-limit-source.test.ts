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
 * Cycle-22 TE gap: the similar/[id] route uses the same cap but was not
 * source-pinned. The mock-based similar-route.test.ts never asserts the
 * .limit() call, so removing it from the similar route would go undetected.
 *
 * This source-contract test makes a removal detectable at `npm test`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SEMANTIC_ROUTE_SRC = readFileSync(
    resolve(__dirname, '../app/api/search/semantic/route.ts'),
    'utf8',
);

const SIMILAR_ROUTE_SRC = readFileSync(
    resolve(__dirname, '../app/api/search/similar/[id]/route.ts'),
    'utf8',
);

const SEARCH_COMPONENT_SRC = readFileSync(
    resolve(__dirname, '../components/search.tsx'),
    'utf8',
);

const CLIP_CONSTANTS_SRC = readFileSync(
    resolve(__dirname, '../lib/clip-embedding-constants.ts'),
    'utf8',
);

describe('semantic route SEMANTIC_SCAN_LIMIT source contract (cycle-17 TE gap)', () => {
    it('imports SEMANTIC_SCAN_LIMIT from the clip-embeddings module', () => {
        // The constant must be imported (not inlined as a magic number) so the
        // single authoritative definition in clip-embeddings.ts controls both
        // the runtime cap and the CLAUDE.md documentation value.
        expect(SEMANTIC_ROUTE_SRC).toMatch(
            /import\s*\{[^}]*\bSEMANTIC_SCAN_LIMIT\b[^}]*\}\s*from\s*['"]@\/lib\/clip-embeddings['"]/,
        );
    });

    it('applies .limit(SEMANTIC_SCAN_LIMIT) to the embedding DB scan query', () => {
        // Without this limit, every semantic search reads ALL embedding rows —
        // O(n) memory + CPU on every query. Removing the call would regress
        // the runtime cap silently without breaking any mock-based route test.
        expect(SEMANTIC_ROUTE_SRC).toMatch(/\.limit\(\s*SEMANTIC_SCAN_LIMIT\s*\)/);
    });
});

describe('similar/[id] route SEMANTIC_SCAN_LIMIT source contract (cycle-22 TE gap)', () => {
    it('imports SEMANTIC_SCAN_LIMIT from the clip-embeddings module', () => {
        // The similar-image route performs the same brute-force vector scan as
        // the semantic search route. Its mock-based tests (similar-route.test.ts)
        // never assert the .limit() value, so this source pin is the only gate
        // preventing an accidental removal of the cap on the similar route.
        expect(SIMILAR_ROUTE_SRC).toMatch(
            /import\s*\{[^}]*\bSEMANTIC_SCAN_LIMIT\b[^}]*\}\s*from\s*['"]@\/lib\/clip-embeddings['"]/,
        );
    });

    it('applies .limit(SEMANTIC_SCAN_LIMIT) to the embedding DB scan query', () => {
        // Removing .limit(SEMANTIC_SCAN_LIMIT) from similar/[id]/route.ts
        // would allow the image-similarity scan to read all rows with no cap,
        // but no existing behavioral test would catch the regression.
        expect(SIMILAR_ROUTE_SRC).toMatch(/\.limit\(\s*SEMANTIC_SCAN_LIMIT\s*\)/);
    });
});

describe('client-safe semantic constants', () => {
    it('keeps the search client off server-oriented embedding helpers', () => {
        expect(SEARCH_COMPONENT_SRC).toContain("from '@/lib/clip-embedding-constants'");
        expect(SEARCH_COMPONENT_SRC).not.toContain("from '@/lib/clip-embeddings'");
    });

    it('keeps the client-safe constant module free of server-only APIs', () => {
        expect(CLIP_CONSTANTS_SRC).not.toMatch(/\bprocess\b/);
        expect(CLIP_CONSTANTS_SRC).not.toMatch(/\bBuffer\b/);
        expect(CLIP_CONSTANTS_SRC).not.toMatch(/from ['"](?:fs|node:fs|path|node:path|@\/db|server-only)/);
    });
});
