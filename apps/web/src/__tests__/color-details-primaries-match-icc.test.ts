/**
 * C4-A6 / C4-COL-LOW-2: lock the `primariesMatchIccName` dedup contract so a
 * future regex tweak in `normalizeForCompare` cannot silently regress the
 * Color Details accordion's ICC + primaries dedup behavior.
 *
 * Reference: P3-30 (the original normalization fix), now exported from
 * `apps/web/src/components/color-details-section.tsx` for fixture testing.
 */
import { describe, it, expect } from 'vitest';
import {
    normalizeForCompare,
    primariesMatchIccName,
} from '@/components/color-details-section';

describe('normalizeForCompare', () => {
    it('lower-cases bare names', () => {
        expect(normalizeForCompare('Display P3')).toBe('display p3');
        expect(normalizeForCompare('Adobe RGB')).toBe('adobe rgb');
    });

    it('strips trailing parenthesized suffix', () => {
        expect(normalizeForCompare('Display P3 (ACES)')).toBe('display p3');
        expect(normalizeForCompare('Adobe RGB (1998)')).toBe('adobe rgb');
    });

    it('strips trailing "ICC profile" suffix', () => {
        expect(normalizeForCompare('Display P3 ICC Profile')).toBe('display p3');
        expect(normalizeForCompare('Adobe RGB ICC profile')).toBe('adobe rgb');
    });

    it('strips trailing "Profile" suffix', () => {
        expect(normalizeForCompare('Display P3 Profile')).toBe('display p3');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeForCompare('  Display P3  ')).toBe('display p3');
    });
});

describe('primariesMatchIccName', () => {
    it('matches identical names (identity case)', () => {
        expect(primariesMatchIccName('Display P3', 'Display P3')).toBe(true);
    });

    it('matches when ICC name has parenthesized suffix', () => {
        expect(primariesMatchIccName('Display P3', 'Display P3 (ACES)')).toBe(true);
        expect(primariesMatchIccName('Adobe RGB', 'Adobe RGB (1998)')).toBe(true);
    });

    it('matches when ICC name has "ICC profile" suffix', () => {
        expect(primariesMatchIccName('Display P3', 'Display P3 ICC Profile')).toBe(true);
    });

    it('matches when ICC name has "Profile" suffix', () => {
        expect(primariesMatchIccName('Display P3', 'Display P3 Profile')).toBe(true);
    });

    it('does NOT match different gamuts', () => {
        expect(primariesMatchIccName('Display P3', 'Adobe RGB')).toBe(false);
        expect(primariesMatchIccName('Display P3', 'Adobe RGB (1998)')).toBe(false);
    });

    it('does NOT match when primaries are missing or empty', () => {
        expect(primariesMatchIccName('', 'Display P3')).toBe(false);
        expect(primariesMatchIccName(null, 'Display P3')).toBe(false);
        expect(primariesMatchIccName(undefined, 'Display P3')).toBe(false);
    });

    it('does NOT match when ICC name is missing or empty', () => {
        expect(primariesMatchIccName('Display P3', '')).toBe(false);
        expect(primariesMatchIccName('Display P3', null)).toBe(false);
        expect(primariesMatchIccName('Display P3', undefined)).toBe(false);
    });
});
