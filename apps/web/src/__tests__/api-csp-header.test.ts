/**
 * C2-41 (run-10 c2): proxy.ts's middleware matcher excludes /api, so the
 * per-request nonce-based CSP applied by proxy.ts's applyProductionCsp/
 * withProductionCspRequest never reaches /api/* responses (JSON + the
 * Satori-rendered OG images) in production. next.config.ts headers()'s
 * catch-all '/(.*)' rule only emits Content-Security-Policy in dev, so
 * production /api/* shipped with no CSP at all. This pins the dedicated
 * non-dev '/api/:path*' rule that closes that gap, and that every other
 * header rule is unchanged.
 */
import { describe, it, expect, afterEach } from 'vitest';
import nextConfig from '../../next.config';

const API_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };

async function getHeaderRules(nodeEnv: string): Promise<HeaderRule[]> {
    const prevEnv = process.env.NODE_ENV;
    try {
        (process.env as Record<string, string>).NODE_ENV = nodeEnv;
        // headers() is typed as returning unknown-shaped Next.js header rules;
        // this suite only reads the plain { source, headers } shape it actually
        // returns.
        return (await nextConfig.headers!()) as unknown as HeaderRule[];
    } finally {
        (process.env as Record<string, string>).NODE_ENV = prevEnv ?? 'test';
    }
}

function findRule(rules: HeaderRule[], source: string): HeaderRule | undefined {
    return rules.find((rule) => rule.source === source);
}

function findHeader(rule: HeaderRule | undefined, key: string): HeaderEntry | undefined {
    return rule?.headers.find((h) => h.key === key);
}

describe('production /api/:path* CSP header (C2-41)', () => {
    afterEach(() => {
        (process.env as Record<string, string>).NODE_ENV = 'test';
    });

    it('adds the minimal API CSP rule in production', async () => {
        const rules = await getHeaderRules('production');
        const apiRule = findRule(rules, '/api/:path*');
        expect(apiRule).toBeDefined();
        expect(apiRule!.headers).toEqual([
            { key: 'Content-Security-Policy', value: API_CSP },
        ]);
    });

    it('adds the same API CSP rule under any non-dev NODE_ENV (e.g. test)', async () => {
        const rules = await getHeaderRules('test');
        const apiRule = findRule(rules, '/api/:path*');
        expect(apiRule).toBeDefined();
        expect(findHeader(apiRule, 'Content-Security-Policy')?.value).toBe(API_CSP);
    });

    it('does NOT add a dedicated /api rule in dev — the catch-all already covers it', async () => {
        const rules = await getHeaderRules('development');
        expect(findRule(rules, '/api/:path*')).toBeUndefined();
    });

    it('leaves the uploads cache-control rule unchanged', async () => {
        const rules = await getHeaderRules('production');
        const uploadsRule = findRule(rules, '/uploads/:format(jpeg|webp|avif)/:file*');
        expect(uploadsRule).toBeDefined();
        expect(uploadsRule!.headers).toEqual([
            { key: 'Cache-Control', value: 'public, max-age=3600, must-revalidate' },
        ]);
    });

    it('leaves the catch-all security headers unchanged in production (no CSP there, STS present)', async () => {
        const rules = await getHeaderRules('production');
        const catchAll = findRule(rules, '/(.*)');
        expect(catchAll).toBeDefined();
        expect(findHeader(catchAll, 'X-Content-Type-Options')?.value).toBe('nosniff');
        expect(findHeader(catchAll, 'X-Frame-Options')?.value).toBe('SAMEORIGIN');
        expect(findHeader(catchAll, 'Referrer-Policy')?.value).toBe('strict-origin-when-cross-origin');
        expect(findHeader(catchAll, 'Permissions-Policy')?.value).toContain('camera=()');
        expect(findHeader(catchAll, 'Strict-Transport-Security')?.value).toBe(
            'max-age=31536000; includeSubDomains; preload',
        );
        // Production catch-all still carries no CSP of its own — that gap is
        // covered by proxy.ts's per-request nonce CSP for non-/api routes.
        expect(findHeader(catchAll, 'Content-Security-Policy')).toBeUndefined();
    });

    it('leaves the catch-all dev CSP behavior unchanged (no STS, has CSP)', async () => {
        const rules = await getHeaderRules('development');
        const catchAll = findRule(rules, '/(.*)');
        expect(catchAll).toBeDefined();
        expect(findHeader(catchAll, 'Strict-Transport-Security')).toBeUndefined();
        expect(findHeader(catchAll, 'Content-Security-Policy')?.value).toBeTruthy();
    });

    it('returns exactly three header rules (uploads, api, catch-all) in production', async () => {
        const rules = await getHeaderRules('production');
        expect(rules).toHaveLength(3);
    });

    it('returns exactly two header rules (uploads, catch-all) in dev', async () => {
        const rules = await getHeaderRules('development');
        expect(rules).toHaveLength(2);
    });
});
