import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(resolve(__dirname, '../components/similar-photos.tsx'), 'utf8');

describe('SimilarPhotos fetch cancellation contract', () => {
    it('aborts in-flight similar-photo requests when the disclosure closes', () => {
        expect(SOURCE).toContain('const openRef = useRef(false)');
        expect(SOURCE).toContain('const requestIdRef = useRef(0)');
        expect(SOURCE).toContain('if (!nextOpen) {');
        expect(SOURCE).toContain('abortRef.current.abort()');
        expect(SOURCE).toContain('fetchedRef.current = false');
        expect(SOURCE).toContain('requestIdRef.current += 1');
        expect(SOURCE).toContain('setLoading(false)');
        expect(SOURCE).toMatch(/fetch\(\s*`\/api\/search\/similar\/\$\{imageId\}`\s*,\s*\{\s*signal:\s*controller\.signal\s*\}\s*\)/);
    });

    it('guards late fetch responses against closed or stale requests', () => {
        expect(SOURCE).toContain('const isCurrentOpenRequest = () => (');
        expect(SOURCE).toContain('mountedRef.current');
        expect(SOURCE).toContain('openRef.current');
        expect(SOURCE).toContain('requestIdRef.current === requestId');
        expect(SOURCE).toContain('abortRef.current === controller');
        expect(SOURCE).toContain('if (isCurrentOpenRequest()) setResults(json.results ?? [])');
        expect(SOURCE).toContain('if (mountedRef.current && openRef.current && requestIdRef.current === requestId) setLoading(false)');
    });

    it('re-arms the mount guard when Strict Effects replays setup', () => {
        const setupIndex = SOURCE.indexOf('mountedRef.current = true', SOURCE.indexOf('useEffect(() => {'));
        const cleanupIndex = SOURCE.indexOf('mountedRef.current = false', setupIndex);
        expect(setupIndex).toBeGreaterThan(-1);
        expect(cleanupIndex).toBeGreaterThan(setupIndex);
    });
});
