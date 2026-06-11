import { describe, expect, it } from 'vitest';

import { resolveErrorShellBrand, resolveErrorShellThemeClass } from '@/lib/error-shell';

describe('resolveErrorShellBrand', () => {
    it('prefers the live root-layout dataset brand', () => {
        expect(resolveErrorShellBrand({
            title: 'Photo 42 | Legacy Gallery',
            documentElement: {
                dataset: {
                    galleryNavTitle: 'Live Nav',
                    galleryTitle: 'Live Gallery',
                },
            },
        }, 'Static Nav', 'Static Gallery')).toBe('Live Nav');
    });

    it('falls back to the live document title when dataset values are absent', () => {
        expect(resolveErrorShellBrand({
            title: 'Photo 42 | Live Gallery',
            documentElement: { dataset: {} },
        }, 'Static Nav', 'Static Gallery')).toBe('Live Gallery');
    });

    it('falls back to static branding when no live document metadata exists', () => {
        expect(resolveErrorShellBrand(null, 'Static Nav', 'Static Gallery')).toBe('Static Nav');
        expect(resolveErrorShellBrand({
            title: '',
            documentElement: { dataset: {} },
        }, '', 'Static Gallery')).toBe('Static Gallery');
    });
});

/**
 * COR-R4C15-01: the global error shell must preserve the crashed
 * document's theme class. The theme system is 4-valued
 * (`lib/theme.ts` THEME_VALUES) and next-themes applies the theme name
 * as the <html> class — `oled` is a sibling of `dark`, so a dark-only
 * check renders OLED users a white fatal-error page.
 */
describe('resolveErrorShellThemeClass', () => {
    const docWithClasses = (classes: string[]) => ({
        documentElement: {
            classList: { contains: (token: string) => classes.includes(token) },
        },
    });

    it('preserves the OLED true-black theme class', () => {
        expect(resolveErrorShellThemeClass(docWithClasses(['oled']))).toBe('oled');
    });

    it('preserves the dark theme class', () => {
        expect(resolveErrorShellThemeClass(docWithClasses(['dark']))).toBe('dark');
    });

    it('prefers oled when both classes are present (defensive)', () => {
        expect(resolveErrorShellThemeClass(docWithClasses(['dark', 'oled']))).toBe('oled');
    });

    it('returns null for light/system-light documents (no theme class)', () => {
        expect(resolveErrorShellThemeClass(docWithClasses(['light']))).toBeNull();
        expect(resolveErrorShellThemeClass(docWithClasses([]))).toBeNull();
    });

    it('returns null when document or classList is unavailable (SSR)', () => {
        expect(resolveErrorShellThemeClass(null)).toBeNull();
        expect(resolveErrorShellThemeClass(undefined)).toBeNull();
        expect(resolveErrorShellThemeClass({ documentElement: {} })).toBeNull();
        expect(resolveErrorShellThemeClass({ documentElement: null })).toBeNull();
    });

    // Source-inspection lock (repo convention, cf.
    // wide-gamut-predicate-wiring.test.ts): the global error shell must
    // route theme detection through the canonical helper. The pre-fix
    // source inlined `classList.contains('dark')` and never mentioned
    // `oled` — this block fails against that source.
    it('global-error.tsx routes theme detection through resolveErrorShellThemeClass', async () => {
        const { readFile } = await import('fs/promises');
        const path = await import('path');
        const source = await readFile(
            path.resolve(__dirname, '..', 'app', 'global-error.tsx'),
            'utf8',
        );
        expect(source).toMatch(/resolveErrorShellThemeClass/);
        // No surviving ad-hoc dark-only class sniffing.
        expect(source).not.toMatch(/classList\.contains\(\s*['"]dark['"]\s*\)/);
    });
});
