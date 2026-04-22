import { describe, expect, it } from 'vitest';

import { shouldAutoHideLightboxControls } from '@/components/lightbox';

describe('shouldAutoHideLightboxControls', () => {
    it('only auto-hides controls for hover-capable fine pointers', () => {
        expect(shouldAutoHideLightboxControls(true, true)).toBe(true);
        expect(shouldAutoHideLightboxControls(true, false)).toBe(false);
        expect(shouldAutoHideLightboxControls(false, true)).toBe(false);
        expect(shouldAutoHideLightboxControls(false, false)).toBe(false);
    });
});
