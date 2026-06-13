/**
 * AGG-R7-05 / AGG-10 (run-7 c1): pin that the home page opts out of the root
 * layout's title template in BOTH metadata branches.
 *
 * The root layout sets `title.template = '%s | ${seo.title}'`, which Next
 * applies to any STRING `metadata.title`. The home page already bakes the site
 * name into its title (the no-filter branch IS `seo.title`; the filtered
 * branch ends `… | ${seo.title}`), so a plain-string title double-suffixes:
 * `GalleryKit | GalleryKit` (no-filter) / `#tag | GalleryKit | GalleryKit`
 * (filtered). Returning `title: { absolute }` opts out of the template.
 *
 * Regression guard: if a future edit drops `{ absolute }` (returns a bare
 * string), this test fails before the doubling ships. Covers both return
 * shapes — the configured-OG-image branch and the latest-photo branch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
    getLocaleMock,
    getTranslationsMock,
    getSeoSettingsMock,
    getTagsCachedMock,
    getImagesLiteMock,
    getGalleryConfigMock,
} = vi.hoisted(() => ({
    getLocaleMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    getSeoSettingsMock: vi.fn(),
    getTagsCachedMock: vi.fn(),
    getImagesLiteMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
}));

vi.mock('next-intl/server', () => ({
    getLocale: getLocaleMock,
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/data', () => ({
    getImagesLite: getImagesLiteMock,
    getImagesLitePage: vi.fn(),
    getTagsCached: getTagsCachedMock,
    getTopicsCached: vi.fn(),
    getSeoSettings: getSeoSettingsMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

// Pull in the real client-safe helpers the page uses (locale-path, image-url,
// tag-slugs, photo-title, gallery-config-shared) — they are pure and need no
// mock. The page module is imported STATICALLY (mirroring
// photo-og-metadata.test.ts) — the vi.mock calls above are hoisted by
// vi.hoisted, so a top-level import resolves them, and paying the module's
// (heavy) transitive import cost once at load avoids the cold dynamic-import
// cost landing inside the first `it`'s timeout (which flaked under full-suite
// load).
import { generateMetadata } from '@/app/[locale]/(public)/page';

const SEO_BASE = {
    title: 'GalleryKit',
    description: 'A gallery',
    url: 'https://example.com',
    locale: 'en',
};

describe('home generateMetadata — title.absolute (AGG-10)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getLocaleMock.mockResolvedValue('en');
        getTranslationsMock.mockResolvedValue(((key: string) => key) as unknown as never);
        getTagsCachedMock.mockResolvedValue([]);
        getImagesLiteMock.mockResolvedValue([]);
        getGalleryConfigMock.mockResolvedValue({ imageSizes: [640, 1536, 2048] });
    });

    it('returns title:{absolute} on the configured-OG-image branch (no-filter)', async () => {
        getSeoSettingsMock.mockResolvedValue({ ...SEO_BASE, og_image_url: 'https://example.com/og.png' });
        const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
        expect(meta.title).toEqual({ absolute: 'GalleryKit' });
    });

    it('returns title:{absolute} on the latest-photo branch (no-filter)', async () => {
        getSeoSettingsMock.mockResolvedValue({ ...SEO_BASE, og_image_url: undefined });
        getImagesLiteMock.mockResolvedValue([
            { filename_jpeg: 'abc.jpg', width: 1200, height: 800, title: 'Sunset' },
        ]);
        const meta = await generateMetadata({ searchParams: Promise.resolve({}) });
        // The contract is the {absolute} wrapper, not the inner string shape.
        expect(meta.title).toHaveProperty('absolute');
        expect((meta.title as { absolute: string }).absolute).toBe('GalleryKit');
    });

    it('returns title:{absolute} (never a bare templated string) on the filtered branch', async () => {
        getSeoSettingsMock.mockResolvedValue({ ...SEO_BASE, og_image_url: 'https://example.com/og.png' });
        getTagsCachedMock.mockResolvedValue([{ slug: 'sunset', name: 'sunset' }]);
        const meta = await generateMetadata({ searchParams: Promise.resolve({ tags: 'sunset' }) });
        expect(meta.title).toHaveProperty('absolute');
        // The filtered title bakes the site name itself; absolute prevents a
        // second ` | GalleryKit` suffix from the layout template.
        expect((meta.title as { absolute: string }).absolute).toBe('#sunset | GalleryKit');
        expect(typeof meta.title).not.toBe('string');
    });
});
