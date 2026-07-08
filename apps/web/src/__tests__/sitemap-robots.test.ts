import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_BASE_URL = 'https://gallery.test';
const STATIC_PUBLIC_PATHS = ['/timeline', '/map', '/privacy', '/about-gallerykit'];
const DEFAULT_NAV_CONFIG = { showTimelineNav: true, showMapNav: true };

const dataMocks = vi.hoisted(() => ({
    env: (() => {
        process.env.BASE_URL = 'https://gallery.test';
        return true;
    })(),
    getTopicsWithLatestUpdate: vi.fn(),
    getLatestImageUpdatedAt: vi.fn(),
    getImageIdsForSitemap: vi.fn(),
}));

const galleryConfigMocks = vi.hoisted(() => ({
    getGalleryConfig: vi.fn(),
}));

vi.mock('@/lib/data', () => dataMocks);
vi.mock('@/lib/gallery-config', () => galleryConfigMocks);

import sitemap from '@/app/sitemap';
import robots from '@/app/robots';
import { LOCALES } from '@/lib/constants';

describe('sitemap route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dataMocks.getTopicsWithLatestUpdate.mockResolvedValue([
            { slug: 'landscape', last_image_updated_at: new Date('2026-01-02T00:00:00Z') },
        ]);
        dataMocks.getLatestImageUpdatedAt.mockResolvedValue(new Date('2026-01-03T00:00:00Z'));
        dataMocks.getImageIdsForSitemap.mockResolvedValue([
            { id: 7, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-04T00:00:00Z') },
        ]);
        galleryConfigMocks.getGalleryConfig.mockResolvedValue(DEFAULT_NAV_CONFIG);
    });

    it('reserves localized homepage/topic URL budget before querying image URLs', async () => {
        await sitemap();

        // WP18 (C2-29/CRIT-02, run-10 cycle-2): reservation now also folds in
        // the global feed entry (+1) and localized per-topic feed entries
        // (LOCALES.length * topics.length), on top of the original
        // homepage+topic reservation (LOCALES.length * (1 + topics.length)).
        // With one mocked topic this reserves home, every static public path,
        // topic, topic feed, plus the global feed row.
        const expectedImageBudget = Math.floor((50000 - (LOCALES.length * (STATIC_PUBLIC_PATHS.length + 3) + 1)) / LOCALES.length);
        expect(dataMocks.getImageIdsForSitemap).toHaveBeenCalledWith(expectedImageBudget);
    });

    it('emits localized homes, static public pages, topics, images, root feed, and localized topic feeds', async () => {
        const entries = await sitemap();
        const urls = entries.map((entry) => entry.url);

        for (const locale of LOCALES) {
            expect(urls).toContain(`${TEST_BASE_URL}/${locale}`);
            for (const path of STATIC_PUBLIC_PATHS) {
                expect(urls).toContain(`${TEST_BASE_URL}/${locale}${path}`);
            }
            expect(urls).toContain(`${TEST_BASE_URL}/${locale}/landscape`);
            expect(urls).toContain(`${TEST_BASE_URL}/${locale}/p/7`);
            expect(urls).toContain(`${TEST_BASE_URL}/${locale}/landscape/feed.xml`);
        }
        expect(urls).toContain(`${TEST_BASE_URL}/feed.xml`);
    });

    it('uses image updated_at for photo lastModified when available', async () => {
        const entries = await sitemap();
        const photoEntry = entries.find((entry) => entry.url === `${TEST_BASE_URL}/${LOCALES[0]}/p/7`);

        expect(photoEntry?.lastModified).toEqual(new Date('2026-01-04T00:00:00Z'));
    });

    it('omits disabled timeline and map discovery links from the sitemap', async () => {
        galleryConfigMocks.getGalleryConfig.mockResolvedValueOnce({
            showTimelineNav: false,
            showMapNav: false,
        });

        const entries = await sitemap();
        const urls = entries.map((entry) => entry.url);

        for (const locale of LOCALES) {
            expect(urls).not.toContain(`${TEST_BASE_URL}/${locale}/timeline`);
            expect(urls).not.toContain(`${TEST_BASE_URL}/${locale}/map`);
            expect(urls).toContain(`${TEST_BASE_URL}/${locale}/privacy`);
            expect(urls).toContain(`${TEST_BASE_URL}/${locale}/about-gallerykit`);
        }
    });

    it('falls back to localized homepages when sitemap data queries fail', async () => {
        dataMocks.getTopicsWithLatestUpdate.mockRejectedValueOnce(new Error('db down'));

        const entries = await sitemap();
        const urls = entries.map((entry) => entry.url);

        expect(urls).toEqual([
            ...LOCALES.map((locale) => `${TEST_BASE_URL}/${locale}`),
            ...STATIC_PUBLIC_PATHS.flatMap((path) => LOCALES.map((locale) => `${TEST_BASE_URL}/${locale}${path}`)),
            `${TEST_BASE_URL}/feed.xml`,
        ]);
        expect(dataMocks.getImageIdsForSitemap).not.toHaveBeenCalled();
    });
});

describe('sitemap URL budget boundary (WP18 / C2-29)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dataMocks.getLatestImageUpdatedAt.mockResolvedValue(new Date('2026-01-03T00:00:00Z'));
        galleryConfigMocks.getGalleryConfig.mockResolvedValue(DEFAULT_NAV_CONFIG);
    });

    it('reserves budget for the global feed row and per-topic feed rows so the image query never overshoots MAX_SITEMAP_URLS', async () => {
        const topicCount = 100;
        const mockTopics = Array.from({ length: topicCount }, (_, i) => ({
            slug: `topic-${i}`,
            last_image_updated_at: new Date('2026-01-02T00:00:00Z'),
        }));
        dataMocks.getTopicsWithLatestUpdate.mockResolvedValue(mockTopics);
        // A well-behaved image query respects the requested limit.
        dataMocks.getImageIdsForSitemap.mockImplementation(async (limit: number) =>
            Array.from({ length: limit }, (_, i) => ({
                id: i + 1,
                created_at: new Date('2026-01-01T00:00:00Z'),
                updated_at: new Date('2026-01-01T00:00:00Z'),
            })),
        );

        const entries = await sitemap();

        // reservedNonImageUrls = L*(1+S+T) + 1 + L*T
        // (homepage + static public paths + topics, global feed row, and
        // localized per-topic feed rows).
        const reservedNonImageUrls = LOCALES.length * (1 + STATIC_PUBLIC_PATHS.length + topicCount) + 1 + LOCALES.length * topicCount;
        const expectedBudget = Math.floor((50000 - reservedNonImageUrls) / LOCALES.length);
        expect(dataMocks.getImageIdsForSitemap).toHaveBeenCalledWith(expectedBudget);

        expect(entries.length).toBeLessThanOrEqual(50000);

        const feedUrls = entries.map((e) => e.url).filter((u) => u.endsWith('/feed.xml'));
        // 1 global feed + one per-topic-per-locale feed.
        expect(feedUrls.length).toBe(1 + LOCALES.length * topicCount);
    });

    it('clamps the final entry list to MAX_SITEMAP_URLS even if the image query over-returns', async () => {
        const topicCount = 5;
        const mockTopics = Array.from({ length: topicCount }, (_, i) => ({
            slug: `topic-${i}`,
            last_image_updated_at: new Date('2026-01-02T00:00:00Z'),
        }));
        dataMocks.getTopicsWithLatestUpdate.mockResolvedValue(mockTopics);
        // Simulate a query that ignores the requested budget and returns far
        // more rows than asked — the reservation arithmetic alone would then
        // be insufficient; the final `.slice(0, MAX_SITEMAP_URLS)` must hold.
        dataMocks.getImageIdsForSitemap.mockResolvedValue(
            Array.from({ length: 60000 }, (_, i) => ({
                id: i + 1,
                created_at: new Date('2026-01-01T00:00:00Z'),
                updated_at: new Date('2026-01-01T00:00:00Z'),
            })),
        );

        const entries = await sitemap();

        expect(entries.length).toBe(50000);
    });
});

describe('robots route', () => {
    it('allows public pages while disallowing admin and API crawl surfaces', () => {
        const result = robots();
        const disallow = Array.isArray(result.rules) ? result.rules[0]?.disallow : result.rules.disallow;
        const allow = Array.isArray(result.rules) ? result.rules[0]?.allow : result.rules.allow;

        expect(result.sitemap).toBe(`${TEST_BASE_URL}/sitemap.xml`);
        expect(result.rules).toMatchObject({ userAgent: '*' });
        expect(allow).toContain('/');
        expect(allow).toContain('/api/og');
        expect(allow).toContain('/api/og/');
        expect(allow).toContain('/api/og/photo/');
        expect(disallow).toContain('/admin');
        expect(disallow).toContain('/api/');
        for (const locale of LOCALES) {
            expect(disallow).toContain(`/${locale}/admin`);
            expect(disallow).toContain(`/${locale}/admin/`);
        }
    });
});
