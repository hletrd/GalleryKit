import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const {
    getSeoSettingsMock,
    getTopicBySlugMock,
    getImageCachedMock,
    getImageProcessingStateCachedMock,
    getGalleryConfigMock,
    getColorSettingsHashMock,
    pickFirstAvailablePhotoBufferMock,
    isRestoreMaintenanceActiveMock,
} = vi.hoisted(() => ({
    getSeoSettingsMock: vi.fn(),
    getTopicBySlugMock: vi.fn(),
    getImageCachedMock: vi.fn(),
    getImageProcessingStateCachedMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    getColorSettingsHashMock: vi.fn(),
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

vi.mock('@/lib/settings-hash', () => ({
    getColorSettingsHash: getColorSettingsHashMock,
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
import { IMAGE_PIPELINE_VERSION } from '@/lib/gallery-config-shared';
import { OG_MAX_REQUESTS, preIncrementOgAttempt, resetOgRateLimitForTests } from '@/lib/rate-limit';

function saturateUnknownOgBucket(now = Date.now()) {
    for (let i = 0; i < OG_MAX_REQUESTS; i++) {
        preIncrementOgAttempt('unknown', now);
    }
}

// C1-14 (run-10 cycle-1): the topic OG ETag folds in the card template version
// and the image pipeline version so a card redesign invalidates crawler
// caches. OG_TEMPLATE_VERSION must stay in sync with api/og/route.tsx (route
// files cannot export non-handler symbols, so it is mirrored here).
const OG_TEMPLATE_VERSION = 1;

function createTopicOgEtag(slug: string, label: string, tags: string[] = [], siteTitle = 'Gallery') {
    return '"' + createHash('sha256')
        .update(`v${OG_TEMPLATE_VERSION}-p${IMAGE_PIPELINE_VERSION}|${slug}|${label}|${tags.join(',')}|${siteTitle}`)
        .digest('hex')
        .slice(0, 32) + '"';
}

function createPhotoOgEtag(input: {
    id: number;
    filenameJpeg: string;
    displayTitle: string;
    siteTitle?: string;
    updatedAt: Date;
    createdAt: Date;
    imageSizes?: number[];
    settingsHash?: string;
    pipelineVersion?: number;
}) {
    const sizes = [...(input.imageSizes ?? [640, 1536])].sort((a, b) => a - b).join(',');
    const hash = createHash('sha256')
        .update([
            input.id,
            input.filenameJpeg,
            input.updatedAt.toISOString() || input.createdAt.toISOString(),
            sizes,
            input.settingsHash ?? 'settings-a',
            input.pipelineVersion ?? IMAGE_PIPELINE_VERSION,
            input.displayTitle,
            input.siteTitle ?? 'Gallery',
        ].join('\0'))
        .digest('base64url')
        .slice(0, 22);

    return `W/"og-photo-${hash}"`;
}

beforeEach(() => {
    isRestoreMaintenanceActiveMock.mockReturnValue(false);
    getSeoSettingsMock.mockResolvedValue({
        url: 'https://gallery.example',
        title: 'Gallery',
        og_image_url: '/api/og',
    });
    getGalleryConfigMock.mockResolvedValue({ imageSizes: [640, 1536] });
    getColorSettingsHashMock.mockResolvedValue('settings-a');
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

    it('returns 304 from the topic OG route when If-None-Match weakly matches', async () => {
        getTopicBySlugMock.mockResolvedValue({ slug: 'travel', label: 'Travel' });
        const etag = createTopicOgEtag('travel', 'Travel');

        const response = await topicOgGet(new NextRequest('https://example.test/api/og?topic=travel', {
            headers: { 'if-none-match': `W/${etag}` },
        }));

        expect(response.status).toBe(304);
        expect(response.headers.get('ETag')).toBe(etag);
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
        expect(getSeoSettingsMock).toHaveBeenCalled();
        expect(getTopicBySlugMock).toHaveBeenCalledWith('travel');
    });

    it('returns 304 from the photo OG route before derivative fetch/render when If-None-Match matches', async () => {
        const updatedAt = new Date('2026-06-01T10:00:00.000Z');
        const createdAt = new Date('2026-05-01T10:00:00.000Z');
        getImageCachedMock.mockResolvedValue({
            id: 42,
            title: 'Mountain',
            filename_jpeg: 'mountain.jpg',
            tag_names: null,
            updated_at: updatedAt,
            created_at: createdAt,
        });
        const etag = createPhotoOgEtag({
            id: 42,
            filenameJpeg: 'mountain.jpg',
            displayTitle: 'Mountain',
            updatedAt,
            createdAt,
        });

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/42', {
                headers: { 'if-none-match': etag.replace(/^W\//, '') },
            }),
            { params: Promise.resolve({ id: '42' }) },
        );

        expect(response.status).toBe(304);
        expect(response.headers.get('ETag')).toBe(etag);
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
        expect(pickFirstAvailablePhotoBufferMock).not.toHaveBeenCalled();
    });

    it('does not 304 the photo OG route when derivative byte-impact settings changed', async () => {
        const updatedAt = new Date('2026-06-01T10:00:00.000Z');
        const createdAt = new Date('2026-05-01T10:00:00.000Z');
        getImageCachedMock.mockResolvedValue({
            id: 42,
            title: 'Mountain',
            filename_jpeg: 'mountain.jpg',
            tag_names: null,
            updated_at: updatedAt,
            created_at: createdAt,
        });
        getColorSettingsHashMock.mockResolvedValue('settings-b');
        pickFirstAvailablePhotoBufferMock.mockResolvedValue(null);
        const staleEtag = createPhotoOgEtag({
            id: 42,
            filenameJpeg: 'mountain.jpg',
            displayTitle: 'Mountain',
            updatedAt,
            createdAt,
            settingsHash: 'settings-a',
        });

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/42', {
                headers: { 'if-none-match': staleEtag },
            }),
            { params: Promise.resolve({ id: '42' }) },
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(pickFirstAvailablePhotoBufferMock).toHaveBeenCalledWith(
            expect.any(String),
            'mountain.jpg',
            [640, 1536],
        );
    });

    it('does not 304 the photo OG route when the image pipeline version changed', async () => {
        const updatedAt = new Date('2026-06-01T10:00:00.000Z');
        const createdAt = new Date('2026-05-01T10:00:00.000Z');
        getImageCachedMock.mockResolvedValue({
            id: 42,
            title: 'Mountain',
            filename_jpeg: 'mountain.jpg',
            tag_names: null,
            updated_at: updatedAt,
            created_at: createdAt,
        });
        pickFirstAvailablePhotoBufferMock.mockResolvedValue(null);
        const staleEtag = createPhotoOgEtag({
            id: 42,
            filenameJpeg: 'mountain.jpg',
            displayTitle: 'Mountain',
            updatedAt,
            createdAt,
            pipelineVersion: IMAGE_PIPELINE_VERSION - 1,
        });

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/42', {
                headers: { 'if-none-match': staleEtag },
            }),
            { params: Promise.resolve({ id: '42' }) },
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
        expect(pickFirstAvailablePhotoBufferMock).toHaveBeenCalledWith(
            expect.any(String),
            'mountain.jpg',
            [640, 1536],
        );
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

    it('keeps permanent photo misses cacheable while pending misses stay no-store', async () => {
        getImageCachedMock.mockResolvedValue(null);
        getImageProcessingStateCachedMock.mockResolvedValue(null);

        const response = await photoOgGet(
            new NextRequest('https://example.test/api/og/photo/404'),
            { params: Promise.resolve({ id: '404' }) },
        );

        expect(response.status).toBe(302);
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
        expect(response.headers.get('Location')).toBe('https://gallery.example/api/og');
        expect(getImageProcessingStateCachedMock).toHaveBeenCalledWith(404);
        expect(pickFirstAvailablePhotoBufferMock).not.toHaveBeenCalled();
    });
});
