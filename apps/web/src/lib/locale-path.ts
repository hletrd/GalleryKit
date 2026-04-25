import { LOCALES, type Locale } from '@/lib/constants';

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
    return `/${locale}`;
}

export function localizePath(locale: string, path: string): string {
    const stripped = stripLocalePrefix(path);
    const prefix = getLocalePrefix(locale);
    return stripped === '/' ? (prefix || '/') : `${prefix}${stripped}`;
}

export function isSupportedLocale(value: string): value is Locale {
    return (LOCALES as readonly string[]).includes(value);
}

export function absoluteUrl(baseUrl: string, path: string): string {
    return new URL(path, baseUrl).toString();
}

export function localizeUrl(baseUrl: string, locale: string, path: string): string {
    return absoluteUrl(baseUrl, localizePath(locale, path));
}

const OPEN_GRAPH_LOCALE_BY_LOCALE: Record<Locale, string> = {
    en: 'en_US',
    ko: 'ko_KR',
};

export function getOpenGraphLocale(locale: string): string {
    return isSupportedLocale(locale)
        ? OPEN_GRAPH_LOCALE_BY_LOCALE[locale]
        : OPEN_GRAPH_LOCALE_BY_LOCALE.en;
}

export function getAlternateOpenGraphLocales(locale: string): string[] {
    const current = getOpenGraphLocale(locale);
    return Object.values(OPEN_GRAPH_LOCALE_BY_LOCALE).filter((candidate) => candidate !== current);
}
