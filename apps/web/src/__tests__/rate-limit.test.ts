import { afterEach, describe, expect, it } from 'vitest';
import {
    buildAccountRateLimitKey,
    getClientIp,
    getTrustedProxyHopCount,
    normalizeIp,
    getRateLimitBucketStart,
    isRateLimitExceeded,
    preIncrementShareAttempt,
    pruneSearchRateLimit,
    resetSearchRateLimitPruneStateForTests,
    resetShareRateLimitForTests,
    searchRateLimit,
    SHARE_MAX_REQUESTS,
    SHARE_WINDOW_MS,
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
    resetShareRateLimitForTests();
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
    it('selects the entry appended by the single trusted proxy (append mode, default hops)', () => {
        // AGG9B-22: with one trusted append-mode proxy, the RIGHTMOST entry
        // was appended by that proxy and IS the client; anything left of it
        // is client-supplied (spoofable) and must never be selected.
        process.env.TRUST_PROXY = 'true';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10, 203.0.113.7'],
            ['x-real-ip', '203.0.113.7'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.7');
    });

    it('uses TRUSTED_PROXY_HOPS to select the entry appended by the outermost trusted proxy', () => {
        // client → cdn → nginx (hops=2): "junk, client, cdn" — the client is
        // the 2nd entry from the right (appended by the cdn), never the
        // leftmost client-supplied value.
        process.env.TRUST_PROXY = 'true';
        process.env.TRUSTED_PROXY_HOPS = '2';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10, 203.0.113.7, 192.0.2.44'],
            ['x-real-ip', '192.0.2.44'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.7');
    });

    it('selects the sole entry under the shipped overwrite-mode nginx (hops=1, one entry)', () => {
        // Shipped nginx overwrites inbound XFF with $remote_addr, so the
        // header carries exactly the client. hops=1 must select it directly
        // instead of relying on the X-Real-IP fallback.
        process.env.TRUST_PROXY = 'true';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '203.0.113.7'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.7');
    });

    it('is not shifted by attacker-prepended entries (right-anchored selection)', () => {
        process.env.TRUST_PROXY = 'true';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '10.9.9.9, 10.8.8.8, not-an-ip, 203.0.113.7'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.7');
    });

    it('falls back to x-real-ip when the trusted-slot entry does not normalize', () => {
        // Right-anchored raw indexing: if the entry at the trusted slot is
        // unparseable, fall through instead of selecting a shifted neighbor.
        process.env.TRUST_PROXY = 'true';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10, unknown'],
            ['x-real-ip', '203.0.113.9'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.9');
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

    it('R20C20: parses scientific-notation TRUSTED_PROXY_HOPS in full (1e1 -> 10, not 1)', () => {
        // parseInt('1e1', 10) === 1 silently undercounted the trusted hop chain;
        // Number('1e1') === 10 honors the operator value. Fractional/NaN values are
        // still rejected to the default by the Number.isInteger guard.
        expect(getTrustedProxyHopCount('1e1')).toBe(10);
        expect(getTrustedProxyHopCount('2.5')).toBe(1);
        expect(getTrustedProxyHopCount('abc')).toBe(1);
    });

    it('falls back to x-real-ip when forwarded-for is absent or invalid', () => {
        process.env.TRUST_PROXY = 'true';

        const headers = new Map<string, string>([
            ['x-forwarded-for', 'unknown-proxy'],
            ['x-real-ip', '203.0.113.9'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('203.0.113.9');
    });

    it('does not trust the left-most forwarded IP when the chain is shorter than TRUSTED_PROXY_HOPS', () => {
        process.env.TRUST_PROXY = 'true';
        process.env.TRUSTED_PROXY_HOPS = '2';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10'],
        ]);

        expect(getClientIp({ get: (name) => headers.get(name) ?? null })).toBe('unknown');
    });

    it('falls back to x-real-ip when the forwarded chain is shorter than TRUSTED_PROXY_HOPS', () => {
        process.env.TRUST_PROXY = 'true';
        process.env.TRUSTED_PROXY_HOPS = '2';

        const headers = new Map<string, string>([
            ['x-forwarded-for', '198.51.100.10'],
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

        // C8R-C8-01: set() now auto-enforces the hard cap, so the size should
        // already be at the limit before pruneSearchRateLimit runs.
        expect(searchRateLimit.size).toBeLessThanOrEqual(2_000);

        // pruneSearchRateLimit should still return true when forced
        expect(pruneSearchRateLimit(1_000, { force: true })).toBe(true);

        // Adding another entry should still stay within the cap
        searchRateLimit.set('overflow', { count: 1, resetAt: 10_000 });
        expect(searchRateLimit.size).toBeLessThanOrEqual(2_000);
    });
});

describe('preIncrementShareAttempt', () => {
    it('allows the configured share-key lookup budget and rejects the next request', () => {
        const now = 1_000;
        for (let i = 0; i < SHARE_MAX_REQUESTS; i++) {
            expect(preIncrementShareAttempt('203.0.113.50', now)).toBe(false);
        }

        expect(preIncrementShareAttempt('203.0.113.50', now)).toBe(true);
    });

    it('starts a fresh share-key lookup bucket after the window resets', () => {
        const now = 1_000;
        for (let i = 0; i <= SHARE_MAX_REQUESTS; i++) {
            preIncrementShareAttempt('203.0.113.51', now);
        }

        expect(preIncrementShareAttempt('203.0.113.51', now + SHARE_WINDOW_MS + 1)).toBe(false);
    });
});
