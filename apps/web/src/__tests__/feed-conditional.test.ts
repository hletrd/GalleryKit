/**
 * Cycle 73: route-level Atom feed conditional-request coverage.
 *
 * The feed routes now use content-derived ETags. These tests exercise the
 * actual route handlers so the 200/304 behavior, SEO/config dependencies,
 * ETag-only conditional contract, and topic locale guards cannot drift behind
 * source-grep fixtures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
    getImagesForFeedMock,
    getSeoSettingsMock,
    getTopicBySlugMock,
    getGalleryConfigMock,
    getTranslationsMock,
} = vi.hoisted(() => ({
    getImagesForFeedMock: vi.fn(),
    getSeoSettingsMock: vi.fn(),
    getTopicBySlugMock: vi.fn(),
    getGalleryConfigMock: vi.fn(),
    getTranslationsMock: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
    getImagesForFeed: getImagesForFeedMock,
    getSeoSettings: getSeoSettingsMock,
    getTopicBySlug: getTopicBySlugMock,
}));

vi.mock('@/lib/gallery-config', () => ({
    getGalleryConfig: getGalleryConfigMock,
}));

vi.mock('next-intl/server', () => ({
    getTranslations: getTranslationsMock,
}));

import { GET as getRootFeed } from '@/app/feed.xml/route';
import { GET as getTopicFeed } from '@/app/[locale]/(public)/[topic]/feed.xml/route';

const BASE_SEO = {
    url: 'https://gallery.example',
    title: 'Gallery Feed',
    author: 'Jane Photographer',
};

const BASE_CONFIG = {
    imageSizes: [512, 1024, 2048],
};

const FEED_ROW = {
    id: 42,
    title: null,
    description: 'A mountain sunset',
    capture_date: '2026-01-02',
    filename_jpeg: 'mountain.jpg',
    updated_at: new Date('2026-05-17T10:00:00.000Z'),
    created_at: new Date('2026-05-16T10:00:00.000Z'),
    tag_names: 'mountain_sunset, travel',
    author_name: null,
};

function feedRequest(path: string, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`https://gallery.example${path}`, { headers });
}

function topicParams(locale = 'en', topic = 'landscape') {
    return { params: Promise.resolve({ locale, topic }) };
}

beforeEach(() => {
    vi.clearAllMocks();
    getSeoSettingsMock.mockResolvedValue({ ...BASE_SEO });
    getGalleryConfigMock.mockResolvedValue({ ...BASE_CONFIG });
    getImagesForFeedMock.mockResolvedValue([{ ...FEED_ROW }]);
    getTopicBySlugMock.mockResolvedValue({ slug: 'landscape', label: 'Landscape' });
    getTranslationsMock.mockResolvedValue((key: string) => (key === 'photo' ? 'Photo' : key));
});

describe('root /feed.xml route conditional requests', () => {
    it('returns a 200 Atom feed with an ETag derived from rendered XML', async () => {
        const response = await getRootFeed(feedRequest('/feed.xml'));

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('application/atom+xml');
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=600, s-maxage=1800');
        expect(response.headers.get('Vary')).toBe('Accept-Language');
        expect(response.headers.get('ETag')).toMatch(/^W\/"atom-[A-Za-z0-9_-]{22}"$/);
        expect(response.headers.get('Last-Modified')).toBe('Sun, 17 May 2026 10:00:00 GMT');

        const body = await response.text();
        expect(body).toContain('<title type="text">Gallery Feed</title>');
        expect(body).toContain('<media:content url="https://gallery.example/uploads/jpeg/mountain_1024.jpg"');
        expect(getImagesForFeedMock).toHaveBeenCalledWith(50);
    });

    it('returns 304 with the same ETag when If-None-Match matches', async () => {
        const first = await getRootFeed(feedRequest('/feed.xml'));
        const etag = first.headers.get('ETag');
        expect(etag).toBeTruthy();

        const second = await getRootFeed(feedRequest('/feed.xml', {
            'if-none-match': `W/"other", ${etag?.replace(/^W\//, '')}`,
        }));

        expect(second.status).toBe(304);
        expect(second.headers.get('ETag')).toBe(etag);
        expect(second.headers.get('Last-Modified')).toBe('Sun, 17 May 2026 10:00:00 GMT');
        expect(await second.text()).toBe('');
    });

    it('keeps empty-feed ETags stable across requests', async () => {
        getImagesForFeedMock.mockResolvedValue([]);

        const first = await getRootFeed(feedRequest('/feed.xml'));
        const etag = first.headers.get('ETag');
        expect(first.status).toBe(200);
        expect(first.headers.get('Last-Modified')).toBe('Thu, 01 Jan 1970 00:00:00 GMT');
        expect(etag).toBeTruthy();

        const second = await getRootFeed(feedRequest('/feed.xml'));
        expect(second.status).toBe(200);
        expect(second.headers.get('ETag')).toBe(etag);

        const conditional = await getRootFeed(feedRequest('/feed.xml', {
            'if-none-match': etag ?? '',
        }));
        expect(conditional.status).toBe(304);
        expect(conditional.headers.get('ETag')).toBe(etag);
    });

    it('keeps If-Modified-Since informational unless If-None-Match matches', async () => {
        const first = await getRootFeed(feedRequest('/feed.xml'));
        const lastModified = first.headers.get('Last-Modified');
        expect(lastModified).toBe('Sun, 17 May 2026 10:00:00 GMT');

        const second = await getRootFeed(feedRequest('/feed.xml', {
            'if-modified-since': lastModified ?? '',
        }));

        expect(second.status).toBe(200);
        expect(second.headers.get('ETag')).toBe(first.headers.get('ETag'));
        expect(await second.text()).toContain('<title type="text">Gallery Feed</title>');
    });

    it('changes ETag when SEO/feed content changes even if image timestamps do not', async () => {
        const first = await getRootFeed(feedRequest('/feed.xml'));
        const firstEtag = first.headers.get('ETag');

        getSeoSettingsMock.mockResolvedValueOnce({
            ...BASE_SEO,
            title: 'Updated Gallery Feed',
        });

        const second = await getRootFeed(feedRequest('/feed.xml', {
            'if-none-match': firstEtag ?? '',
        }));

        expect(second.status).toBe(200);
        expect(second.headers.get('ETag')).not.toBe(firstEtag);
        expect(await second.text()).toContain('<title type="text">Updated Gallery Feed</title>');
    });
});

describe('topic /[locale]/[topic]/feed.xml route conditional requests', () => {
    it('rejects unsupported locales before DB/config/translation work', async () => {
        const response = await getTopicFeed(
            feedRequest('/xx/landscape/feed.xml'),
            topicParams('xx', 'landscape'),
        );

        expect(response.status).toBe(404);
        expect(getTopicBySlugMock).not.toHaveBeenCalled();
        expect(getSeoSettingsMock).not.toHaveBeenCalled();
        expect(getGalleryConfigMock).not.toHaveBeenCalled();
        expect(getTranslationsMock).not.toHaveBeenCalled();
        expect(getImagesForFeedMock).not.toHaveBeenCalled();
    });

    it('returns 404 for missing topics before feed-shaping calls', async () => {
        getTopicBySlugMock.mockResolvedValueOnce(null);

        const response = await getTopicFeed(
            feedRequest('/en/missing/feed.xml'),
            topicParams('en', 'missing'),
        );

        expect(response.status).toBe(404);
        expect(getTopicBySlugMock).toHaveBeenCalledWith('missing');
        expect(getSeoSettingsMock).not.toHaveBeenCalled();
        expect(getGalleryConfigMock).not.toHaveBeenCalled();
        expect(getTranslationsMock).not.toHaveBeenCalled();
        expect(getImagesForFeedMock).not.toHaveBeenCalled();
    });

    it('returns 200 with topic-scoped rows and a content-derived ETag', async () => {
        const response = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml'),
            topicParams('en', 'landscape'),
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('ETag')).toMatch(/^W\/"atom-[A-Za-z0-9_-]{22}"$/);
        expect(getImagesForFeedMock).toHaveBeenCalledWith(50, 'landscape');

        const body = await response.text();
        expect(body).toContain('<title type="text">Landscape | Gallery Feed</title>');
        expect(body).toContain('<link rel="alternate" type="text/html" href="https://gallery.example/en/landscape"/>');
        expect(body).toContain('<media:content url="https://gallery.example/uploads/jpeg/mountain_1024.jpg"');
    });

    it('returns 304 for matching topic feed ETags', async () => {
        const first = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml'),
            topicParams('en', 'landscape'),
        );
        const etag = first.headers.get('ETag');
        expect(etag).toBeTruthy();

        const second = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml', {
                'if-none-match': etag?.replace(/^W\//, '') ?? '',
            }),
            topicParams('en', 'landscape'),
        );

        expect(second.status).toBe(304);
        expect(second.headers.get('ETag')).toBe(etag);
        expect(await second.text()).toBe('');
    });

    it('keeps empty topic-feed ETags stable across requests', async () => {
        getImagesForFeedMock.mockResolvedValue([]);

        const first = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml'),
            topicParams('en', 'landscape'),
        );
        const etag = first.headers.get('ETag');
        expect(first.status).toBe(200);
        expect(first.headers.get('Last-Modified')).toBe('Thu, 01 Jan 1970 00:00:00 GMT');
        expect(etag).toBeTruthy();

        const second = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml'),
            topicParams('en', 'landscape'),
        );
        expect(second.status).toBe(200);
        expect(second.headers.get('ETag')).toBe(etag);

        const conditional = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml', {
                'if-none-match': etag ?? '',
            }),
            topicParams('en', 'landscape'),
        );
        expect(conditional.status).toBe(304);
        expect(conditional.headers.get('ETag')).toBe(etag);
    });

    it('keeps topic If-Modified-Since informational unless If-None-Match matches', async () => {
        const first = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml'),
            topicParams('en', 'landscape'),
        );
        const lastModified = first.headers.get('Last-Modified');
        expect(lastModified).toBe('Sun, 17 May 2026 10:00:00 GMT');

        const second = await getTopicFeed(
            feedRequest('/en/landscape/feed.xml', {
                'if-modified-since': lastModified ?? '',
            }),
            topicParams('en', 'landscape'),
        );

        expect(second.status).toBe(200);
        expect(second.headers.get('ETag')).toBe(first.headers.get('ETag'));
        expect(await second.text()).toContain('<title type="text">Landscape | Gallery Feed</title>');
    });
});
