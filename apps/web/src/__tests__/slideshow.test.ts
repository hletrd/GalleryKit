/**
 * Unit tests for slideshow and Ken Burns pure functions.
 * Tests cover: getKenBurnsVariant, kenBurnsTransform, parseSlideshowInterval.
 */
import { describe, it, expect } from 'vitest';
import { getKenBurnsVariant, kenBurnsTransform } from '@/components/lightbox';
import { parseSlideshowInterval, SLIDESHOW_INTERVAL_DEFAULT, SLIDESHOW_INTERVAL_MIN, SLIDESHOW_INTERVAL_MAX } from '@/lib/gallery-config-shared';

describe('getKenBurnsVariant', () => {
    it('returns 0 for even image ids', () => {
        expect(getKenBurnsVariant(0)).toBe(0);
        expect(getKenBurnsVariant(2)).toBe(0);
        expect(getKenBurnsVariant(100)).toBe(0);
    });

    it('returns 1 for odd image ids', () => {
        expect(getKenBurnsVariant(1)).toBe(1);
        expect(getKenBurnsVariant(3)).toBe(1);
        expect(getKenBurnsVariant(101)).toBe(1);
    });

    it('alternates between consecutive ids', () => {
        const variants = [1, 2, 3, 4, 5].map(getKenBurnsVariant);
        expect(variants).toEqual([1, 0, 1, 0, 1]);
    });
});

describe('kenBurnsTransform', () => {
    it('variant 0 start is identity transform', () => {
        const t = kenBurnsTransform(0, 'start');
        expect(t).toContain('scale(1)');
        expect(t).toContain('translate(0%, 0%)');
    });

    it('variant 0 end zooms and pans negative direction', () => {
        const t = kenBurnsTransform(0, 'end');
        expect(t).toContain('scale(1.08)');
        // pans toward top-right (negative translate)
        expect(t).toContain('translate(-2%, -2%)');
    });

    it('variant 1 start is identity transform', () => {
        const t = kenBurnsTransform(1, 'start');
        expect(t).toContain('scale(1)');
        expect(t).toContain('translate(0%, 0%)');
    });

    it('variant 1 end zooms and pans positive direction', () => {
        const t = kenBurnsTransform(1, 'end');
        expect(t).toContain('scale(1.08)');
        // pans toward bottom-right (positive translate)
        expect(t).toContain('translate(2%, 2%)');
    });

    it('start and end transforms differ for each variant', () => {
        expect(kenBurnsTransform(0, 'start')).not.toBe(kenBurnsTransform(0, 'end'));
        expect(kenBurnsTransform(1, 'start')).not.toBe(kenBurnsTransform(1, 'end'));
    });

    it('variant 0 and variant 1 end transforms differ', () => {
        expect(kenBurnsTransform(0, 'end')).not.toBe(kenBurnsTransform(1, 'end'));
    });
});

describe('parseSlideshowInterval', () => {
    it('returns default for undefined', () => {
        expect(parseSlideshowInterval(undefined)).toBe(SLIDESHOW_INTERVAL_DEFAULT);
    });

    it('returns default for empty string', () => {
        expect(parseSlideshowInterval('')).toBe(SLIDESHOW_INTERVAL_DEFAULT);
    });

    it('returns default for non-numeric string', () => {
        expect(parseSlideshowInterval('abc')).toBe(SLIDESHOW_INTERVAL_DEFAULT);
    });

    it('returns default for value below minimum', () => {
        expect(parseSlideshowInterval(String(SLIDESHOW_INTERVAL_MIN - 1))).toBe(SLIDESHOW_INTERVAL_DEFAULT);
    });

    it('returns default for value above maximum', () => {
        expect(parseSlideshowInterval(String(SLIDESHOW_INTERVAL_MAX + 1))).toBe(SLIDESHOW_INTERVAL_DEFAULT);
    });

    it('accepts minimum boundary value', () => {
        expect(parseSlideshowInterval(String(SLIDESHOW_INTERVAL_MIN))).toBe(SLIDESHOW_INTERVAL_MIN);
    });

    it('accepts maximum boundary value', () => {
        expect(parseSlideshowInterval(String(SLIDESHOW_INTERVAL_MAX))).toBe(SLIDESHOW_INTERVAL_MAX);
    });

    it('accepts default value itself', () => {
        expect(parseSlideshowInterval(String(SLIDESHOW_INTERVAL_DEFAULT))).toBe(SLIDESHOW_INTERVAL_DEFAULT);
    });

    it('accepts a mid-range value', () => {
        expect(parseSlideshowInterval('10')).toBe(10);
    });

    it('rejects non-integer values', () => {
        expect(parseSlideshowInterval('3.5')).toBe(SLIDESHOW_INTERVAL_DEFAULT);
    });
});

describe('slideshow advance logic (pure wrap)', () => {
    it('wraps from last image to first', () => {
        const images = [{ id: 10 }, { id: 20 }, { id: 30 }];
        const currentIndex = 2; // last
        const nextIndex = (currentIndex + 1) % images.length;
        expect(nextIndex).toBe(0);
        expect(images[nextIndex].id).toBe(10);
    });

    it('advances normally within array', () => {
        const images = [{ id: 10 }, { id: 20 }, { id: 30 }];
        const currentIndex = 0;
        const nextIndex = (currentIndex + 1) % images.length;
        expect(nextIndex).toBe(1);
        expect(images[nextIndex].id).toBe(20);
    });

    it('wraps single-image array to itself', () => {
        const images = [{ id: 42 }];
        const currentIndex = 0;
        const nextIndex = (currentIndex + 1) % images.length;
        expect(nextIndex).toBe(0);
        expect(images[nextIndex].id).toBe(42);
    });
});
