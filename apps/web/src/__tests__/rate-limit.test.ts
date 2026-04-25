import { afterEach, describe, expect, it } from 'vitest';
import {
    buildAccountRateLimitKey,
    getClientIp,
    getTrustedProxyHopCount,
    normalizeIp,
    getRateLimitBucketStart,
    isRateLimitExceeded,
    pruneSearchRateLimit,
    resetSearchRateLimitPruneStateForTests,
    searchRateLimit,
    shouldWarnMissingTrustProxy,
} from '@/lib/rate-limit';

const originalTrustProxy = process.env.TRUST_PROXY;
const originalTrustedProxyHops = process.env.TRUSTED_PROXY_HOPS;

afterEach(() => {
    if (originalTrustProxy === undefined) {
        delete process.env.TRUST_PROXY;
    } else {
        process.env.TRUST_PROXY = originalTrustProxy;
    }
    if (originalTrustedProxyHops === undefined) {
        delete process.env.TRUSTED_PROXY_HOPS;
    } else {
        process.env.TRUSTED_PROXY_HOPS = originalTrustedProxyHops;
    }

    searchRateLimit.clear();
    resetSearchRateLimitPruneStateForTests();
});

describe('normalizeIp', () => {
    it('returns null for null/empty/whitespace input', () => {
        expect(normalizeIp(null)).toBeNull();
        expect(normalizeIp('')).toBeNull();
        expect(normalizeIp('   ')).toBeNull();
    });

    it('accepts valid IPv4 addresses', () => {
        expect(normalizeIp('192.168.1.1')).toBe('192.168.1.1');
        expect(normalizeIp('127.0.0.1')).toBe('127.0.0.1');
    });

    it('strips port from IPv4 addresses', () => {
        expect(normalizeIp('203.0.113.1:1234')).toBe('203.0.113.1');
    });

    it('accepts valid IPv6 addresses', () => {
        expect(normalizeIp('::1')).toBe('::1');
        expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    });

    it('strips brackets and port from IPv6 addresses', () => {
        expect(normalizeIp('[2001:db8::1]:1234')).toBe('2001:db8::1');
        expect(normalizeIp('[::1]')).toBe('::1');
    });

    it('rejects invalid IP strings', () => {
        expect(normalizeIp('not-an-ip')).toBeNull();
        expect(normalizeIp('999.999.999.999')).toBeNull();
        expect(normalizeIp('localhost')).toBeNull();
    });

    it('trims whitespace before validation', () => {
        expect(normalizeIp('  192.168.1.1  ')).toBe('192.168.1.1');
    });
});

describe('getRateLimitBucketStart', () => {
    it('aligns timestamps to the start of the current window in seconds', () => {
        const timestampMs = 1735689723456; // arbitrary fixed instant
        const windowMs = 15 * 60 * 1000;

        expect(getRateLimitBucketStart(timestampMs, windowMs)).toBe(1735689600);
    });

    it('supports small windows without fractional seconds', () => {
        expect(getRateLimitBucketStart(61_999, 60_000)).toBe(60);
        expect(getRateLimitBucketStart(120_001, 60_000)).toBe(120);
    });
});

describe('isRateLimitExceeded', () => {
    it('treats check-before-increment callers as limited at the configured maximum', () => {
        expect(isRateLimitExceeded(4, 5)).toBe(false);
        expect(isRateLimitExceeded(5, 5)).toBe(true);
    });

    it('lets pre-increment callers consume the final nominally allowed request', () => {
        expect(isRateLimitExceeded(5, 5, true)).toBe(false);
        expect(isRateLimitExceeded(6, 5, true)).toBe(true);
    });
});

describe('getClientIp', () => {
    it('uses the nearest trusted forwarded IP by default when TRUST_PROXY is enabled', () => {
        process.env.TRUST_PROXY = 'true';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10, 203.0.113.7'],
            ['x-real-ip', '203.0.113.7'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.7');
    });

    it('uses TRUSTED_PROXY_HOPS to select the client before a known trusted proxy chain', () => {
        process.env.TRUST_PROXY = 'true';
        process.env.TRUSTED_PROXY_HOPS = '2';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10, 203.0.113.7'],
            ['x-real-ip', '203.0.113.7'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('198.51.100.10');
    });

    it('falls back to one trusted hop when TRUSTED_PROXY_HOPS is invalid', () => {
        process.env.TRUST_PROXY = 'true';
        process.env.TRUSTED_PROXY_HOPS = '0';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10, 203.0.113.7'],
        ]);

        expect(getTrustedProxyHopCount()).toBe(1);
        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.7');
    });

    it('falls back to x-real-ip when forwarded-for is absent or invalid', () => {
        process.env.TRUST_PROXY = 'true';

        const headers = new Map<string, string>([
            ['x-forwarded-for', 'unknown-proxy'],
            ['x-real-ip', '203.0.113.9'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.9');
    });

    it('returns unknown when proxy headers are not trusted', () => {
        delete process.env.TRUST_PROXY;

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10'],
            ['x-real-ip', '203.0.113.9'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('unknown');
    });
});

describe('shouldWarnMissingTrustProxy', () => {
    const headers = new Map<string, string>([
        ['x-forwarded-for', '198.51.100.10'],
    ]);

    it('warns only when production traffic includes proxy headers without TRUST_PROXY enabled', () => {
        expect(shouldWarnMissingTrustProxy('production', undefined, { get: (name) => headers.get(name) ?? null })).toBe(true);
        expect(shouldWarnMissingTrustProxy('production', 'true', { get: (name) => headers.get(name) ?? null })).toBe(false);
        expect(shouldWarnMissingTrustProxy('development', undefined, { get: (name) => headers.get(name) ?? null })).toBe(false);
    });

    it('does not warn when there are no proxy headers', () => {
        expect(shouldWarnMissingTrustProxy('production', undefined, { get: () => null })).toBe(false);
    });
});

describe('buildAccountRateLimitKey', () => {
    it('returns a stable fixed-length key that fits the bucket schema', () => {
        const key = buildAccountRateLimitKey('VeryLongAdminUsernameThatStillNeedsAccountScopedThrottling123');

        expect(key).toMatch(/^acct:[a-f0-9]+$/);
        expect(key.length).toBeLessThanOrEqual(45);
        expect(key).toBe(buildAccountRateLimitKey('verylongadminusernamethatstillneedsaccountscopedthrottling123'));
    });

    it('returns distinct keys for different usernames', () => {
        expect(buildAccountRateLimitKey('alice')).not.toBe(buildAccountRateLimitKey('bob'));
    });
});

describe('pruneSearchRateLimit', () => {
    it('removes expired entries when forced', () => {
        searchRateLimit.set('expired', { count: 1, resetAt: 99 });
        searchRateLimit.set('active', { count: 1, resetAt: 200 });

        expect(pruneSearchRateLimit(100, { force: true })).toBe(true);
        expect([...searchRateLimit.keys()]).toEqual(['active']);
    });

    it('skips repeated full scans inside the throttle window when under the hard cap', () => {
        searchRateLimit.set('active', { count: 1, resetAt: 5_000 });

        expect(pruneSearchRateLimit(1_000, { force: true })).toBe(true);
        expect(pruneSearchRateLimit(1_500)).toBe(false);
        expect(searchRateLimit.has('active')).toBe(true);
    });

    it('still enforces the hard cap even inside the throttle window', () => {
        for (let i = 0; i < 2_001; i++) {
            searchRateLimit.set(`key-${i}`, { count: 1, resetAt: 10_000 });
        }

        expect(pruneSearchRateLimit(1_000, { force: true })).toBe(true);
        searchRateLimit.set('overflow', { count: 1, resetAt: 10_000 });

        expect(pruneSearchRateLimit(1_001)).toBe(true);
        expect(searchRateLimit.size).toBeLessThanOrEqual(2_000);
    });
});
