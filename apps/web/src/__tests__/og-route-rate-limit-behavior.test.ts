import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
    getSeoSettingsMock,
    getTopicBySlugMock,
    getImageCachedMock,
    getGalleryConfigMock,
    pickFirstAvailablePhotoBufferMock,
} = vi.hoisted(() => ({
    getSeoSettingsMock: vi.fn(),
    getTopicBySlugMock: vi.fn(),
    getImageCachedMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    pickFirstAvailablePhotoBufferMock: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getSeoSettings: getSeoSettingsMock,
    getTopicBySlug: getTopicBySlugMock,
    getImageCached: getImageCachedMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('@/lib/og-photo-fetch', () => ({
    pickFirstAvailablePhotoBuffer: pickFirstAvailablePhotoBufferMock,
}));

import { GET as topicOgGet } from '@/app/api/og/route';
import { GET as photoOgGet } from '@/app/api/og/photo/[id]/route';
import { OG_MAX_REQUESTS, preIncrementOgAttempt, resetOgRateLimitForTests } from '@/lib/rate-limit';

function saturateUnknownOgBucket(now = Date.now()) {
    for (let i = 0; i < OG_MAX_REQUESTS; i++) {
        preIncrementOgAttempt('unknown', now);
    }
}

afterEach(() => {
    resetOgRateLimitForTests();
    vi.clearAllMocks();
});

describe('OG route rate-limit behavior', () => {
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
});
