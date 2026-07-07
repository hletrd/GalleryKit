import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const rows: Array<{ id: number; capture_date: string | null }> = [];
    const limit = vi.fn(async () => rows);
    const orderBy = vi.fn(() => ({ limit }));
    const groupBy = vi.fn(() => ({ orderBy }));
    const where = vi.fn(() => ({ groupBy }));
    const leftJoinTags = vi.fn(() => ({ where }));
    const leftJoinImageTags = vi.fn(() => ({ leftJoin: leftJoinTags }));
    const from = vi.fn(() => ({ leftJoin: leftJoinImageTags }));
    const select = vi.fn(() => ({ from }));
    const tableProxy = (name: string) => new Proxy({}, {
        get: (_target, prop) => `${name}.${String(prop)}`,
    });

    return {
        rows,
        select,
        from,
        leftJoinImageTags,
        leftJoinTags,
        where,
        groupBy,
        orderBy,
        limit,
        tableProxy,
        and: vi.fn((...conditions: unknown[]) => ({ kind: 'and', conditions })),
        desc: vi.fn((expression: unknown) => ({ kind: 'desc', expression })),
        eq: vi.fn((left: unknown, right: unknown) => ({ kind: 'eq', left, right })),
        gte: vi.fn((left: unknown, right: unknown) => ({ kind: 'gte', left, right })),
        isNotNull: vi.fn((expression: unknown) => ({ kind: 'isNotNull', expression })),
        lt: vi.fn((left: unknown, right: unknown) => ({ kind: 'lt', left, right })),
        sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    };
});

vi.mock('drizzle-orm', () => ({
    and: mocks.and,
    desc: mocks.desc,
    eq: mocks.eq,
    gte: mocks.gte,
    isNotNull: mocks.isNotNull,
    lt: mocks.lt,
    sql: mocks.sql,
}));

vi.mock('@/db', () => ({
    db: {
        select: mocks.select,
    },
    images: mocks.tableProxy('images'),
    imageTags: mocks.tableProxy('image_tags'),
    tags: mocks.tableProxy('tags'),
}));

import { getYearInReviewImages } from '@/lib/data-timeline';

describe('data-timeline.ts — getYearInReviewImages behavior', () => {
    beforeEach(() => {
        mocks.rows.splice(0, mocks.rows.length);
        vi.clearAllMocks();
    });

    it('groups by parsed MySQL DATETIME parts and skips invalid capture dates', async () => {
        mocks.rows.push(
            { id: 1, capture_date: '2024-02-29 23:30:00' },
            { id: 2, capture_date: '2024-03-10 02:30:00' },
            { id: 3, capture_date: '2024-12-31 23:59:59' },
            { id: 4, capture_date: '2023-02-29 12:00:00' },
            { id: 5, capture_date: null },
        );

        const review = await getYearInReviewImages(2024);

        expect(review.truncated).toBe(false);
        expect(review.sections.map((section) => section.month)).toEqual([12, 3, 2]);
        expect(review.sections.map((section) => section.images.map((image) => image.id))).toEqual([[3], [2], [1]]);
        expect(mocks.limit).toHaveBeenCalledWith(501);
    });
});
