/**
 * Cycle 2 RPF / P260-12 / C2-RPF-11: unit tests for the
 * `deriveLocaleFromReferer` helper added in cycle 1 RPF for locale-aware
 * Stripe Checkout success/cancel URLs. Covers the regex + URL-parse
 * combination that historically has been a bug source elsewhere in the
 * proxy/middleware codebase.
 *
 * Also covers the `isPaidLicenseTier` allowlist used by both
 * `/api/checkout/[imageId]` and `/api/stripe/webhook`.
 */

import { describe, it, expect } from 'vitest';
import {
    deriveLocaleFromReferer,
    isPaidLicenseTier,
    PAID_LICENSE_TIERS,
    PAID_TIER_PRICE_KEYS,
} from '../lib/license-tiers';

describe('deriveLocaleFromReferer', () => {
    it('returns default locale when referer is null', () => {
        expect(deriveLocaleFromReferer(null)).toBe('en');
    });

    it('returns default locale when referer is undefined', () => {
        expect(deriveLocaleFromReferer(undefined)).toBe('en');
    });

    it('returns default locale when referer is empty string', () => {
        expect(deriveLocaleFromReferer('')).toBe('en');
    });

    it('returns default locale on malformed URL', () => {
        expect(deriveLocaleFromReferer('not-a-url')).toBe('en');
    });

    it('returns en for /en/p/1', () => {
        expect(deriveLocaleFromReferer('https://example.com/en/p/1')).toBe('en');
    });

    it('returns ko for /ko/p/1', () => {
        expect(deriveLocaleFromReferer('https://example.com/ko/p/1')).toBe('ko');
    });

    it('returns en for /EN/p/1 (case-insensitive)', () => {
        expect(deriveLocaleFromReferer('https://example.com/EN/p/1')).toBe('en');
    });

    it('returns ko for /Ko/p/1 (mixed case)', () => {
        expect(deriveLocaleFromReferer('https://example.com/Ko/p/1')).toBe('ko');
    });

    it('returns default locale when no locale prefix present', () => {
        expect(deriveLocaleFromReferer('https://example.com/p/1')).toBe('en');
    });

    it('returns default locale for unsupported locale prefix', () => {
        expect(deriveLocaleFromReferer('https://example.com/de/p/1')).toBe('en');
        expect(deriveLocaleFromReferer('https://example.com/fr/p/1')).toBe('en');
        expect(deriveLocaleFromReferer('https://example.com/jp/p/1')).toBe('en');
    });

    it('handles bare /en or /ko (no trailing slash)', () => {
        expect(deriveLocaleFromReferer('https://example.com/en')).toBe('en');
        expect(deriveLocaleFromReferer('https://example.com/ko')).toBe('ko');
    });

    it('does NOT match longer prefixes that happen to start with locale chars', () => {
        // /eng (3 chars) does not match the 2-char locale regex
        expect(deriveLocaleFromReferer('https://example.com/eng/p/1')).toBe('en');
        // /enabc would also not match the regex (no /, not end-of-path after 2 chars)
        expect(deriveLocaleFromReferer('https://example.com/enabc/p/1')).toBe('en');
    });

    it('handles referer with query string and fragment', () => {
        expect(deriveLocaleFromReferer('https://example.com/ko/p/1?foo=bar#hash')).toBe('ko');
    });
});

describe('isPaidLicenseTier', () => {
    it('returns true for editorial', () => {
        expect(isPaidLicenseTier('editorial')).toBe(true);
    });

    it('returns true for commercial', () => {
        expect(isPaidLicenseTier('commercial')).toBe(true);
    });

    it('returns true for rm', () => {
        expect(isPaidLicenseTier('rm')).toBe(true);
    });

    it('returns false for none (intentional sentinel)', () => {
        expect(isPaidLicenseTier('none')).toBe(false);
    });

    it('returns false for unknown tier', () => {
        expect(isPaidLicenseTier('admin')).toBe(false);
        expect(isPaidLicenseTier('<script>')).toBe(false);
        expect(isPaidLicenseTier('EDITORIAL')).toBe(false); // case-sensitive
    });

    it('returns false for null/undefined/non-string', () => {
        expect(isPaidLicenseTier(null)).toBe(false);
        expect(isPaidLicenseTier(undefined)).toBe(false);
        expect(isPaidLicenseTier(123)).toBe(false);
        expect(isPaidLicenseTier({})).toBe(false);
    });

    it('PAID_LICENSE_TIERS and PAID_TIER_PRICE_KEYS keys are aligned', () => {
        for (const tier of PAID_LICENSE_TIERS) {
            expect(PAID_TIER_PRICE_KEYS[tier]).toBeDefined();
            expect(PAID_TIER_PRICE_KEYS[tier]).toMatch(/^license_price_.+_cents$/);
        }
    });
});
