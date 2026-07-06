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
        // WP12 / CRIT3-06 (run-10 c3): assert the load-bearing header, not
        // the exact header ARRAY — an unrelated future header on this rule
        // must not fail a CSP contract.
        expect(findHeader(apiRule, 'Content-Security-Policy')?.value).toBe(API_CSP);
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
        expect(findHeader(uploadsRule, 'Cache-Control')?.value).toBe(
            'public, max-age=3600, must-revalidate',
        );
        // The derivative rule must never regain immutable (in-place backfill
        // re-encode hazard) — the load-bearing negative, without pinning the
        // whole header array.
        expect(findHeader(uploadsRule, 'Cache-Control')?.value).not.toContain('immutable');
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

    // WP12 / CRIT3-06 (run-10 c3): the exact-rule-COUNT pins ("exactly three
    // in production, two in dev") were an ossification tax — ANY future
    // headers() rule would fail a CSP test that has nothing to do with it.
    // The load-bearing shape is: the three known rules exist where expected
    // and the dedicated /api rule is production-only (asserted above).
    it('keeps the three known rules present in production (no count pin)', async () => {
        const rules = await getHeaderRules('production');
        expect(findRule(rules, '/uploads/:format(jpeg|webp|avif)/:file*')).toBeDefined();
        expect(findRule(rules, '/api/:path*')).toBeDefined();
        expect(findRule(rules, '/(.*)')).toBeDefined();
    });
});
