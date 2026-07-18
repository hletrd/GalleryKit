import { describe, expect, it } from 'vitest';
import {
    ARCHIVE_MASONRY_SIZES,
    SHARED_GROUP_MASONRY_SIZES,
    estimateMasonryCardWidth,
    getEffectiveMasonryColumns,
    getMainMasonrySizes,
    quantizeMasonryContainerWidth,
} from '@/lib/responsive-masonry';

describe('responsive masonry source-size policy', () => {
    it('aligns the full archive policy with inclusive Tailwind breakpoints', () => {
        expect(ARCHIVE_MASONRY_SIZES).toBe(
            '(min-width: 1536px) 20vw, (min-width: 1280px) 25vw, '
            + '(min-width: 768px) 33vw, (min-width: 640px) 50vw, 100vw',
        );
    });

    it('aligns shared groups with their md/lg/xl 2/3/4-column transitions', () => {
        expect(SHARED_GROUP_MASONRY_SIZES).toBe(
            '(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, '
            + '(min-width: 768px) 50vw, 100vw',
        );
    });

    it('keeps a one-photo gallery full width at every breakpoint', () => {
        expect(getMainMasonrySizes(1)).toBe(
            '(min-width: 1536px) 100vw, (min-width: 1280px) 100vw, '
            + '(min-width: 768px) 100vw, (min-width: 640px) 100vw, 100vw',
        );
    });

    it('never advertises more columns than sparse galleries render', () => {
        expect(getMainMasonrySizes(2)).toContain('(min-width: 1536px) 50vw');
        expect(getMainMasonrySizes(3)).toContain('(min-width: 1536px) 33vw');
        expect(getMainMasonrySizes(4)).toContain('(min-width: 1536px) 25vw');
        expect(getMainMasonrySizes(5)).toBe(ARCHIVE_MASONRY_SIZES);
        expect(getMainMasonrySizes(50)).toBe(ARCHIVE_MASONRY_SIZES);
    });

    it('uses the one-column safe floor for empty or invalid counts', () => {
        expect(getMainMasonrySizes(0)).toBe(getMainMasonrySizes(1));
        expect(getMainMasonrySizes(Number.NaN)).toBe(getMainMasonrySizes(1));
    });

    it.each([
        { items: 0, maximum: 5, expected: 1 },
        { items: Number.NaN, maximum: 5, expected: 1 },
        { items: 2, maximum: 5, expected: 2 },
        { items: 4, maximum: 3, expected: 3 },
        { items: 50, maximum: 5, expected: 5 },
        { items: 2, maximum: Number.NaN, expected: 1 },
    ])('caps $items items at $maximum columns', ({ items, maximum, expected }) => {
        expect(getEffectiveMasonryColumns(items, maximum)).toBe(expected);
    });

    it.each([
        { width: 0, expected: 0 },
        { width: Number.NaN, expected: 0 },
        { width: -100, expected: 0 },
        { width: 288, expected: 288 },
        { width: 361, expected: 384 },
        { width: 1_504, expected: 1_488 },
    ])('quantizes measured container width $width to $expected', ({ width, expected }) => {
        expect(quantizeMasonryContainerWidth(width)).toBe(expected);
    });

    it.each([
        { width: 0, columns: 1, expected: 300 },
        { width: Number.NaN, columns: 2, expected: 300 },
        { width: 288, columns: 1, expected: 288 },
        { width: 1_488, columns: 2, expected: 736 },
        { width: 1_488, columns: 5, expected: 284 },
        { width: 10, columns: 5, expected: 300 },
    ])('estimates $columns-column card width from $width as $expected', ({ width, columns, expected }) => {
        expect(estimateMasonryCardWidth(width, columns)).toBe(expected);
    });
});
