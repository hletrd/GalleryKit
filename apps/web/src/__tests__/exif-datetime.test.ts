import { describe, expect, it } from 'vitest';

import { formatStoredExifDate, formatStoredExifTime, isValidExifDateTimeParts } from '@/lib/exif-datetime';
import { extractExifForDb } from '@/lib/process-image';

describe('isValidExifDateTimeParts', () => {
    it('accepts real calendar values', () => {
        expect(isValidExifDateTimeParts(2024, 2, 29, 23, 59, 59)).toBe(true);
    });

    it('rejects impossible calendar values', () => {
        expect(isValidExifDateTimeParts(2024, 2, 30, 12, 0, 0)).toBe(false);
        expect(isValidExifDateTimeParts(2023, 2, 29, 12, 0, 0)).toBe(false);
    });
});

describe('stored EXIF formatting', () => {
    it('returns null for impossible stored dates instead of normalizing them', () => {
        expect(formatStoredExifDate('2024-02-31 10:00:00', 'en-US')).toBeNull();
        expect(formatStoredExifTime('2024-02-31 10:00:00', 'en-US')).toBeNull();
    });

    it('formats valid stored dates and times', () => {
        expect(formatStoredExifDate('2024-02-29 10:00:00', 'en-US')).toContain('2024');
        expect(formatStoredExifTime('2024-02-29 10:00:00', 'en-US')).toContain('10');
    });
});

describe('extractExifForDb', () => {
    it('drops impossible EXIF calendar values', () => {
        expect(extractExifForDb({
            exif: {
                DateTimeOriginal: '2024:02:31 10:00:00',
            },
        }).capture_date).toBeUndefined();
    });

    it('preserves valid EXIF calendar values', () => {
        expect(extractExifForDb({
            exif: {
                DateTimeOriginal: '2024:02:29 10:00:00',
            },
        }).capture_date).toBe('2024-02-29 10:00:00');
    });
});
