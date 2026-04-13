'use client';

import { useTranslations, useLocale } from 'next-intl';

/**
 * Convenience wrapper around next-intl's hooks.
 *
 * Returns both `t` (translation function) and `locale` (current locale string)
 * in a single destructuring call, avoiding the need to import and call two
 * separate hooks in every component. This is the standard way to access
 * translations in client components throughout the app.
 *
 * Usage: const { t, locale } = useTranslation();
 */
export function useTranslation() {
    const t = useTranslations();
    const locale = useLocale();
    return { t, locale };
}
