/**
 * R9-H1: Lock the P3 ICC name allowlist so future changes can't accidentally
 * re-introduce substring matching that falsely matches "ProPhoto".
 */
import { describe, it, expect } from 'vitest';
import { isP3IccName } from '@/components/color-details-section';

describe('isP3IccName — P3 badge allowlist (R9-H1)', () => {
    it('returns true for Display P3 ICC names', () => {
        expect(isP3IccName('Display P3')).toBe(true);
        expect(isP3IccName('display p3')).toBe(true);
        expect(isP3IccName('  Display P3  ')).toBe(true);
    });

    it('returns true for P3-D65 ICC names', () => {
        expect(isP3IccName('P3-D65')).toBe(true);
        expect(isP3IccName('p3-d65')).toBe(true);
    });

    it('returns true for DCI-P3 ICC names', () => {
        expect(isP3IccName('DCI-P3')).toBe(true);
        expect(isP3IccName('dci-p3')).toBe(true);
        expect(isP3IccName('DCI-P3 (D50)')).toBe(true);
    });

    it('returns false for ProPhoto (the R9-H1 regression)', () => {
        expect(isP3IccName('ProPhoto RGB')).toBe(false);
        expect(isP3IccName('ProPhoto RGB (1998)')).toBe(false);
        expect(isP3IccName('prophoto')).toBe(false);
    });

    it('returns false for other wide-gamut names', () => {
        expect(isP3IccName('Adobe RGB (1998)')).toBe(false);
        expect(isP3IccName('Rec. 2020')).toBe(false);
        expect(isP3IccName('sRGB IEC61966-2.1')).toBe(false);
    });
});
