import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
    getSeoSettingsMock,
    getTopicBySlugMock,
    getImageCachedMock,
    getImageProcessingStateCachedMock,
    getGalleryConfigMock,
    pickFirstAvailablePhotoBufferMock,
    isRestoreMaintenanceActiveMock,
} = vi.hoisted(() => ({
    getSeoSettingsMock: vi.fn(),
    getTopicBySlugMock: vi.fn(),
    getImageCachedMock: vi.fn(),
    getImageProcessingStateCachedMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    pickFirstAvailablePhotoBufferMock: vi.fn(),
    isRestoreMaintenanceActiveMock: vi.fn(() => false),
}));

vi.mock('@/lib/data', () => ({
    getSeoSettings: getSeoSettingsMock,
    getTopicBySlug: getTopicBySlugMock,
    getImageCached: getImageCachedMock,
    getImageProcessingStateCached: getImageProcessingStateCachedMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('@/lib/og-photo-fetch', () => ({
    pickFirstAvailablePhotoBuffer: pickFirstAvailablePhotoBufferMock,
}));

vi.mock('@/lib/restore-maintenance', () => ({
    isRestoreMaintenanceActive: isRestoreMaintenanceActiveMock,
}));

vi.mock('@/lib/constants', async () => {
    const actual = await vi.importActual<typeof import('@/lib/constants')>('@/lib/constants');
    return {
        ...actual,
        BASE_URL: 'https://gallery.example',
    };
});

import { GET as topicOgGet } from '@/app/api/og/route';
import { GET as photoOgGet } from '@/app/api/og/photo/[id]/route';
import { OG_MAX_REQUESTS, preIncrementOgAttempt, resetOgRateLimitForTests } from '@/lib/rate-limit';

function saturateUnknownOgBucket(now = Date.now()) {
    for (let i = 0; i < OG_MAX_REQUESTS; i++) {
        preIncrementOgAttempt('unknown', now);
    }
}

beforeEach(() => {
    isRestoreMaintenanceActiveMock.mockReturnValue(false);
    getSeoSettingsMock.mockResolvedValue({
        url: 'https://gallery.example',
        title: 'Gallery',
        og_image_url: '/api/og',
    });
    getGalleryConfigMock.mockResolvedValue({ imageSizes: [640, 1536] });
});

afterEach(() => {
    resetOgRateLimitForTests();
    vi.clearAllMocks();
});

describe('OG route rate-limit behavior', () => {
    it('returns 503 from the topic OG route during restore maintenance before DB work or rate-limit charging', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        const response = await topicOgGet(new NextRequest('https://example.test/api/og?topic=travel'));

        expect(response.status).toBe(503);
        expect(response.headers.get('Cache-Control')).toContain('no-store');
        expect(getSeoSettingsMock).not.toHaveBeenCalled();
        expect(getTopicBySlugMock).not.toHaveBeenCalled();

        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        const now = Date.now();
        for (let i = 0; i < OG_MAX_REQUESTS; i++) {
            expect(preIncrementOgAttempt('unknown', now)).toBe(false);
        }
    });

    it('returns 503 from the photo OG route during restore maintenance before DB, config, fetch, or rate-limit charging', async () => {
        isRestoreMaintenanceActiveMock.mockReturnValue(true);

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/42'),
            { params: Promise.resolve({ id: '42' }) },
        );

        expect(response.status).toBe(503);
        expect(response.headers.get('Cache-Control')).toContain('no-store');
        expect(getImageCachedMock).not.toHaveBeenCalled();
        expect(getSeoSettingsMock).not.toHaveBeenCalled();
        expect(getGalleryConfigMock).not.toHaveBeenCalled();
        expect(pickFirstAvailablePhotoBufferMock).not.toHaveBeenCalled();

        isRestoreMaintenanceActiveMock.mockReturnValue(false);
        const now = Date.now();
        for (let i = 0; i < OG_MAX_REQUESTS; i++) {
            expect(preIncrementOgAttempt('unknown', now)).toBe(false);
        }
    });

    it('returns 429 from the topic OG route before SEO or topic lookup', async () => {
        saturateUnknownOgBucket();

        const response = await topicOgGet(new NextRequest('https://example.test/api/og?topic=travel'));

        expect(response.status).toBe(429);
        expect(response.headers.get('Retry-After')).toBe('60');
        expect(response.headers.get('Cache-Control')).toContain('no-store');
        expect(getSeoSettingsMock).not.toHaveBeenCalled();
        expect(getTopicBySlugMock).not.toHaveBeenCalled();
    });

    it('returns 429 from the photo OG route before DB, config, or fetch work', async () => {
        saturateUnknownOgBucket();

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/42'),
            { params: Promise.resolve({ id: '42' }) },
        );

        expect(response.status).toBe(429);
        expect(response.headers.get('Cache-Control')).toContain('no-store');
        expect(getImageCachedMock).not.toHaveBeenCalled();
        expect(getSeoSettingsMock).not.toHaveBeenCalled();
        expect(getGalleryConfigMock).not.toHaveBeenCalled();
        expect(pickFirstAvailablePhotoBufferMock).not.toHaveBeenCalled();
    });

    it('uses no-store redirects when a processed photo has no available derivative yet', async () => {
        getImageCachedMock.mockResolvedValue({
            id: 42,
            title: 'Mountain',
            filename_jpeg: 'mountain.jpg',
            tag_names: null,
        });
        pickFirstAvailablePhotoBufferMock.mockResolvedValue(null);

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/42'),
            { params: Promise.resolve({ id: '42' }) },
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(response.headers.get('Location')).toBe('https://gallery.example/api/og');
        expect(pickFirstAvailablePhotoBufferMock).toHaveBeenCalledWith(
            expect.any(String),
            'mountain.jpg',
            [640, 1536],
        );
        expect(getImageProcessingStateCachedMock).not.toHaveBeenCalled();
    });

    it('uses no-store redirects when an existing photo is still unprocessed', async () => {
        getImageCachedMock.mockResolvedValue(null);
        getImageProcessingStateCachedMock.mockResolvedValue({ id: 42, processed: false });

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/42'),
            { params: Promise.resolve({ id: '42' }) },
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(response.headers.get('Location')).toBe('https://gallery.example/api/og');
        expect(getImageProcessingStateCachedMock).toHaveBeenCalledWith(42);
        expect(pickFirstAvailablePhotoBufferMock).not.toHaveBeenCalled();
    });
});
