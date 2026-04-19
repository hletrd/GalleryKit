/** Supported locales — single source of truth used by middleware, layout, sitemap, and i18n config. */
export const LOCALES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Base URL for image assets. Override with IMAGE_BASE_URL env var for CDN-fronted deployments. */
export const IMAGE_BASE_URL = process.env.IMAGE_BASE_URL || '';

import siteConfig from '@/site-config.json';

/** Centralized base URL for OG metadata, JSON-LD, and canonical URLs.
 *  Override with BASE_URL env var. Falls back to site-config.json.
 *  Single source of truth prevents inconsistent URL derivation across pages. */
export const BASE_URL = process.env.BASE_URL || siteConfig.url;
