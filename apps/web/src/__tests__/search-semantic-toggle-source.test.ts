import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const searchPath = path.join(process.cwd(), 'src/components/search.tsx');

describe('search semantic toggle request ownership', () => {
    it('lets the query/mode effect own semantic toggle searches', () => {
        const source = readFileSync(searchPath, 'utf8');
        const handlerStart = source.indexOf('onCheckedChange={(checked) => {');
        expect(handlerStart).toBeGreaterThan(-1);
        const handler = source.slice(handlerStart, source.indexOf('}}', handlerStart));

        expect(handler).toContain('clearSearchState()');
        expect(handler).toContain('setUseSemanticSearch(checked)');
        expect(handler.indexOf('clearSearchState()')).toBeLessThan(handler.indexOf('setUseSemanticSearch(checked)'));
        expect(handler).not.toContain('performSearch(query, checked)');
        expect(source).toContain('}, [query, useSemanticSearch, performSearch, clearSearchState]);');
    });
});
