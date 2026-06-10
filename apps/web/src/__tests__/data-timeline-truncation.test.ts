/**
 * R4C6 COR-R4C6-02: timeline truncation honesty.
 *
 * Behavioral half: getTimelineImages fetches limit+1 and reports
 * `truncated` without leaking the lookahead row; getYearInReviewImages
 * propagates the flag.
 * Contract half: both public pages render the localized notice when
 * truncated, so the surface can never silently misrepresent a year.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const limitMock = vi.fn();

function chainTo<T>(terminal: T) {
    // db.select().from().leftJoin().leftJoin().where().groupBy().orderBy().limit()
    const chain = {
        from: () => chain,
        leftJoin: () => chain,
        where: () => chain,
        groupBy: () => chain,
        orderBy: () => chain,
        limit: terminal,
    };
    return chain;
}

vi.mock('@/db', () => ({
    db: {
        select: () => chainTo(limitMock),
        selectDistinct: () => chainTo(limitMock),
    },
    images: {
        id: 'images.id', processed: 'images.processed',
        capture_date: 'images.capture_date', created_at: 'images.created_at',
        filename_avif: 'images.filename_avif', filename_webp: 'images.filename_webp',
        filename_jpeg: 'images.filename_jpeg', width: 'images.width', height: 'images.height',
        original_width: 'images.original_width', original_height: 'images.original_height',
        title: 'images.title', description: 'images.description', topic: 'images.topic',
        camera_model: 'images.camera_model', lens_model: 'images.lens_model',
        iso: 'images.iso', f_number: 'images.f_number', exposure_time: 'images.exposure_time',
        focal_length: 'images.focal_length', color_space: 'images.color_space',
        white_balance: 'images.white_balance', metering_mode: 'images.metering_mode',
        exposure_compensation: 'images.exposure_compensation',
        exposure_program: 'images.exposure_program', flash: 'images.flash',
        bit_depth: 'images.bit_depth',
    },
    imageTags: { imageId: 'image_tags.image_id', tagId: 'image_tags.tag_id' },
    tags: { id: 'tags.id', name: 'tags.name' },
}));

import { getTimelineImages, getYearInReviewImages, TIMELINE_PAGE_LIMIT } from '@/lib/data-timeline';

function makeRows(n: number, year = 2024) {
    return Array.from({ length: n }, (_, i) => ({
        id: i + 1,
        capture_date: `${year}-0${1 + (i % 9)}-15 12:00:00`,
        filename_jpeg: `f${i}.jpg`,
    }));
}

beforeEach(() => {
    limitMock.mockReset();
});

describe('getTimelineImages truncation lookahead (R4C6 COR-R4C6-02)', () => {
    it('requests limit+1 rows', async () => {
        limitMock.mockResolvedValueOnce(makeRows(3));
        await getTimelineImages(2024);
        expect(limitMock).toHaveBeenCalledWith(TIMELINE_PAGE_LIMIT + 1);
    });

    it('truncated=false and all rows returned below the cap', async () => {
        limitMock.mockResolvedValueOnce(makeRows(3));
        const page = await getTimelineImages(2024);
        expect(page.truncated).toBe(false);
        expect(page.images).toHaveLength(3);
    });

    it('truncated=false at EXACTLY the cap (no lookahead row exists)', async () => {
        limitMock.mockResolvedValueOnce(makeRows(TIMELINE_PAGE_LIMIT));
        const page = await getTimelineImages(2024);
        expect(page.truncated).toBe(false);
        expect(page.images).toHaveLength(TIMELINE_PAGE_LIMIT);
    });

    it('truncated=true at cap+1 and the lookahead row is dropped', async () => {
        limitMock.mockResolvedValueOnce(makeRows(TIMELINE_PAGE_LIMIT + 1));
        const page = await getTimelineImages(2024);
        expect(page.truncated).toBe(true);
        expect(page.images).toHaveLength(TIMELINE_PAGE_LIMIT);
    });
});

describe('getYearInReviewImages propagation', () => {
    it('propagates truncated=true and still groups by month', async () => {
        limitMock.mockResolvedValueOnce(makeRows(TIMELINE_PAGE_LIMIT + 1));
        const review = await getYearInReviewImages(2024);
        expect(review.truncated).toBe(true);
        expect(review.sections.length).toBeGreaterThan(0);
        const total = review.sections.reduce((acc, s) => acc + s.images.length, 0);
        expect(total).toBe(TIMELINE_PAGE_LIMIT);
    });

    it('empty year → empty sections, truncated=false', async () => {
        limitMock.mockResolvedValueOnce([]);
        const review = await getYearInReviewImages(2024);
        expect(review.sections).toEqual([]);
        expect(review.truncated).toBe(false);
    });
});

describe('page source contracts — the notice is rendered when truncated', () => {
    const pages = [
        'app/[locale]/(public)/timeline/page.tsx',
        'app/[locale]/(public)/year/[year]/page.tsx',
    ];
    for (const rel of pages) {
        it(`${rel} renders t('truncationNotice') behind the truncated flag`, () => {
            const src = readFileSync(resolve(__dirname, '..', rel), 'utf-8');
            expect(src).toMatch(/truncated/);
            expect(src).toMatch(/t\('truncationNotice',/);
        });
    }

    it('both locales carry the truncationNotice key', () => {
        const en = JSON.parse(readFileSync(resolve(__dirname, '../../messages/en.json'), 'utf-8'));
        const ko = JSON.parse(readFileSync(resolve(__dirname, '../../messages/ko.json'), 'utf-8'));
        expect(en.timeline.truncationNotice).toContain('{count}');
        expect(ko.timeline.truncationNotice).toContain('{count}');
    });
});
