import { describe, expect, it } from 'vitest';

import { absoluteUrl, buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl, stripLocalePrefix } from '@/lib/locale-path';

describe('stripLocalePrefix', () => {
    it('removes supported locale prefixes and keeps non-locale paths intact', () => {
        expect(stripLocalePrefix('/en/admin/dashboard')).toBe('/admin/dashboard');
        expect(stripLocalePrefix('/ko/p/42')).toBe('/p/42');
        expect(stripLocalePrefix('/travel')).toBe('/travel');
        expect(stripLocalePrefix('/en')).toBe('/');
    });
});

describe('localizePath', () => {
    it('prefixes both default and non-default locale paths', () => {
        expect(localizePath('en', '/')).toBe('/en');
        expect(localizePath('en', '/admin/dashboard')).toBe('/en/admin/dashboard');
        expect(localizePath('ko', '/')).toBe('/ko');
        expect(localizePath('ko', '/admin/dashboard')).toBe('/ko/admin/dashboard');
    });

    it('normalizes already-prefixed input paths', () => {
        expect(localizePath('en', '/ko/p/7')).toBe('/en/p/7');
        expect(localizePath('ko', '/en/p/7')).toBe('/ko/p/7');
    });
});

describe('absoluteUrl/localizeUrl', () => {
    it('builds absolute URLs with explicit locale prefixes', () => {
        expect(absoluteUrl('https://gallery.example.com', '/p/1')).toBe('https://gallery.example.com/p/1');
        expect(localizeUrl('https://gallery.example.com', 'en', '/p/1')).toBe('https://gallery.example.com/en/p/1');
        expect(localizeUrl('https://gallery.example.com', 'ko', '/p/1')).toBe('https://gallery.example.com/ko/p/1');
    });
});

describe('Open Graph locale helpers', () => {
    it('maps route locales to valid Open Graph locale codes', () => {
        expect(getOpenGraphLocale('en')).toBe('en_US');
        expect(getOpenGraphLocale('ko')).toBe('ko_KR');
        expect(getOpenGraphLocale('unknown')).toBe('en_US');
    });

    it('excludes the current locale from alternate Open Graph locales', () => {
        expect(getAlternateOpenGraphLocales('en')).toEqual(['ko_KR']);
        expect(getAlternateOpenGraphLocales('ko')).toEqual(['en_US']);
    });

    it('keeps route locale even when an admin-configured locale differs (F-6/F-16)', () => {
        // The route locale MUST always win on supported locales so social
        // unfurls and Google indexing match the URL the user actually
        // visited. The admin-configured `seo.locale` is the default for
        // unsupported / unknown route locales only.
        expect(getOpenGraphLocale('ko', 'en_US')).toBe('ko_KR');
        expect(getAlternateOpenGraphLocales('ko', 'en_US')).toEqual(['en_US']);
        expect(getOpenGraphLocale('en', 'ko_KR')).toBe('en_US');
        expect(getAlternateOpenGraphLocales('en', 'ko_KR')).toEqual(['ko_KR']);
    });

    it('uses configured Open Graph locale only for unsupported route locales', () => {
        expect(getOpenGraphLocale('unknown', 'ko_KR')).toBe('ko_KR');
        expect(getOpenGraphLocale('unknown', null)).toBe('en_US');
    });

    it('ignores unsupported Open Graph locale overrides', () => {
        // Route locale wins; configured fallback ignored entirely.
        expect(getOpenGraphLocale('ko', 'korean')).toBe('ko_KR');
        expect(getOpenGraphLocale('ko', 'fr_FR')).toBe('ko_KR');
        // Unsupported route locale + invalid override → en default.
        expect(getOpenGraphLocale('unknown', 'fr_FR')).toBe('en_US');
    });
});

describe('buildHreflangAlternates (AGG1L-LOW-04)', () => {
    it('emits an entry per supported locale plus x-default', () => {
        const alternates = buildHreflangAlternates('https://gallery.example.com', '/');
        expect(alternates).toEqual({
            en: 'https://gallery.example.com/en',
            ko: 'https://gallery.example.com/ko',
            'x-default': 'https://gallery.example.com/en',
        });
    });

    it('preserves the path segment across locales', () => {
        const alternates = buildHreflangAlternates('https://gallery.example.com', '/p/42');
        expect(alternates.en).toBe('https://gallery.example.com/en/p/42');
        expect(alternates.ko).toBe('https://gallery.example.com/ko/p/42');
        expect(alternates['x-default']).toBe('https://gallery.example.com/en/p/42');
    });

    it('handles topic-style paths', () => {
        const alternates = buildHreflangAlternates('https://gallery.example.com', '/landscape');
        expect(alternates.en).toBe('https://gallery.example.com/en/landscape');
        expect(alternates.ko).toBe('https://gallery.example.com/ko/landscape');
    });
});
