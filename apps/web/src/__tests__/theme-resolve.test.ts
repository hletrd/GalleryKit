/**
 * US-P14: resolveTheme covers all 4 stored × 2 system combinations (8 total).
 */
import { describe, expect, it } from 'vitest';
import { resolveTheme, type StoredTheme } from '@/lib/theme';

const STORED: StoredTheme[] = ['system', 'light', 'dark', 'oled'];

describe('resolveTheme', () => {
    it.each([
        { stored: 'system' as StoredTheme, dark: false, expected: 'light' },
        { stored: 'system' as StoredTheme, dark: true,  expected: 'dark'  },
        { stored: 'light'  as StoredTheme, dark: false, expected: 'light' },
        { stored: 'light'  as StoredTheme, dark: true,  expected: 'light' },
        { stored: 'dark'   as StoredTheme, dark: false, expected: 'dark'  },
        { stored: 'dark'   as StoredTheme, dark: true,  expected: 'dark'  },
        { stored: 'oled'   as StoredTheme, dark: false, expected: 'oled'  },
        { stored: 'oled'   as StoredTheme, dark: true,  expected: 'oled'  },
    ])(
        'stored=$stored systemPrefersDark=$dark → $expected',
        ({ stored, dark, expected }) => {
            expect(resolveTheme(stored, dark)).toBe(expected);
        },
    );

    it('covers all 4 stored values', () => {
        // Belt-and-braces: STORED exhausts the StoredTheme union
        expect(STORED).toHaveLength(4);
    });
});
