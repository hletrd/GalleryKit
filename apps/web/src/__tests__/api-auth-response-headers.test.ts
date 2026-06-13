import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * R4C3 SEC-R4C3-04 / TEST-R4C3-09: lock the withAdminAuth wrapper's
 * defense-in-depth response-header defaults on BOTH auth branches.
 *
 * The cookie branch gained `Cache-Control: no-store` + `Pragma` defaults in
 * C7-SEC-02; the later-added PAT token branch (US-P53) only set nosniff —
 * so the first `lr:read` route that forgot its own Cache-Control would have
 * served token-authenticated admin data cacheable by intermediaries. The
 * wrapper must apply identical defaults on both branches, while preserving
 * handler-set headers via the `has()` guard.
 */

const verifyTokenMock = vi.fn();

vi.mock('@/app/actions/auth', () => ({
    isAdmin: vi.fn(async () => true),
}));
vi.mock('next-intl/server', () => ({
    getTranslations: vi.fn(async () => (key: string) => key),
}));
vi.mock('@/lib/request-origin', () => ({
    hasTrustedSameOrigin: vi.fn(() => true),
}));
vi.mock('@/lib/admin-tokens', () => ({
    verifyToken: (...args: unknown[]) => verifyTokenMock(...args),
    tokenHasScope: (scopes: string[], required: string) => scopes.includes(required),
}));

function fakeRequest(headers: Record<string, string>): NextRequest {
    return { headers: new Headers(headers) } as unknown as NextRequest;
}

describe('withAdminAuth response-header defaults (R4C3 SEC-R4C3-04)', () => {
    beforeEach(() => {
        vi.resetModules();
        verifyTokenMock.mockReset();
    });

    async function importWrapper() {
        const { withAdminAuth } = await import('@/lib/api-auth');
        return withAdminAuth;
    }

    it('token branch: applies no-store/no-cache + Pragma + nosniff defaults', async () => {
        verifyTokenMock.mockResolvedValue({ id: 1, userId: 7, scopes: ['lr:upload'] });
        const withAdminAuth = await importWrapper();
        const wrapped = withAdminAuth(
            async (_req: NextRequest) => NextResponse.json({ ok: true }),
            { allowTokenScope: 'lr:upload' },
        );

        const response = await wrapped(fakeRequest({ 'x-gallerykit-token': 'gk_test' }));
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(response.headers.get('Pragma')).toBe('no-cache');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('token branch: preserves handler-set Cache-Control (has() guard)', async () => {
        verifyTokenMock.mockResolvedValue({ id: 1, userId: 7, scopes: ['lr:upload'] });
        const withAdminAuth = await importWrapper();
        const wrapped = withAdminAuth(
            async (_req: NextRequest) => NextResponse.json({ ok: true }, {
                headers: { 'Cache-Control': 'private, max-age=1' },
            }),
            { allowTokenScope: 'lr:upload' },
        );

        const response = await wrapped(fakeRequest({ 'x-gallerykit-token': 'gk_test' }));
        expect(response.headers.get('Cache-Control')).toBe('private, max-age=1');
        // Pragma is only defaulted alongside a defaulted Cache-Control.
        expect(response.headers.get('Pragma')).toBeNull();
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('cookie branch: applies the same defaults (C7-SEC-02 parity)', async () => {
        const withAdminAuth = await importWrapper();
        const wrapped = withAdminAuth(async (_req: NextRequest) => NextResponse.json({ ok: true }));

        const response = await wrapped(fakeRequest({ origin: 'https://gallery.test', host: 'gallery.test' }));
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(response.headers.get('Pragma')).toBe('no-cache');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('token branch: invalid token still yields a no-store 401', async () => {
        verifyTokenMock.mockResolvedValue(null);
        const withAdminAuth = await importWrapper();
        const wrapped = withAdminAuth(
            async (_req: NextRequest) => NextResponse.json({ ok: true }),
            { allowTokenScope: 'lr:upload' },
        );

        const response = await wrapped(fakeRequest({ 'x-gallerykit-token': 'gk_bad' }));
        expect(response.status).toBe(401);
        expect(response.headers.get('Cache-Control')).toContain('no-store');
    });

    it('token branch: a VERIFIED token with the WRONG scope yields a no-store 401', async () => {
        // plan-315 item 18 / TEST-R5C1-08 (pulled forward as TEST-R5C3-05): a
        // valid token whose scope set does NOT include the route's required scope
        // must be rejected — NOT fall through to the cookie path. A token bearing
        // only ['lr:read'] presented to an lr:upload route is 401, never 200.
        verifyTokenMock.mockResolvedValue({ id: 2, userId: 9, scopes: ['lr:read'] });
        const withAdminAuth = await importWrapper();
        let handlerCalled = false;
        const wrapped = withAdminAuth(
            async (_req: NextRequest) => {
                handlerCalled = true;
                return NextResponse.json({ ok: true });
            },
            { allowTokenScope: 'lr:upload' },
        );

        const response = await wrapped(fakeRequest({ 'x-gallerykit-token': 'gk_readonly' }));
        expect(response.status).toBe(401);
        expect(handlerCalled, 'handler must NOT run for a wrong-scope token').toBe(false);
        expect(response.headers.get('Cache-Control')).toContain('no-store');
    });
});
