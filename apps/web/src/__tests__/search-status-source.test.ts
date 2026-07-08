import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '../components/search.tsx'), 'utf8');

function sliceBetween(source: string, start: string, end: string): string {
    const startIndex = source.indexOf(start);
    expect(startIndex).toBeGreaterThanOrEqual(0);
    const endIndex = source.indexOf(end, startIndex + start.length);
    expect(endIndex).toBeGreaterThan(startIndex);
    return source.slice(startIndex, endIndex);
}

describe('search dialog status ownership', () => {
    it('invalidates stale search work immediately when the query changes', () => {
        const handler = sliceBetween(SOURCE, 'const handleQueryChange = useCallback', '}, []);');

        expect(handler).toContain('requestIdRef.current++');
        expect(handler).toContain('semanticAbortRef.current?.abort()');
        expect(handler).toContain('resultRefs.current = []');
        expect(handler).toContain('setLoading(false)');
        expect(handler).toContain('setResults([])');
        expect(handler).toContain('setSearchStatus(null)');
        expect(handler).toContain("setSettledQuery('')");
        expect(SOURCE).toContain('onChange={(e) => handleQueryChange(e.target.value)}');
    });

    it('renders results and terminal status only for the query that settled', () => {
        expect(SOURCE).toContain('const [settledQuery, setSettledQuery] = useState');
        expect(SOURCE).toContain('const hasSettledCurrentQuery = trimmedQuery.length > 0 && settledQuery === trimmedQuery');
        expect(SOURCE).toContain('const hasDisplayedResults = hasSettledCurrentQuery && results.length > 0');
        expect(SOURCE).toContain('aria-describedby={hasDisplayedResults ?');
        expect(SOURCE).toContain("aria-controls={hasDisplayedResults ? 'search-results' : undefined}");
        expect(SOURCE).not.toContain("aria-controls={hasDisplayedResults ? 'search-results' : 'search-dialog'}");
        expect(SOURCE).toContain('aria-expanded={isOpen}');
        expect(SOURCE).not.toContain('aria-expanded={hasDisplayedResults}');
        expect(SOURCE).toContain('{hasDisplayedResults ? (');
        expect(SOURCE).toContain(') : trimmedQuery ? (');
    });

    it('uses one live announcement source per search state', () => {
        const liveExpression = sliceBetween(
            SOURCE,
            'const liveSearchStatusMessage = loading',
            'const visibleSearchStatusMessage',
        );
        const visibleExpression = sliceBetween(
            SOURCE,
            'const visibleSearchStatusMessage = !loading',
            'const dialog =',
        );

        expect(liveExpression).toContain("t('search.searching')");
        expect(liveExpression).toContain("t('search.resultsCount'");
        expect(liveExpression).not.toContain('searchStatus');
        expect(liveExpression).not.toContain("t('search.noResults')");

        expect(visibleExpression).toContain('searchStatus');
        expect(visibleExpression).toContain("t('search.noResults')");
        expect(SOURCE).toContain('{liveSearchStatusMessage}');
        expect(SOURCE).toContain('role="status" aria-live="polite" aria-atomic="true"');
        expect(SOURCE).toContain('aria-hidden="true"');
        expect(SOURCE).not.toContain("role=\"status\" aria-label={t('common.loading')}");
    });

    it('uses platform-neutral keyboard shortcut copy', () => {
        expect(SOURCE).not.toContain('navigator.platform');
        expect(SOURCE).not.toContain('isMac');
        expect(SOURCE).toContain('Ctrl/&#8984; K');
        expect(SOURCE).toContain("{t('search.toggleHint')}");
    });
});
