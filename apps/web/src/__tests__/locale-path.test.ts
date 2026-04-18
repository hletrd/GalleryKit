import { describe, expect, it } from 'vitest';

import { absoluteUrl, localizePath, localizeUrl, stripLocalePrefix } from '@/lib/locale-path';

describe('stripLocalePrefix', () => {
    it('removes supported locale prefixes and keeps non-locale paths intact', () => {
        expect(stripLocalePrefix('/en/admin/dashboard')).toBe('/admin/dashboard');
        expect(stripLocalePrefix('/ko/p/42')).toBe('/p/42');
        expect(stripLocalePrefix('/travel')).toBe('/travel');
        expect(stripLocalePrefix('/en')).toBe('/');
    });
});

describe('localizePath', () => {
    it('omits the default locale prefix and keeps non-default locale prefixes', () => {
        expect(localizePath('en', '/')).toBe('/');
        expect(localizePath('en', '/admin/dashboard')).toBe('/admin/dashboard');
        expect(localizePath('ko', '/')).toBe('/ko');
        expect(localizePath('ko', '/admin/dashboard')).toBe('/ko/admin/dashboard');
    });

    it('normalizes already-prefixed input paths', () => {
        expect(localizePath('en', '/ko/p/7')).toBe('/p/7');
        expect(localizePath('ko', '/en/p/7')).toBe('/ko/p/7');
    });
});

describe('absoluteUrl/localizeUrl', () => {
    it('builds absolute URLs without redundant default-locale prefixes', () => {
        expect(absoluteUrl('https://gallery.example.com', '/p/1')).toBe('https://gallery.example.com/p/1');
        expect(localizeUrl('https://gallery.example.com', 'en', '/p/1')).toBe('https://gallery.example.com/p/1');
        expect(localizeUrl('https://gallery.example.com', 'ko', '/p/1')).toBe('https://gallery.example.com/ko/p/1');
    });
});
