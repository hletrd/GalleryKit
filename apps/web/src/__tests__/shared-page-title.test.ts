import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const {
    getLocaleMock,
    getTranslationsMock,
    getImageByShareKeyCachedMock,
    getSharedGroupCachedMock,
    getSeoSettingsMock,
    getGalleryConfigMock,
} = vi.hoisted(() => ({
    getLocaleMock: vi.fn(),
    getTranslationsMock: vi.fn(),
    getImageByShareKeyCachedMock: vi.fn(),
    getSharedGroupCachedMock: vi.fn(),
    getSeoSettingsMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
}));

vi.mock('next-intl/server', () => ({
    getLocale: getLocaleMock,
    getTranslations: getTranslationsMock,
}));

vi.mock('@/lib/data', () => ({
    getImageByShareKeyCached: getImageByShareKeyCachedMock,
    getSharedGroupCached: getSharedGroupCachedMock,
    getSeoSettings: getSeoSettingsMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('next/link', () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => React.createElement('a', { href }, children),
}));

vi.mock('next/navigation', () => ({
    notFound: () => {
        throw new Error('notFound');
    },
}));

vi.mock('@/components/photo-viewer', () => ({
    default: ({ untitledFallbackTitle }: { untitledFallbackTitle?: string }) => React.createElement('div', { 'data-fallback': untitledFallbackTitle ?? '' }),
}));

import SharedPhotoPage from '@/app/[locale]/(public)/s/[key]/page';
import SharedGroupPage from '@/app/[locale]/(public)/g/[key]/page';

describe('shared page display titles', () => {
    beforeEach(() => {
        getLocaleMock.mockReset();
        getTranslationsMock.mockReset();
        getImageByShareKeyCachedMock.mockReset();
        getSharedGroupCachedMock.mockReset();
        getSeoSettingsMock.mockReset();
        getGalleryConfigMock.mockReset();

        getLocaleMock.mockResolvedValue('en');
        getTranslationsMock.mockImplementation(async () => (key: string, values?: Record<string, string | number>) => {
            if (key === 'sharedPhoto') return 'Shared Photo';
            if (key === 'photo') return 'Photo';
            if (key === 'viewGallery') return 'View Gallery';
            if (key === 'viewCount') return `Count ${values?.count ?? ''}`.trim();
            return key;
        });
        getSeoSettingsMock.mockResolvedValue({
            title: 'GalleryKit',
            nav_title: 'GalleryKit',
            url: 'https://example.com',
            og_image_url: '',
        });
        getGalleryConfigMock.mockResolvedValue({
            imageSizes: [640, 1536, 2048, 4096],
        });
    });

    it('renders shared photo headings from tag-derived titles when the image has no meaningful title', async () => {
        getImageByShareKeyCachedMock.mockResolvedValue({
            id: 42,
            title: null,
            description: null,
            tags: [{ name: 'Seoul', slug: 'seoul' }],
            filename_jpeg: 'sample.jpg',
            width: 1000,
            height: 800,
        });

        const markup = renderToStaticMarkup(await SharedPhotoPage({ params: Promise.resolve({ key: 'abc' }) }));

        expect(markup).toContain('#Seoul');
        expect(markup).toContain('data-fallback=\"Shared Photo\"');
    });

    it('renders shared group selected-photo headings from tag-derived titles when the image has no meaningful title', async () => {
        getSharedGroupCachedMock.mockResolvedValue({
            images: [{
                id: 7,
                title: null,
                description: null,
                tags: [{ name: 'Night', slug: 'night' }],
                filename_jpeg: 'night.jpg',
                filename_webp: 'night.webp',
                width: 1000,
                height: 800,
            }],
        });

        const markup = renderToStaticMarkup(await SharedGroupPage({
            params: Promise.resolve({ key: 'group', locale: 'en' }),
            searchParams: Promise.resolve({ photoId: '7' }),
        }));

        expect(markup).toContain('#Night');
        expect(markup).toContain('data-fallback=\"Photo\"');
    });

    it('preserves a meaningful shared photo title even when tags exist', async () => {
        getImageByShareKeyCachedMock.mockResolvedValue({
            id: 52,
            title: 'Golden Hour',
            description: null,
            tags: [{ name: 'Night', slug: 'night' }],
            filename_jpeg: 'golden.jpg',
            width: 1000,
            height: 800,
        });

        const markup = renderToStaticMarkup(await SharedPhotoPage({ params: Promise.resolve({ key: 'def' }) }));

        expect(markup).toContain('Golden Hour');
        expect(markup).not.toContain('#Night</h1>');
    });
});
