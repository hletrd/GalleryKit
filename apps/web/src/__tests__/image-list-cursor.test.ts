import { describe, expect, it } from 'vitest';
import { normalizeImageListCursor } from '@/lib/data';

describe('normalizeImageListCursor', () => {
    it('accepts MySQL datetime strings and null capture dates', () => {
        const cursor = normalizeImageListCursor({
            id: 42,
            capture_date: null,
            created_at: '2026-04-29 10:01:00',
        });

        expect(cursor).toMatchObject({
            id: 42,
            capture_date: null,
            created_at: new Date('2026-04-29 10:01:00'),
        });
    });

    it('accepts ISO UTC created_at and MySQL capture_date strings', () => {
        const cursor = normalizeImageListCursor({
            id: 42,
            capture_date: '2026-04-29 10:00:00',
            created_at: '2026-04-29T10:01:00.123Z',
        });

        expect(cursor).toMatchObject({
            id: 42,
            capture_date: '2026-04-29 10:00:00',
            created_at: new Date('2026-04-29T10:01:00.123Z'),
        });
    });

    it('rejects slash dates and other parseable-but-unsupported strings', () => {
        expect(normalizeImageListCursor({
            id: 42,
            capture_date: '2026/04/29 10:00:00',
            created_at: '2026-04-29 10:01:00',
        })).toBeNull();
        expect(normalizeImageListCursor({
            id: 42,
            capture_date: '2026-04-29 10:00:00',
            created_at: 'April 29, 2026 10:01:00',
        })).toBeNull();
    });

    it('rejects invalid dates, overlong strings, and invalid ids', () => {
        expect(normalizeImageListCursor({
            id: 42,
            capture_date: '2026-04-29 10:00:00',
            created_at: '2026-99-99 10:01:00',
        })).toBeNull();
        expect(normalizeImageListCursor({
            id: 42,
            capture_date: '2026-04-29 10:00:00'.repeat(3),
            created_at: '2026-04-29 10:01:00',
        })).toBeNull();
        expect(normalizeImageListCursor({
            id: 0,
            capture_date: '2026-04-29 10:00:00',
            created_at: '2026-04-29 10:01:00',
        })).toBeNull();
        expect(normalizeImageListCursor({
            id: 42.5,
            capture_date: '2026-04-29 10:00:00',
            created_at: '2026-04-29 10:01:00',
        })).toBeNull();
    });

    it('rejects non-object values', () => {
        expect(normalizeImageListCursor(null)).toBeNull();
        expect(normalizeImageListCursor('2026-04-29 10:01:00')).toBeNull();
        expect(normalizeImageListCursor(42)).toBeNull();
    });
});
