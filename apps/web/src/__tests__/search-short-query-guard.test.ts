/**
 * AGG-C9-02 (run-6 cycle-9): the short-semantic-query client guard added by
 * AGG-C8-04 (search.tsx) had ZERO regression coverage — `grep invalidSemantic`
 * over the test tree was empty. The guard rejects a sub-3-codepoint semantic
 * query client-side and routes it to the `invalidSemantic` status ("at least 3
 * characters") instead of letting it reach the route, get a 400, and fall through
 * to the generic `error` status — the
 * misleading server-error UX for a user-input problem that AGG-C8-04 closed.
 *
 * The repo locks client-component behaviors with source contracts (no jsdom render
 * harness in the suite — see search-stale-response.test.ts). This contract pins the
 * three points a refactor could silently regress: the 3-codepoint minimum constant,
 * the countCodePoints comparison, and routing to `invalidSemantic` + early return
 * BEFORE the semantic fetch. It also pins en/ko key parity for the message.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(resolve(__dirname, '../components/search.tsx'), 'utf-8');
const EN = JSON.parse(readFileSync(resolve(__dirname, '../../messages/en.json'), 'utf-8'));
const KO = JSON.parse(readFileSync(resolve(__dirname, '../../messages/ko.json'), 'utf-8'));

describe('semantic short-query client guard (AGG-C9-02 / AGG-C8-04)', () => {
    it('defines the semantic minimum as 3 codepoints', () => {
        expect(SRC).toMatch(/SEMANTIC_MIN_QUERY_CODEPOINTS\s*=\s*3\b/);
    });

    it('the semantic branch compares countCodePoints against the minimum constant', () => {
        // The guard must use the code-point counter (NOT .length, which would
        // mis-count astral chars / combining marks) against the named constant.
        expect(SRC).toMatch(/countCodePoints\([^<]*\)\s*<\s*SEMANTIC_MIN_QUERY_CODEPOINTS/);
    });

    it('routes the short-query case to invalidSemantic and returns BEFORE the semantic fetch', () => {
        const guardIdx = SRC.indexOf('SEMANTIC_MIN_QUERY_CODEPOINTS');
        // Find the guard usage site (the comparison), not the constant declaration.
        const cmpIdx = SRC.search(/countCodePoints\([^<]*\)\s*<\s*SEMANTIC_MIN_QUERY_CODEPOINTS/);
        const invalidIdx = SRC.indexOf("setSearchStatus('invalidSemantic')", cmpIdx);
        const fetchIdx = SRC.indexOf("fetch('/api/search/semantic'", cmpIdx);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(cmpIdx).toBeGreaterThan(-1);
        expect(invalidIdx).toBeGreaterThan(cmpIdx);
        expect(fetchIdx).toBeGreaterThan(cmpIdx);
        // The invalidSemantic status + early return must come BEFORE the network call.
        expect(invalidIdx).toBeLessThan(fetchIdx);
        // And there must be a `return;` between the status set and the fetch.
        const returnIdx = SRC.indexOf('return;', invalidIdx);
        expect(returnIdx).toBeGreaterThan(invalidIdx);
        expect(returnIdx).toBeLessThan(fetchIdx);
    });

    it('the invalidSemantic message key exists in both locales (parity) and is non-empty', () => {
        expect(typeof EN.search?.invalidSemantic).toBe('string');
        expect(EN.search.invalidSemantic.length).toBeGreaterThan(0);
        expect(typeof KO.search?.invalidSemantic).toBe('string');
        expect(KO.search.invalidSemantic.length).toBeGreaterThan(0);
        // AGG-C8-06: the English wording must state the 3-char minimum (not the
        // 2-char keyword minimum) so it matches the route-level rejection.
        expect(EN.search.invalidSemantic).toMatch(/3|three/i);
    });
});
