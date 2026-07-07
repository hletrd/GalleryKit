/** Supported locales — single source of truth used by middleware, layout, sitemap, and i18n config. */
export const LOCALES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

import { sanitizeImageBaseUrlSafely } from '@/lib/content-security-policy';

/**
 * Base URL for image assets. Override with the IMAGE_BASE_URL env var for
 * CDN-fronted deployments.
 *
 * SCOPE (COR-R4C16-03): this constant carries the real value on the
 * SERVER only — it is not NEXT_PUBLIC_, so client bundles resolve it to
 * ''. Client code must go through `lib/image-url.ts`, which falls back
 * to the `data-image-base` attribute stamped on `<html>` by
 * `app/[locale]/layout.tsx`. Do not consume this constant directly from
 * client components.
 */
export const IMAGE_BASE_URL = sanitizeImageBaseUrlSafely(process.env.IMAGE_BASE_URL);

import siteConfig from '@/site-config.json';

/** Centralized base URL for OG metadata, JSON-LD, and canonical URLs.
 *  Override with BASE_URL env var. Falls back to site-config.json.
 *  Single source of truth prevents inconsistent URL derivation across pages. */
export const BASE_URL = process.env.BASE_URL || siteConfig.url;
