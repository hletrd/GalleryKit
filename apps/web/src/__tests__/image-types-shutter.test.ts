import { describe, expect, it } from 'vitest';
import { formatShutterSpeed } from '@/lib/image-types';

/**
 * R22C22 T3 (DBG22-02): a subnormal positive `ExposureTime` overflowed
 * `Math.round(1 / val)` to Infinity and emitted the literal string
 * "1/Infinity". The `Number.isFinite(denominator)` guard makes such values fall
 * through to the `${exposureTime}s` fallback. The `5e-324` assertion FAILS
 * against the pre-fix code (returns "1/Infinity") and PASSES with the guard.
 */
describe('formatShutterSpeed', () => {
    it('does not emit "1/Infinity" for a subnormal ExposureTime', () => {
        const out = formatShutterSpeed(String(5e-324));
        expect(out).not.toContain('Infinity');
        expect(out).toBe(`${5e-324}s`);
    });

    it('formats standard fractional shutter speeds without an s suffix', () => {
        expect(formatShutterSpeed('0.002')).toBe('1/500');
        expect(formatShutterSpeed(String(1 / 8000))).toBe('1/8000');
        expect(formatShutterSpeed('0.005')).toBe('1/200');
    });

    it('appends s to whole- and decimal-second values', () => {
        expect(formatShutterSpeed('1')).toBe('1s');
        expect(formatShutterSpeed('30')).toBe('30s');
        expect(formatShutterSpeed('1.5')).toBe('1.5s');
    });

    it('returns null for empty / missing EXIF', () => {
        expect(formatShutterSpeed(null)).toBeNull();
        expect(formatShutterSpeed('')).toBeNull();
    });

    it('passes through a non-numeric exposure string unchanged', () => {
        expect(formatShutterSpeed('not-a-number')).toBe('not-a-number');
    });
});
