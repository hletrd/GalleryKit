/**
 * CRT-R5C1-01: gallery-config-shared validator must reject 'production' for
 * semantic_search_mode until a real ONNX encoder ships.
 *
 * 'disabled' and 'stub' are the only storable values.
 */

import { describe, it, expect } from 'vitest';
import { isValidSettingValue } from '@/lib/gallery-config-shared';

describe('semantic_search_mode validator (CRT-R5C1-01)', () => {
    it('accepts "disabled"', () => {
        expect(isValidSettingValue('semantic_search_mode', 'disabled')).toBe(true);
    });

    it('accepts "stub"', () => {
        expect(isValidSettingValue('semantic_search_mode', 'stub')).toBe(true);
    });

    it('rejects "production" (CRT-R5C1-01: stub-only encoder, no real ONNX module present)', () => {
        expect(isValidSettingValue('semantic_search_mode', 'production')).toBe(false);
    });

    it('rejects arbitrary strings', () => {
        expect(isValidSettingValue('semantic_search_mode', 'enabled')).toBe(false);
        expect(isValidSettingValue('semantic_search_mode', '')).toBe(false);
        expect(isValidSettingValue('semantic_search_mode', 'true')).toBe(false);
    });
});
