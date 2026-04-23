import { describe, expect, it } from 'vitest';

import { normalizePaginatedRows } from '@/lib/data';

describe('normalizePaginatedRows', () => {
    it('keeps the visible rows, exact total count, and hasMore flag aligned', () => {
        const rows = [
            { id: 1, title: 'one', total_count: 5 },
            { id: 2, title: 'two', total_count: 5 },
            { id: 3, title: 'three', total_count: 5 },
        ];

        expect(normalizePaginatedRows(rows, 2)).toEqual({
            rows: [
                { id: 1, title: 'one' },
                { id: 2, title: 'two' },
            ],
            totalCount: 5,
            hasMore: true,
        });
    });

    it('returns zero total count and no extra rows for an empty page', () => {
        expect(normalizePaginatedRows([], 30)).toEqual({
            rows: [],
            totalCount: 0,
            hasMore: false,
        });
    });
});
