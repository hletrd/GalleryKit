import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { checkRouteSource } from '../../scripts/check-api-auth';

/**
 * C5R-RPL-05 / AGG5R-06 — fixture-based coverage for the
 * `scripts/check-api-auth.ts` scanner. Locks in the withAdminAuth wrapping
 * detection across the supported extensions Next.js 16 resolves: `.ts`,
 * `.tsx`, `.js`, `.mjs`, `.cjs`.
 */

describe('checkRouteSource — .ts route files', () => {
    it('passes when every HTTP handler is wrapped with withAdminAuth', () => {
        const src = `
            import { withAdminAuth } from '@/lib/api-auth';
            export const GET = withAdminAuth(async (req) => new Response('ok'));
            export const POST = withAdminAuth(async (req) => new Response('posted'));
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: api/admin/foo/route.ts']);
    });

    it('fails when a handler is not wrapped with withAdminAuth', () => {
        const src = `
            export const GET = async (req) => new Response('ok');
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING AUTH');
        expect(report.failed[0]).toContain('GET');
    });

    it('fails when a handler is a function declaration (must wrap as variable export)', () => {
        const src = `
            export async function POST(req) {
                return new Response('ok');
            }
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING AUTH');
        expect(report.failed[0]).toContain('POST');
    });

    it('fails when the file exports no HTTP handler at all', () => {
        const src = `
            export const HELPER = 1;
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('does not export any HTTP handlers');
    });

    it('accepts withAdminAuth wrapped in `as` type assertion', () => {
        const src = `
            import { withAdminAuth } from '@/lib/api-auth';
            export const GET = withAdminAuth(async (req) => new Response('ok')) as unknown as any;
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: api/admin/foo/route.ts']);
    });

    it('fails closed for aliased HTTP method exports', () => {
        const src = `
            import { withAdminAuth } from '@/lib/api-auth';
            const GET = withAdminAuth(async (req) => new Response('ok'));
            export { GET };
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('must export GET directly');
    });

    it('fails closed for star re-exports even when direct handlers are wrapped', () => {
        const src = `
            import { withAdminAuth } from '@/lib/api-auth';
            export const GET = withAdminAuth(async (req) => new Response('ok'));
            export * from './impl';
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('STAR RE-EXPORT');
    });

    it('fails when a local function spoofs withAdminAuth', () => {
        const src = `
            function withAdminAuth(handler) { return handler; }
            export const GET = withAdminAuth(async (req) => new Response('ok'));
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING AUTH');
    });

    it('fails when withAdminAuth is imported from an unapproved module', () => {
        const src = `
            import { withAdminAuth } from './fake-api-auth';
            export const GET = withAdminAuth(async (req) => new Response('ok'));
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.passed).toEqual([]);
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING AUTH');
    });

    it('passes when approved withAdminAuth is imported under an alias', () => {
        const src = `
            import { withAdminAuth as adminGuard } from '@/lib/api-auth';
            export const GET = adminGuard(async (req) => new Response('ok'));
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.ts');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: api/admin/foo/route.ts']);
    });
});

describe('check-api-auth CLI discovery guard', () => {
    it('fails closed when admin route discovery finds zero files', () => {
        const source = readFileSync(path.join(process.cwd(), 'scripts/check-api-auth.ts'), 'utf8');
        expect(source).toContain('No admin API route files found under');
        expect(source).toContain('process.exit(1)');
    });
});

describe('checkRouteSource — extension variants (C5R-RPL-02 / AGG5R-02)', () => {
    it('parses route.tsx files as TSX', () => {
        const src = `
            import { withAdminAuth } from '@/lib/api-auth';
            export const GET = withAdminAuth(async (req) => new Response('ok'));
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.tsx');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: api/admin/foo/route.tsx']);
    });

    it('parses route.mjs files as JS', () => {
        const src = `
            import { withAdminAuth } from '@/lib/api-auth';
            export const GET = withAdminAuth(async (req) => new Response('ok'));
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.mjs');
        expect(report.failed).toEqual([]);
        expect(report.passed).toEqual(['OK: api/admin/foo/route.mjs']);
    });

    it('parses route.cjs files as JS', () => {
        const src = `
            const { withAdminAuth } = require('@/lib/api-auth');
            const GET = withAdminAuth(async (req) => new Response('ok'));
            module.exports = { GET };
        `;
        // This pattern doesn't use ES-module export so the scanner correctly
        // reports "does not export any HTTP handlers" — the repo standard is
        // ES modules, and commonjs route files are unusual but accepted by
        // Next.js. The scanner catches the missing ESM export.
        const report = checkRouteSource(src, 'api/admin/foo/route.cjs');
        expect(report.failed).toHaveLength(1);
    });

    it('fails for route.tsx when handler omits withAdminAuth', () => {
        const src = `
            export const GET = async (req) => new Response('ok');
        `;
        const report = checkRouteSource(src, 'api/admin/foo/route.tsx');
        expect(report.failed).toHaveLength(1);
        expect(report.failed[0]).toContain('MISSING AUTH');
    });
});
