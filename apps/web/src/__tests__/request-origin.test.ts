import { describe, expect, it } from 'vitest';

import { hasTrustedSameOrigin } from '@/lib/request-origin';

function makeHeaders(values: Record<string, string | undefined>) {
    return {
        get(name: string) {
            return values[name.toLowerCase()];
        },
    };
}

describe('hasTrustedSameOrigin', () => {
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

    it('allows trusted requests without origin metadata as a compatibility fallback', () => {
        expect(hasTrustedSameOrigin(makeHeaders({
            host: 'gallery.atik.kr',
            'x-forwarded-proto': 'https',
        }))).toBe(true);
    });
});
