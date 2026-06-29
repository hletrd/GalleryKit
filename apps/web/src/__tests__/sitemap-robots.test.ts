import { beforeEach, describe, expect, it, vi } from 'vitest';

const TEST_BASE_URL = 'https://gallery.test';

const dataMocks = vi.hoisted(() => ({
    env: (() => {
        process.env.BASE_URL = 'https://gallery.test';
        return true;
    })(),
    getTopics: vi.fn(),
    getLatestImageUpdatedAt: vi.fn(),
    getImageIdsForSitemap: vi.fn(),
}));

vi.mock('@/lib/data', () => dataMocks);

import sitemap from '@/app/sitemap';
import robots from '@/app/robots';
import { LOCALES } from '@/lib/constants';

describe('sitemap route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dataMocks.getTopics.mockResolvedValue([
            { slug: 'landscape', last_image_updated_at: new Date('2026-01-02T00:00:00Z') },
        ]);
        dataMocks.getLatestImageUpdatedAt.mockResolvedValue(new Date('2026-01-03T00:00:00Z'));
        dataMocks.getImageIdsForSitemap.mockResolvedValue([
            { id: 7, created_at: new Date('2026-01-01T00:00:00Z'), updated_at: new Date('2026-01-04T00:00:00Z') },
        ]);
    });

    it('reserves localized homepage/topic URL budget before querying image URLs', async () => {
        await sitemap();

        const expectedImageBudget = Math.floor((50000 - LOCALES.length * 2) / LOCALES.length);
        expect(dataMocks.getImageIdsForSitemap).toHaveBeenCalledWith(expectedImageBudget);
    });

    it('emits localized homes, topics, images, root feed, and localized topic feeds', async () => {
        const entries = await sitemap();
        const urls = entries.map((entry) => entry.url);

        for (const locale of LOCALES) {
            expect(urls).toContain(`${TEST_BASE_URL}/${locale}`);
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

    it('falls back to localized homepages when sitemap data queries fail', async () => {
        dataMocks.getTopics.mockRejectedValueOnce(new Error('db down'));

        const entries = await sitemap();
        const urls = entries.map((entry) => entry.url);

        expect(urls).toEqual(LOCALES.map((locale) => `${TEST_BASE_URL}/${locale}`).concat(`${TEST_BASE_URL}/feed.xml`));
        expect(dataMocks.getImageIdsForSitemap).not.toHaveBeenCalled();
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
