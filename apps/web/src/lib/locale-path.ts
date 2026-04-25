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

const SUPPORTED_OPEN_GRAPH_LOCALES = new Set(Object.values(OPEN_GRAPH_LOCALE_BY_LOCALE));

export function normalizeOpenGraphLocale(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? '';
    return SUPPORTED_OPEN_GRAPH_LOCALES.has(normalized) ? normalized : null;
}

export function getOpenGraphLocale(locale: string, configuredLocale?: string | null): string {
    // F-6 / F-16: when the request is on a recognized route locale (e.g.
    // `/en/...`), the OG locale MUST match that route locale. Earlier the
    // admin-configured fallback (`seo.locale`) silently overrode the route
    // locale, causing English pages to advertise `ko_KR`. The configured
    // value should only act as the default for unknown / unsupported route
    // locales.
    if (isSupportedLocale(locale)) {
        return OPEN_GRAPH_LOCALE_BY_LOCALE[locale];
    }
    return normalizeOpenGraphLocale(configuredLocale)
        ?? OPEN_GRAPH_LOCALE_BY_LOCALE.en;
}

export function getAlternateOpenGraphLocales(locale: string, configuredLocale?: string | null): string[] {
    const current = getOpenGraphLocale(locale, configuredLocale);
    return Object.values(OPEN_GRAPH_LOCALE_BY_LOCALE).filter((candidate) => candidate !== current);
}

/**
 * AGG1L-LOW-04 / plan-301-C: build the hreflang `alternates.languages`
 * map for a given canonical path.
 *
 * Iterates the `LOCALES` constant so adding a new locale
 * automatically extends the alternate-language map at every consumer
 * (no inline `{ en: ..., ko: ... }` literals to keep in sync). The
 * `x-default` key points at the default locale so search engines have
 * a fallback for unsupported / unspecified locales.
 *
 * Returned object shape matches Next.js `Metadata.alternates.languages`.
 */
export function buildHreflangAlternates(baseUrl: string, path: string): Record<string, string> {
    const alternates: Record<string, string> = {};
    for (const locale of LOCALES) {
        alternates[locale] = localizeUrl(baseUrl, locale, path);
    }
    alternates['x-default'] = localizeUrl(baseUrl, DEFAULT_LOCALE, path);
    return alternates;
}
