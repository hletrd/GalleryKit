import { describe, expect, it } from 'vitest';

import { validateSeoOgImageUrl } from '@/lib/seo-og-url';

describe('validateSeoOgImageUrl', () => {
    it('accepts relative OG image URLs', () => {
        expect(validateSeoOgImageUrl('/uploads/og.jpg', 'https://gallery.example.com')).toBe(true);
    });

    it('rejects scheme-relative OG image URLs', () => {
        expect(validateSeoOgImageUrl('//evil.example/og.jpg', 'https://gallery.example.com')).toBe(false);
    });

    it('rejects third-party OG image URLs when BASE_URL is absent and site-config fallback is used', () => {
        expect(validateSeoOgImageUrl('https://cdn.example.com/og.jpg', 'http://localhost:3000')).toBe(false);
    });

    it('accepts same-origin absolute OG image URLs', () => {
        expect(validateSeoOgImageUrl('https://gallery.example.com/og.jpg', 'https://gallery.example.com')).toBe(true);
    });
});
