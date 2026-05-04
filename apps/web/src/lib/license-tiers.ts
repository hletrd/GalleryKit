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
 *
 * Cycle 3 / D-101-08: locale list is now sourced from the canonical
 * `lib/constants.ts` (LOCALES / DEFAULT_LOCALE). Adding a new locale
 * there will automatically broaden the Referer-derived locale set
 * without a second-touch on this file.
 *
 * Cycle 3 / D-101-12: when the Referer-derived locale is not in the
 * supported set, fall through to `accept-language` parsing instead of
 * silently landing on the default. This fixes cross-site Referer
 * scenarios where a Korean visitor with `accept-language: ko` arrives
 * via a `de`-prefixed URL and previously fell back to `en`.
 */
import { LOCALES, DEFAULT_LOCALE as CONSTANTS_DEFAULT_LOCALE, type Locale } from '@/lib/constants';

export type SupportedLocale = Locale;
const DEFAULT_LOCALE: SupportedLocale = CONSTANTS_DEFAULT_LOCALE;

function pickLocaleFromAcceptLanguage(header: string | null | undefined): SupportedLocale | null {
    if (!header) return null;
    // Parse "ko-KR,ko;q=0.9,en;q=0.8" — pick the first 2-letter primary tag
    // that is in the supported set. We don't rank by q-value because the
    // browser-supplied order is already preference-ordered.
    const parts = header.split(',');
    for (const part of parts) {
        const tag = part.split(';')[0]?.trim().toLowerCase();
        if (!tag) continue;
        const primary = tag.split('-')[0];
        if (primary && (LOCALES as readonly string[]).includes(primary)) {
            return primary as SupportedLocale;
        }
    }
    return null;
}

export function deriveLocaleFromReferer(
    referer: string | null | undefined,
    acceptLanguage: string | null | undefined = null,
): SupportedLocale {
    if (referer) {
        let pathname: string | null = null;
        try {
            pathname = new URL(referer).pathname;
        } catch {
            pathname = null;
        }
        if (pathname) {
            const m = /^\/([a-z]{2})(?:\/|$)/i.exec(pathname);
            if (m) {
                const cand = m[1].toLowerCase();
                if ((LOCALES as readonly string[]).includes(cand)) {
                    return cand as SupportedLocale;
                }
            }
        }
    }
    // D-101-12: layer accept-language under the Referer fallback.
    const fromAccept = pickLocaleFromAcceptLanguage(acceptLanguage);
    if (fromAccept) return fromAccept;
    return DEFAULT_LOCALE;
}
