// RESERVED — NOT WIRED. No production importer until WI-09 ships.
// CRT-R5C1-03: HDR_FEATURE_ENABLED / NEXT_PUBLIC_HDR_FEATURE_FLAG removed.
// The honesty invariant (no public HDR badge until the encoder delivers real
// HDR bytes) is enforced by the _PrivacySensitiveKeys guard in data.ts, not
// by any feature flag. WI-09 implementer: wire this helper then remove banner.
/**
 * HDR filename helpers.
 *
 * Extracted for reuse when WI-09 (HDR AVIF encoder) ships.
 * Currently unused in UI after P3-1 removed the HDR download menu item.
 */

export function deriveHdrAvifFilename(avifFilename: string): string {
    return avifFilename.replace(/\.avif$/i, (match) => '_hdr' + match);
}
