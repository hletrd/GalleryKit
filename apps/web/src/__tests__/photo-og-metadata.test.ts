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

    // C2-04 (UX-03, run-10 c2): missing/malformed photos now THROW notFound()
    // from generateMetadata instead of returning a notFoundTitle metadata
    // object — the status-bearing 404 contract (see p/[id]/layout.tsx). Next's
    // notFound() throws an error whose digest carries NEXT_HTTP_ERROR_FALLBACK
    // (Next 15/16) or NEXT_NOT_FOUND (older); pin on the digest, not the
    // message, which is not part of the public contract.
    function isNotFoundError(err: unknown): boolean {
        const digest = (err as { digest?: string } | null)?.digest ?? '';
        return digest.includes('NEXT_HTTP_ERROR_FALLBACK;404') || digest.includes('NEXT_NOT_FOUND');
    }

    it('throws notFound() when the photo is missing — status-bearing 404', async () => {
        getImageCachedMock.mockResolvedValue(null);

        await expect(
            generateMetadata({ params: Promise.resolve({ id: '999', locale: 'en' }) }),
        ).rejects.toSatisfy(isNotFoundError);
    });

    it('throws notFound() for a non-numeric id — status-bearing 404', async () => {
        await expect(
            generateMetadata({ params: Promise.resolve({ id: 'notanumber', locale: 'en' }) }),
        ).rejects.toSatisfy(isNotFoundError);
    });
});
