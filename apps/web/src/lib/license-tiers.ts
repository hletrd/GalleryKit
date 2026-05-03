/**
 * Cycle 1 RPF / plan-100 / C1RPF-PHOTO-MED-02:
 * Single source of truth for the paid-license tier allowlist.
 *
 * Used by:
 *   - `/api/checkout/[imageId]` to map tier → admin_settings price key
 *   - `/api/stripe/webhook` to validate `session.metadata.tier` at ingest,
 *     so a misconfigured Checkout flow cannot poison the entitlements
 *     table with arbitrary tier strings.
 *   - Future admin UIs that surface tier choices.
 *
 * The string `'none'` is intentionally NOT in this allowlist — it is the
 * sentinel for "not for sale" and should never reach the entitlements
 * table or the webhook ingest path.
 */

export const PAID_LICENSE_TIERS = ['editorial', 'commercial', 'rm'] as const;

export type PaidLicenseTier = (typeof PAID_LICENSE_TIERS)[number];

export function isPaidLicenseTier(value: unknown): value is PaidLicenseTier {
    return typeof value === 'string' && (PAID_LICENSE_TIERS as readonly string[]).includes(value);
}

/** Map a paid-tier slug to the admin_settings key holding its price in cents. */
export const PAID_TIER_PRICE_KEYS: Record<PaidLicenseTier, string> = {
    editorial: 'license_price_editorial_cents',
    commercial: 'license_price_commercial_cents',
    rm: 'license_price_rm_cents',
};

/**
 * Derive a supported locale from a Referer header for use in Stripe
 * Checkout success_url / cancel_url, so the visitor lands back on the
 * same locale they came from. Returns the default locale on any miss.
 *
 * Cycle 2 RPF / P260-10 / C2-RPF-08: imports the canonical `LOCALES`
 * constant from `lib/constants.ts` instead of duplicating the literal,
 * so adding a new locale there automatically propagates here.
 */
import { LOCALES, DEFAULT_LOCALE as CONSTANTS_DEFAULT_LOCALE, type Locale } from './constants';

export type SupportedLocale = Locale;
const DEFAULT_LOCALE: SupportedLocale = CONSTANTS_DEFAULT_LOCALE;

export function deriveLocaleFromReferer(referer: string | null | undefined): SupportedLocale {
    if (!referer) return DEFAULT_LOCALE;
    let pathname: string;
    try {
        pathname = new URL(referer).pathname;
    } catch {
        return DEFAULT_LOCALE;
    }
    const m = /^\/([a-z]{2})(?:\/|$)/i.exec(pathname);
    if (!m) return DEFAULT_LOCALE;
    const cand = m[1].toLowerCase();
    return (LOCALES as readonly string[]).includes(cand)
        ? (cand as SupportedLocale)
        : DEFAULT_LOCALE;
}
