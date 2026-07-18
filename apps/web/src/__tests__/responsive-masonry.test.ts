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
            '(min-width: 1536px) 288px, (min-width: 1280px) 300px, '
            + '(min-width: 1024px) 320px, (min-width: 768px) 234px, '
            + '(min-width: 640px) 296px, calc(100vw - 32px)',
        );
    });

    it('aligns shared groups with nested padding and md/lg/xl 2/3/4-column transitions', () => {
        expect(SHARED_GROUP_MASONRY_SIZES).toBe(
            '(min-width: 1536px) 356px, (min-width: 1280px) 292px, '
            + '(min-width: 1024px) 309px, (min-width: 768px) 344px, '
            + '(min-width: 640px) 576px, calc(100vw - 64px)',
        );
    });

    it('keeps a one-photo gallery full width at every breakpoint', () => {
        expect(getMainMasonrySizes(1)).toBe(
            '(min-width: 1536px) 1504px, (min-width: 1280px) 1248px, '
            + '(min-width: 1024px) 992px, (min-width: 768px) 736px, '
            + '(min-width: 640px) 608px, calc(100vw - 32px)',
        );
    });

    it('never advertises more columns than sparse galleries render', () => {
        expect(getMainMasonrySizes(2)).toContain('(min-width: 1536px) 744px');
        expect(getMainMasonrySizes(3)).toContain('(min-width: 1536px) 490px');
        expect(getMainMasonrySizes(4)).toContain('(min-width: 1536px) 364px');
        expect(getMainMasonrySizes(5)).toBe(ARCHIVE_MASONRY_SIZES);
        expect(getMainMasonrySizes(50)).toBe(ARCHIVE_MASONRY_SIZES);
    });

    it('tracks container-width transitions even when the column count stays constant', () => {
        expect(getMainMasonrySizes(3)).toBe(
            '(min-width: 1536px) 490px, (min-width: 1280px) 405px, '
            + '(min-width: 1024px) 320px, (min-width: 768px) 234px, '
            + '(min-width: 640px) 296px, calc(100vw - 32px)',
        );
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
