/**
 * R24-M1: per-photo OG route ascending sized-derivative fallback chain.
 *
 * Locks the post-fix contract:
 *
 *  - The route uses `pickFirstAvailablePhotoBuffer(origin, baseFilename,
 *    imageSizes)` to iterate configured sizes ascending and return the
 *    first JPEG derivative that fetches successfully under the byte cap.
 *  - On all-sizes-fail after the DB lookup, the route falls back to the
 *    site-default OG while keeping the already-charged rate-limit budget.
 *  - The route no longer pins a single `OG_PHOTO_TARGET_SIZE` constant.
 *
 * Pure source-grep fixture — no Sharp / Satori / network setup required.
 * Mirrors the existing `og-route-source-contracts.test.ts` style for the
 * collection OG route. Keeps the lineage R21-M1 / R22-M1 / R23-M1 / R24-M1
 * encoder atomic-rename fallback contract intact even if a future refactor
 * accidentally regresses to a single-shot fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { pickFirstAvailablePhotoBuffer, OG_PHOTO_TOTAL_BUDGET_MS } from '@/lib/og-photo-fetch';

const ROUTE_PATH = resolve(
    __dirname,
    '..',
    'app',
    'api',
    'og',
    'photo',
    '[id]',
    'route.tsx',
);
const source = readFileSync(ROUTE_PATH, 'utf8');

const HELPER_PATH = resolve(__dirname, '..', 'lib', 'og-photo-fetch.ts');
const helperSource = readFileSync(HELPER_PATH, 'utf8');

describe('/api/og/photo/[id] R24-M1 fallback contract (route source)', () => {
    it('imports the pickFirstAvailablePhotoBuffer helper from @/lib/og-photo-fetch', () => {
        expect(source).toContain("from '@/lib/og-photo-fetch'");
        expect(source).toContain('pickFirstAvailablePhotoBuffer');
    });

    it('GET handler invokes the helper (no single-shot fetch left)', () => {
        expect(source).toContain('pickFirstAvailablePhotoBuffer(');
        // The pre-R24-M1 single-shot pattern is gone.
        expect(source).not.toContain('OG_PHOTO_TARGET_SIZE');
        expect(source).not.toContain('findNearestImageSize');
    });

    it('rate-limit rollback exists ONLY on pre-DB validation rejections (SEC-R4C17-01)', () => {
        // SEC-R4C17-01: post-DB failure paths (!image, !fetched, catch) stay
        // CHARGED, matching the sibling /api/og route's charged-404 policy
        // (og-route-source-contracts.test.ts). The previous contract refunded
        // them, so the 30/min budget bound only for cacheable successes and
        // nonexistent-id probes got unlimited free DB lookups (enumeration
        // oracle + unmetered DB load). Rollback remains ONLY for the two
        // syntactic id-validation rejections that consumed no work.
        const rollbackOccurrences = (source.match(/rollbackOgAttempt\(ip\)/g) || []).length;
        expect(rollbackOccurrences).toBe(2);

        const dbCallIndex = source.indexOf('getImageCached(imageId)');
        expect(dbCallIndex).toBeGreaterThan(-1);
        // Both remaining rollbacks sit ABOVE the DB lookup…
        const beforeDbCall = source.slice(0, dbCallIndex);
        expect((beforeDbCall.match(/rollbackOgAttempt\(ip\)/g) || []).length).toBe(2);
        // …and NOTHING after the DB lookup refunds the attempt.
        const afterDbCall = source.slice(dbCallIndex);
        expect(afterDbCall).not.toContain('rollbackOgAttempt');

        // The all-sizes-fail fallback branch itself remains (R24-M1).
        expect(source).toContain('if (!fetched) {');
    });

    it('fallback redirects use canonical site config, not request origin', () => {
        expect(source).toContain('function buildFallbackResponse(');
        expect(source).toContain('canonicalBaseUrl: string');
        expect(source).toContain('canonicalOrigin = new URL(canonicalBaseUrl).origin');
        expect(source).toContain('url.origin === canonicalOrigin');
        expect(source).toContain('Location: `${canonicalOrigin}/`');
        expect(source).not.toContain('const reqOrigin = new URL(req.url).origin');
        expect(source).not.toContain('const origin = new URL(req.url).origin');
        expect(source).not.toContain('Location: `${origin}/`');
    });
});

describe('lib/og-photo-fetch.ts R24-M1 contract (helper source)', () => {
    it('iterates configured sizes ASCENDING (smallest first)', () => {
        expect(helperSource).toContain('sortedSizes = [...imageSizes].sort((a, b) => a - b)');
    });

    it('per-attempt AbortSignal timeout stays below the total chain budget (R20C20 PERF-C20-01)', () => {
        expect(helperSource).toContain('AbortSignal.timeout(OG_PHOTO_FETCH_TIMEOUT_MS)');
        // R20C20: per-attempt timeout lowered to 3500 ms so one hung connection
        // cannot consume the whole 10 s budget (it now leaves room for ~2 retries).
        expect(helperSource).toContain('OG_PHOTO_FETCH_TIMEOUT_MS = 3500');
        expect(OG_PHOTO_TOTAL_BUDGET_MS).toBeGreaterThan(3500);
    });

    it('applies the byte cap to both Content-Length and buffered body', () => {
        expect(helperSource).toContain("contentLength = photoRes.headers.get('Content-Length')");
        // R16C16 DBG-16-02: Content-Length pre-check is finite-guarded (a
        // non-numeric header → NaN must not slip the comparison).
        expect(helperSource).toMatch(/Number\.isFinite\(len\)\s*&&\s*len\s*>\s*OG_PHOTO_MAX_BYTES/);
        expect(helperSource).toContain('photoBuffer.length > OG_PHOTO_MAX_BYTES');
    });
});

describe('pickFirstAvailablePhotoBuffer runtime contract', () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = realFetch;
    });

    it('returns null when every size 404s', async () => {
        globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
        const result = await pickFirstAvailablePhotoBuffer(
            'http://localhost',
            'abc.jpg',
            [640, 1536, 2048],
        );
        expect(result).toBeNull();
    });

    it('returns the first successful size and skips earlier 404s', async () => {
        const calls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            calls.push(url);
            // First size (640) misses; second size (1536) returns a small JPEG-ish blob.
            if (url.includes('_640.jpg')) return new Response(null, { status: 404 });
            return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), {
                status: 200,
                headers: { 'Content-Length': '4' },
            });
        }) as typeof fetch;

        const result = await pickFirstAvailablePhotoBuffer(
            'http://localhost',
            'abc.jpg',
            [1536, 640], // intentionally unsorted to verify ascending behavior
        );
        expect(result).not.toBeNull();
        expect(result!.size).toBe(1536);
        // First attempt should be the SMALLEST size (640), then 1536.
        expect(calls[0]).toContain('_640.jpg');
        expect(calls[1]).toContain('_1536.jpg');
    });

    it('rejects oversize responses via Content-Length before buffering', async () => {
        globalThis.fetch = (async () => new Response(new Uint8Array([0xff]), {
            status: 200,
            headers: { 'Content-Length': String(2 * 1024 * 1024) }, // 2 MB > 1 MB cap
        })) as typeof fetch;

        const result = await pickFirstAvailablePhotoBuffer(
            'http://localhost',
            'abc.jpg',
            [640],
        );
        expect(result).toBeNull();
    });

    it('treats timeouts / network errors as a miss (not a throw)', async () => {
        globalThis.fetch = (async () => { throw new Error('AbortError'); }) as typeof fetch;
        const result = await pickFirstAvailablePhotoBuffer(
            'http://localhost',
            'abc.jpg',
            [640, 1536],
        );
        expect(result).toBeNull();
    });

    it('R20C20 (FINDING-1): stops starting attempts once the total budget is exhausted', async () => {
        // The 4 tests above use synchronous mocks, so Date.now() never advances and
        // the deadline check is never exercised — an inverted or deleted check stays
        // green. Drive real elapsed time with fake timers: the first attempt consumes
        // the entire budget, so the remaining 3 sizes must be skipped (not attempted).
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const calls: string[] = [];
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            calls.push(typeof input === 'string' ? input : input.toString());
            // First attempt is slow: it consumes the whole budget, then misses.
            vi.setSystemTime(OG_PHOTO_TOTAL_BUDGET_MS + 1);
            return new Response(null, { status: 404 });
        }) as typeof fetch;
        try {
            const result = await pickFirstAvailablePhotoBuffer(
                'http://localhost',
                'abc.jpg',
                [640, 1536, 2048, 4096],
            );
            expect(result).toBeNull();
            expect(calls).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

});
