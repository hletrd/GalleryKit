/** Supported locales — single source of truth used by middleware, layout, sitemap, and i18n config. */
export const LOCALES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Base URL for image assets. Override with IMAGE_BASE_URL env var for CDN-fronted deployments. */
export const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || '';
