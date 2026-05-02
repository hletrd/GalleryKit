/**
 * resolveTheme — pure helper that maps a stored theme preference and the
 * system dark-mode signal to a concrete applied theme class.
 *
 * Exported from a standalone module so vitest can import it without
 * rendering React (no next-themes dependency here).
 */

export type StoredTheme = 'system' | 'light' | 'dark' | 'oled';
export type ResolvedTheme = 'light' | 'dark' | 'oled';

/** All four valid stored theme values. */
export const THEME_VALUES: StoredTheme[] = ['system', 'light', 'dark', 'oled'];

/**
 * Resolve the applied theme given:
 *   - `stored`            — the value from localStorage (gallery_theme)
 *   - `systemPrefersDark` — true when prefers-color-scheme: dark
 *
 * Returns the concrete theme class that should be applied to <html>.
 */
export function resolveTheme(
    stored: StoredTheme,
    systemPrefersDark: boolean,
): ResolvedTheme {
    switch (stored) {
        case 'light':
            return 'light';
        case 'dark':
            return 'dark';
        case 'oled':
            return 'oled';
        case 'system':
        default:
            return systemPrefersDark ? 'dark' : 'light';
    }
}

/**
 * Return the next theme in the 4-state cycle order:
 *   system → light → dark → oled → system → …
 */
export function nextTheme(current: StoredTheme): StoredTheme {
    const idx = THEME_VALUES.indexOf(current);
    return THEME_VALUES[(idx + 1) % THEME_VALUES.length];
}
