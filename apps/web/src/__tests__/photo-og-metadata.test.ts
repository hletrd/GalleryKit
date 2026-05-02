/**
 * US-P13: Verify that generateMetadata for the photo page (/p/[id])
 * uses the per-photo OG image route, and falls back gracefully for
 * missing or invalid photo IDs.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
    getImageCachedMock,
    getSeoSettingsMock,
    getLocaleMock,
    getTranslationsMock,
} = vi.hoisted(() => ({
    getImageCachedMock: vi.fn(),
    getSeoSettingsMock: vi.fn(),
    getLocaleMock: vi.fn(),
    getTranslationsMock: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getImageCached: getImageCachedMock,
    getSeoSettings: getSeoSettingsMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: vi.fn().mockResolvedValue({ imageSizes: [640, 1536, 2048, 4096] }),
}));

vi.mock('next-intl/server', () => ({
    getLocale: getLocaleMock,
    getTranslations: getTranslationsMock,
}));

const SEO_DEFAULTS = {
    title: 'GalleryKit',
    description: 'A photo gallery',
    nav_title: 'GalleryKit',
    author: '',
    locale: 'en_US',
    url: 'https://example.com',
    og_image_url: null,
};

const SAMPLE_IMAGE = {
    id: 42,
    title: 'Golden Hour',
    description: null,
    topic: null,
    topic_label: null,
    tags: [],
    filename_jpeg: 'abc123.jpg',
    filename_webp: 'abc123.webp',
    width: 3000,
    height: 2000,
    created_at: new Date('2024-06-01T12:00:00Z'),
    prevId: null,
    nextId: null,
    capture_date: null,
};

import { generateMetadata } from '@/app/[locale]/(public)/p/[id]/page';

describe('photo page generateMetadata — US-P13 per-photo OG', () => {
    beforeEach(() => {
        getImageCachedMock.mockReset();
        getSeoSettingsMock.mockReset();
        getLocaleMock.mockReset();
        getTranslationsMock.mockReset();

        getLocaleMock.mockResolvedValue('en');
        getTranslationsMock.mockImplementation(async () => (key: string, values?: Record<string, string | number>) => {
            if (key === 'notFoundTitle') return 'Photo Not Found';
            if (key === 'titleWithId') return `Photo #${values?.id ?? ''}`;
            if (key === 'descriptionByAuthorWithTitle') return `${values?.title ?? ''} by ${values?.author ?? ''}`;
            return key;
        });
        getSeoSettingsMock.mockResolvedValue(SEO_DEFAULTS);
    });

    it('returns og:image pointing to /api/og/photo/[id] for a valid photo', async () => {
        getImageCachedMock.mockResolvedValue(SAMPLE_IMAGE);

        const metadata = await generateMetadata({ params: Promise.resolve({ id: '42', locale: 'en' }) });

        const ogImages = (metadata as { openGraph?: { images?: { url: string }[] } }).openGraph?.images;
        expect(Array.isArray(ogImages)).toBe(true);
        expect(ogImages![0].url).toContain('/api/og/photo/42');
    });

    it('og:image uses the configured seo.url as origin', async () => {
        getImageCachedMock.mockResolvedValue(SAMPLE_IMAGE);

        const metadata = await generateMetadata({ params: Promise.resolve({ id: '42', locale: 'en' }) });

        const ogImages = (metadata as { openGraph?: { images?: { url: string }[] } }).openGraph?.images;
        expect(ogImages![0].url).toMatch(/^https:\/\/example\.com\/api\/og\/photo\/42$/);
    });

    it('og:image dimensions are 1200x630 (the OG route output size)', async () => {
        getImageCachedMock.mockResolvedValue(SAMPLE_IMAGE);

        const metadata = await generateMetadata({ params: Promise.resolve({ id: '42', locale: 'en' }) });

        const ogImages = (metadata as { openGraph?: { images?: { url: string; width?: number; height?: number }[] } }).openGraph?.images;
        expect(ogImages![0].width).toBe(1200);
        expect(ogImages![0].height).toBe(630);
    });

    it('twitter:images also points to the per-photo OG route', async () => {
        getImageCachedMock.mockResolvedValue(SAMPLE_IMAGE);

        const metadata = await generateMetadata({ params: Promise.resolve({ id: '42', locale: 'en' }) });

        const twitterImages = (metadata as { twitter?: { images?: string[] } }).twitter?.images;
        expect(Array.isArray(twitterImages)).toBe(true);
        expect(twitterImages![0]).toContain('/api/og/photo/42');
    });

    it('returns only a title (no og images) when the photo is not found — fallback', async () => {
        getImageCachedMock.mockResolvedValue(null);

        const metadata = await generateMetadata({ params: Promise.resolve({ id: '999', locale: 'en' }) });

        // No openGraph on missing photo
        expect((metadata as { openGraph?: unknown }).openGraph).toBeUndefined();
        expect((metadata as { title?: string }).title).toBe('Photo Not Found');
    });

    it('returns only a title for a non-numeric id — fallback', async () => {
        const metadata = await generateMetadata({ params: Promise.resolve({ id: 'notanumber', locale: 'en' }) });

        expect((metadata as { openGraph?: unknown }).openGraph).toBeUndefined();
        expect((metadata as { title?: string }).title).toBe('Photo Not Found');
    });
});
