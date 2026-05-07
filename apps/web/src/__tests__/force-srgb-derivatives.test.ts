import { describe, it, expect } from 'vitest';
import { resolveAvifIccProfile } from '@/lib/process-image';
import { isValidSettingValue, getSettingDefaults } from '@/lib/gallery-config-shared';

describe('force_srgb_derivatives setting', () => {
    it('has a default of false', () => {
        const defaults = getSettingDefaults();
        expect(defaults.force_srgb_derivatives).toBe('false');
    });

    it('accepts only true/false', () => {
        expect(isValidSettingValue('force_srgb_derivatives', 'true')).toBe(true);
        expect(isValidSettingValue('force_srgb_derivatives', 'false')).toBe(true);
        expect(isValidSettingValue('force_srgb_derivatives', 'yes')).toBe(false);
        expect(isValidSettingValue('force_srgb_derivatives', '')).toBe(false);
        expect(isValidSettingValue('force_srgb_derivatives', '1')).toBe(false);
    });
});

describe('targetIcc decision matrix (US-CM02)', () => {
    // Mirror the logic from processImageFormats for pure-function testing.
    // US-CM03: 'p3-from-wide' (Adobe RGB / ProPhoto / Rec.2020) is treated
    // as wide-gamut same as 'p3' for derivative tagging purposes.
    function getTargetIcc(avifIcc: import('@/lib/process-image').AvifIccDecision, forceSrgbDerivatives: boolean): 'p3' | 'srgb' {
        const isWideGamutSource = avifIcc === 'p3' || avifIcc === 'p3-from-wide';
        return (isWideGamutSource && !forceSrgbDerivatives) ? 'p3' : 'srgb';
    }

    it('P3 source + forceSrgbDerivatives=false → P3', () => {
        const avifIcc = resolveAvifIccProfile('Display P3');
        expect(avifIcc).toBe('p3');
        expect(getTargetIcc(avifIcc, false)).toBe('p3');
    });

    it('P3 source + forceSrgbDerivatives=true → sRGB', () => {
        const avifIcc = resolveAvifIccProfile('Display P3');
        expect(avifIcc).toBe('p3');
        expect(getTargetIcc(avifIcc, true)).toBe('srgb');
    });

    it('sRGB source + forceSrgbDerivatives=false → sRGB', () => {
        const avifIcc = resolveAvifIccProfile('sRGB IEC61966-2.1');
        expect(avifIcc).toBe('srgb');
        expect(getTargetIcc(avifIcc, false)).toBe('srgb');
    });

    it('sRGB source + forceSrgbDerivatives=true → sRGB', () => {
        const avifIcc = resolveAvifIccProfile('sRGB IEC61966-2.1');
        expect(avifIcc).toBe('srgb');
        expect(getTargetIcc(avifIcc, true)).toBe('srgb');
    });

    it('unknown source + forceSrgbDerivatives=false → sRGB', () => {
        const avifIcc = resolveAvifIccProfile(null);
        expect(avifIcc).toBe('srgb');
        expect(getTargetIcc(avifIcc, false)).toBe('srgb');
    });

    it('DCI-P3 source + forceSrgbDerivatives=false → P3', () => {
        const avifIcc = resolveAvifIccProfile('DCI-P3');
        expect(avifIcc).toBe('p3');
        expect(getTargetIcc(avifIcc, false)).toBe('p3');
    });
});
