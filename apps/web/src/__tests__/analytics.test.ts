import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock isbot and geoip-lite before importing analytics.ts
// ---------------------------------------------------------------------------
vi.mock('isbot', () => ({
    isbot: (ua: string) => /bot|crawler|spider|googlebot|bingbot|slurp/i.test(ua),
}));

vi.mock('geoip-lite', () => ({
    default: {
        lookup: (ip: string) => {
            const map: Record<string, { country: string }> = {
                '8.8.8.8': { country: 'US' },
                '1.1.1.1': { country: 'AU' },
                '203.0.113.1': { country: 'XX' },
            };
            return map[ip] ?? null;
        },
    },
    lookup: (ip: string) => {
        const map: Record<string, { country: string }> = {
            '8.8.8.8': { country: 'US' },
            '1.1.1.1': { country: 'AU' },
        };
        return map[ip] ?? null;
    },
}));

vi.mock('@/site-config.json', () => ({
    default: {
        url: 'https://gallery.example.com',
        title: 'My Gallery',
    },
}));

import { sanitizeReferrerHost, extractTldPlusOne, isBot, lookupCountry } from '@/lib/analytics';

// ---------------------------------------------------------------------------
// extractTldPlusOne
// ---------------------------------------------------------------------------
describe('extractTldPlusOne', () => {
    it('returns bare domain unchanged', () => {
        expect(extractTldPlusOne('github.com')).toBe('github.com');
    });

    it('strips subdomain from standard domain', () => {
        expect(extractTldPlusOne('www.github.com')).toBe('github.com');
        expect(extractTldPlusOne('sub.example.org')).toBe('example.org');
    });

    it('handles three-part TLD (co.uk)', () => {
        expect(extractTldPlusOne('sub.bbc.co.uk')).toBe('bbc.co.uk');
        expect(extractTldPlusOne('bbc.co.uk')).toBe('bbc.co.uk');
    });

    it('handles com.au', () => {
        expect(extractTldPlusOne('www.domain.com.au')).toBe('domain.com.au');
    });

    it('handles single label', () => {
        expect(extractTldPlusOne('localhost')).toBe('localhost');
    });
});

// ---------------------------------------------------------------------------
// sanitizeReferrerHost
// ---------------------------------------------------------------------------
describe('sanitizeReferrerHost', () => {
    it('returns direct for null/undefined/empty', () => {
        expect(sanitizeReferrerHost(null)).toBe('direct');
        expect(sanitizeReferrerHost(undefined)).toBe('direct');
        expect(sanitizeReferrerHost('')).toBe('direct');
        expect(sanitizeReferrerHost('   ')).toBe('direct');
    });

    it('returns direct for non-URL strings', () => {
        expect(sanitizeReferrerHost('not-a-url')).toBe('direct');
        expect(sanitizeReferrerHost('ftp://example.com')).toBe('direct');
    });

    it('extracts TLD+1 from a normal referrer', () => {
        expect(sanitizeReferrerHost('https://www.github.com/foo/bar')).toBe('github.com');
        expect(sanitizeReferrerHost('http://news.ycombinator.com/item?id=123')).toBe('ycombinator.com');
    });

    it('strips port from host', () => {
        // New URL() parses port separately; hostname never includes port
        expect(sanitizeReferrerHost('https://example.com:8080/path')).toBe('example.com');
    });

    it('returns direct for private IPs', () => {
        expect(sanitizeReferrerHost('http://192.168.1.1/page')).toBe('direct');
        expect(sanitizeReferrerHost('http://10.0.0.1/page')).toBe('direct');
        expect(sanitizeReferrerHost('http://172.16.0.1/page')).toBe('direct');
        expect(sanitizeReferrerHost('http://127.0.0.1/page')).toBe('direct');
    });

    it('returns direct for .onion addresses', () => {
        expect(sanitizeReferrerHost('http://facebookwkhpilnemxj7ascrwwwwkm5o6j.onion/')).toBe('direct');
    });

    it('returns direct for localhost', () => {
        expect(sanitizeReferrerHost('http://localhost:3000/page')).toBe('direct');
    });

    it('returns self for same-origin referrer', () => {
        expect(sanitizeReferrerHost('https://gallery.example.com/p/42')).toBe('self');
        expect(sanitizeReferrerHost('https://gallery.example.com/')).toBe('self');
    });

    it('normalizes to lowercase', () => {
        expect(sanitizeReferrerHost('https://WWW.GOOGLE.COM/search')).toBe('google.com');
    });

    it('handles co.uk two-part TLD', () => {
        expect(sanitizeReferrerHost('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
    });

    it('returns direct for IPv6 loopback', () => {
        expect(sanitizeReferrerHost('http://[::1]/page')).toBe('direct');
    });
});

// ---------------------------------------------------------------------------
// isBot
// ---------------------------------------------------------------------------
describe('isBot', () => {
    it('returns false for null/undefined', () => {
        expect(isBot(null)).toBe(false);
        expect(isBot(undefined)).toBe(false);
        expect(isBot('')).toBe(false);
    });

    it('detects Googlebot', () => {
        expect(isBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    });

    it('detects generic crawler', () => {
        expect(isBot('MyCrawler/1.0')).toBe(true);
    });

    it('returns false for real browser UA', () => {
        expect(isBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// lookupCountry
// ---------------------------------------------------------------------------
describe('lookupCountry', () => {
    beforeEach(() => {
        // Reset the module-level geoLookup cache between tests
        vi.resetModules();
    });

    it('returns XX for null/undefined/empty IP', () => {
        expect(lookupCountry(null)).toBe('XX');
        expect(lookupCountry(undefined)).toBe('XX');
        expect(lookupCountry('')).toBe('XX');
    });

    it('returns XX for private IP (no GeoIP record)', () => {
        // Private IPs are not in the GeoIP DB; mock returns null → XX
        expect(lookupCountry('192.168.1.1')).toBe('XX');
    });
});
