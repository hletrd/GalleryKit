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

import { archiveRange, getYearInReviewImages } from '@/lib/data-timeline';
import { parseArchiveYear } from '@/lib/archive-year';

describe('archive year domain', () => {
    it.each([
        ['0000', null],
        ['0001', null],
        ['0999', null],
        ['1000', 1000],
        ['9998', 9998],
        ['9999', 9999],
        ['10000', null],
        ['2e3', null],
    ] as const)('parses %s as %s', (input, expected) => {
        expect(parseArchiveYear(input)).toBe(expected);
    });

    it('rejects noncanonical and missing route values', () => {
        expect(parseArchiveYear(undefined)).toBeNull();
        expect(parseArchiveYear(' 2025')).toBeNull();
        expect(parseArchiveYear('+2025')).toBeNull();
    });
});

describe('data-timeline.ts — archiveRange month boundary', () => {
    // Cycle 10b AGG-C10b-06 (code-reviewer F1): the December (month === 12) wrap
    // must roll BOTH endYear and endMonth over, otherwise a per-month December
    // archive query binds an invalid `YYYY-13-01 00:00:00` MySQL DATETIME and
    // silently returns zero rows (or errors). Currently dormant (no caller passes
    // `month` today), so this pins the range values before a per-month view wires it.
    it('wraps December (month 12) to January of the next year', () => {
        expect(archiveRange(2025, 12)).toEqual({
            start: '2025-12-01 00:00:00',
            end: '2026-01-01 00:00:00',
        });
    });

    it('advances a mid-year month to the next month, same year', () => {
        expect(archiveRange(2025, 6)).toEqual({
            start: '2025-06-01 00:00:00',
            end: '2025-07-01 00:00:00',
        });
    });

    it('spans the whole year when month is omitted', () => {
        expect(archiveRange(2025)).toEqual({
            start: '2025-01-01 00:00:00',
            end: '2026-01-01 00:00:00',
        });
    });

    it('zero-pads single-digit months on both bounds', () => {
        expect(archiveRange(2025, 1)).toEqual({
            start: '2025-01-01 00:00:00',
            end: '2025-02-01 00:00:00',
        });
    });

    it('omits the unrepresentable upper bound at the maximum MySQL year', () => {
        expect(archiveRange(9999)).toEqual({
            start: '9999-01-01 00:00:00',
            end: null,
        });
        expect(archiveRange(9999, 12)).toEqual({
            start: '9999-12-01 00:00:00',
            end: null,
        });
    });

    it('keeps the last representable ordinary half-open year range', () => {
        expect(archiveRange(9998)).toEqual({
            start: '9998-01-01 00:00:00',
            end: '9999-01-01 00:00:00',
        });
    });

    it.each([0, 1, 999, 10000, 2025.5])('rejects out-of-domain year %s', (year) => {
        expect(() => archiveRange(year)).toThrow(RangeError);
    });

    it.each([0, 13, 1.5])('rejects invalid month %s', (month) => {
        expect(() => archiveRange(2025, month)).toThrow(RangeError);
    });
});

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
