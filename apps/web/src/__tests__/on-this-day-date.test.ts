import { describe, expect, it } from 'vitest';
import { getLocalMonthDay } from '@/lib/on-this-day-date';

describe('getLocalMonthDay', () => {
    it('returns the local calendar month and day', () => {
        expect(getLocalMonthDay(new Date(2026, 5, 30))).toEqual({ month: 6, day: 30 });
    });

    it('preserves leap-day dates for on-this-day lookups', () => {
        expect(getLocalMonthDay(new Date(2024, 1, 29))).toEqual({ month: 2, day: 29 });
    });
});
