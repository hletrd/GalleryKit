import { afterEach, describe, expect, it } from 'vitest';

import { hasTrustedSameOrigin, hasTrustedSameOriginWithOptions } from '@/lib/request-origin';

const originalTrustProxy = process.env.TRUST_PROXY;

function makeHeaders(values: Record<string, string | undefined>) {
    return {
        get(name: string) {
            return values[name.toLowerCase()];
        },
    };
}

describe('hasTrustedSameOrigin', () => {
    afterEach(() => {
        if (originalTrustProxy === undefined) {
            delete process.env.TRUST_PROXY;
        } else {
            process.env.TRUST_PROXY = originalTrustProxy;
        }
    });

    it('accepts same-origin Origin headers', () => {
        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-proto': 'https',
            origin: 'https://gallery.atik.kr',
        }))).toBe(true);
    });

    it('falls back to http when proxy protocol headers are absent in local dev', () => {
        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'localhost:3000',
            origin: 'http://localhost:3000',
        }))).toBe(true);
    });

    it('accepts same-origin Referer headers when Origin is absent', () => {
        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-proto': 'https',
            referer: 'https://gallery.atik.kr/admin?from=login',
        }))).toBe(true);
    });

    it('accepts same-origin requests when the forwarded host includes the default https port', () => {
        process.env.TRUST_PROXY = 'true';

        expect(hasTrustedSameOrigin(makeHeaders({
            'x-forwarded-host': 'gallery.atik.kr:443',
            'x-forwarded-proto': 'https',
            origin: 'https://gallery.atik.kr',
        }))).toBe(true);
    });

    it('accepts same-origin requests when the forwarded host includes the default http port', () => {
        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'localhost:80',
            origin: 'http://localhost',
        }))).toBe(true);
    });

    it('rejects cross-origin requests', () => {
        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-proto': 'https',
            origin: 'https://evil.example',
        }))).toBe(false);
    });

    it('ignores spoofed forwarded headers when TRUST_PROXY is disabled', () => {
        delete process.env.TRUST_PROXY;

        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-host': 'evil.example',
            'x-forwarded-proto': 'https',
            origin: 'https://evil.example',
        }))).toBe(false);
    });

    it('trusts forwarded headers when TRUST_PROXY is enabled', () => {
        process.env.TRUST_PROXY = 'true';

        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'internal-proxy',
            'x-forwarded-host': 'gallery.atik.kr:443',
            'x-forwarded-proto': 'https',
            origin: 'https://gallery.atik.kr',
        }))).toBe(true);
    });

    it('fails closed by default when origin metadata is missing (C1R-01)', () => {
        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-proto': 'https',
        }))).toBe(false);
    });

    it('retains the explicit loose opt-in via hasTrustedSameOriginWithOptions({ allowMissingSource: true })', () => {
        expect(hasTrustedSameOriginWithOptions(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-proto': 'https',
        }), { allowMissingSource: true })).toBe(true);
    });

    it('can require explicit provenance for sensitive routes', () => {
        expect(hasTrustedSameOriginWithOptions(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-proto': 'https',
        }), { allowMissingSource: false })).toBe(false);
    });
});
