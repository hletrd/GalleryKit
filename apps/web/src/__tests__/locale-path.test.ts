import { describe, expect, it } from 'vitest';

import { absoluteUrl, getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl, stripLocalePrefix } from '@/lib/locale-path';

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
});
