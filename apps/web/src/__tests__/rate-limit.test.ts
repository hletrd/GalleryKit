import { describe, it, expect } from 'vitest';
import { normalizeIp, getRateLimitBucketStart } from '@/lib/rate-limit';

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
