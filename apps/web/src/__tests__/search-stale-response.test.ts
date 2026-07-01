/**
 * R4C6 COR-R4C6-07: the semantic branch of Search.performSearch awaits
 * TWICE (fetch, then resp.json()). The keyword branch re-checks the
 * request id after its await; the semantic branch only checked after
 * fetch — a slow JSON body from request A could clobber request B's
 * fresher results.
 *
 * The repo locks client-component behaviors with source contracts (no
 * jsdom render harness in the suite); this contract pins the guard's
 * existence AND its position between resp.json() and setResults.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(resolve(__dirname, '../components/search.tsx'), 'utf-8');

describe('semantic search stale-response guard (COR-R4C6-07)', () => {
    it('re-checks the request id after resp.json() and before setResults', () => {
        const jsonIdx = SRC.indexOf('await resp.json()');
        expect(jsonIdx).toBeGreaterThan(-1);
        const guardIdx = SRC.indexOf('if (requestId !== requestIdRef.current) return;', jsonIdx);
        const setIdx = SRC.indexOf('setResults(semanticResults);', jsonIdx);
        expect(guardIdx).toBeGreaterThan(jsonIdx);
        expect(setIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(setIdx);
    });

    it('the keyword branch keeps its own post-await guard', () => {
        const kwIdx = SRC.indexOf('await searchImagesAction(normalizedQuery)');
        expect(kwIdx).toBeGreaterThan(-1);
        const guardIdx = SRC.indexOf('requestId === requestIdRef.current', kwIdx);
        expect(guardIdx).toBeGreaterThan(kwIdx);
    });
});
