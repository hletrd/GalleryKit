/**
 * US-P51: real ONNX encoder shipped — 'production' is now a valid storable
 * value for semantic_search_mode (CRT-R5C1-01 lifted).
 *
 * Valid values: 'disabled', 'stub', 'production'.
 */

import { describe, it, expect } from 'vitest';
import { isValidSettingValue } from '@/lib/gallery-config-shared';

describe('semantic_search_mode validator', () => {
    it('accepts "disabled"', () => {
        expect(isValidSettingValue('semantic_search_mode', 'disabled')).toBe(true);
    });

    it('accepts "stub"', () => {
        expect(isValidSettingValue('semantic_search_mode', 'stub')).toBe(true);
    });

    it('accepts "production" (CRT-R5C1-01 lifted: real ONNX encoder now present)', () => {
        expect(isValidSettingValue('semantic_search_mode', 'production')).toBe(true);
    });

    it('rejects arbitrary strings', () => {
        expect(isValidSettingValue('semantic_search_mode', 'enabled')).toBe(false);
        expect(isValidSettingValue('semantic_search_mode', '')).toBe(false);
        expect(isValidSettingValue('semantic_search_mode', 'true')).toBe(false);
    });
});
