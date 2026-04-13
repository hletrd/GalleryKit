import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/lib/constants';

function normalizePath(path: string): string {
    if (!path) return '/';
    const withLeading = path.startsWith('/') ? path : `/${path}`;
    if (withLeading === '/') return '/';
    return withLeading.replace(/\/+$/, '') || '/';
}

export function stripLocalePrefix(path: string): string {
    const normalized = normalizePath(path);
    for (const locale of LOCALES) {
        if (normalized === `/${locale}`) {
            return '/';
        }
        if (normalized.startsWith(`/${locale}/`)) {
            return normalized.slice(locale.length + 1) || '/';
        }
    }
    return normalized;
}

export function getLocalePrefix(locale: string): string {
    return locale === DEFAULT_LOCALE ? '' : `/${locale}`;
}

export function localizePath(locale: string, path: string): string {
    const stripped = stripLocalePrefix(path);
    const prefix = getLocalePrefix(locale);
    return stripped === '/' ? (prefix || '/') : `${prefix}${stripped}`;
}

export function isSupportedLocale(value: string): value is Locale {
    return (LOCALES as readonly string[]).includes(value);
}
