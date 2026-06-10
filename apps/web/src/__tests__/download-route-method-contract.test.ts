import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * R4C7 COR-R4C7-01 / COR-R4C7-02: method contract for the paid-download
 * route.
 *
 * Next.js auto-implements HEAD for GET-only routes by INVOKING the GET
 * handler (`methods.HEAD = handlers.GET` in
 * next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js),
 * and mail-security gateways fetch emailed links with GET. While the
 * single-use claim lived on GET, both burned the customer's paid token
 * with zero bytes delivered.
 *
 * Contract pinned here (fixture-style source scan, same shape as
 * `sw-template-contract.test.ts` / `backup-download-route.test.ts`):
 *   1. GET is claim-free (no entitlements UPDATE, no downloadedAt write,
 *      no fs access) — which also makes the framework's auto-HEAD safe.
 *   2. POST exists and is the ONLY place performing the atomic claim.
 *   3. POST keeps the open-before-claim ordering (C3-RPF-05 / R4C4-06).
 *   4. The file carries the documented rate-limit exemption tag.
 *   5. The interstitial GET ships its own restrictive CSP (API routes
 *      bypass the proxy-middleware CSP).
 */

const routePath = path.resolve(
    __dirname, '..', 'app', 'api', 'download', '[imageId]', 'route.ts',
);

function readSource(): string {
    return fs.readFileSync(routePath, 'utf8');
}

/** Extract the body of an exported async handler (balanced-ish slice: from
 *  the export to the next `export` keyword or EOF). Good enough for
 *  contract scanning — handlers are top-level and ordered. */
function sectionOf(source: string, method: 'GET' | 'POST'): string {
    const start = source.indexOf(`export async function ${method}(`);
    expect(start, `route must export async function ${method}`).toBeGreaterThanOrEqual(0);
    const rest = source.slice(start);
    const next = rest.slice(1).search(/\nexport\s/);
    return next === -1 ? rest : rest.slice(0, next + 1);
}

describe('download route method contract (R4C7 COR-R4C7-01/02)', () => {
    it('exports GET and POST handlers', () => {
        const source = readSource();
        expect(source).toMatch(/export async function GET\(/);
        expect(source).toMatch(/export async function POST\(/);
    });

    it('GET performs NO single-use claim and NO fs access (auto-HEAD therefore safe)', () => {
        const get = sectionOf(readSource(), 'GET');
        expect(get).not.toMatch(/downloadedAt\s*:/);          // no claim payload
        expect(get).not.toMatch(/\.update\s*\(\s*entitlements/); // no entitlements UPDATE
        expect(get).not.toMatch(/\b(lstat|realpath|open|createReadStream)\s*\(/); // no fs
    });

    it('POST is the only handler containing the atomic claim, with open-before-claim ordering', () => {
        const source = readSource();
        const post = sectionOf(source, 'POST');
        // Claim present in POST…
        expect(post).toMatch(/\.update\s*\(\s*entitlements\s*\)/);
        expect(post).toMatch(/downloadedAt\s*:\s*sql`NOW\(\)`/);
        // …exactly once in the whole file (no second claim path).
        expect(source.match(/downloadedAt\s*:\s*sql`NOW\(\)`/g)).toHaveLength(1);
        // C3-RPF-05 / R4C4 COR-R4C4-06 ordering: the validated open()
        // happens BEFORE the claim UPDATE inside POST.
        const openIdx = post.search(/await open\s*\(/);
        const claimIdx = post.search(/\.update\s*\(\s*entitlements\s*\)/);
        expect(openIdx).toBeGreaterThan(-1);
        expect(claimIdx).toBeGreaterThan(openIdx);
    });

    it('both methods share the validation helper (uniform 400/403/404/410 taxonomy)', () => {
        const source = readSource();
        expect(sectionOf(source, 'GET')).toMatch(/validateDownloadRequest\(/);
        expect(sectionOf(source, 'POST')).toMatch(/validateDownloadRequest\(/);
    });

    it('carries the documented public-route rate-limit exemption', () => {
        expect(readSource()).toMatch(/@public-no-rate-limit-required:/);
    });

    it('interstitial GET ships its own restrictive CSP (API routes bypass middleware CSP)', () => {
        const get = sectionOf(readSource(), 'GET');
        expect(get).toMatch(/'Content-Security-Policy':\s*\n?\s*"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"/);
        expect(get).toMatch(/'X-Robots-Tag':\s*'noindex, nofollow'/);
    });
});
