/**
 * Validate and normalize a `blur_data_url` value before it is rendered
 * into a `style={{ backgroundImage: url(...) }}` attribute.
 *
 * The single producer of this value is `process-image.ts`, which writes
 * `data:image/jpeg;base64,...` strings derived from a Sharp pipeline.
 * This guard provides defense-in-depth so that any future code path
 * (e.g. an admin DB-restore that pulls blur values from an untrusted
 * backup, a manual SQL fixture, or a partial migration) cannot reach a
 * CSS `url()` invocation with an unexpected scheme or oversized blob.
 *
 * Failure mode if a non-conforming value reaches `<div style={url(...)}>`:
 * the browser tries to load the URL as a background image and fails
 * silently — there is no script execution path because CSS `url()` only
 * accepts URL-like syntax. CSP `img-src` already enumerates `data:` and
 * `blob:`. The risk is therefore limited to: (a) unexpected resource
 * fetches when the value is a relative URL string, (b) bloated SSR
 * payload if the value is unbounded, (c) confusion when CSP scanners
 * flag a non-image data URI on the public surface.
 *
 * Contract:
 *   - `data:image/jpeg;base64,…`
 *   - `data:image/png;base64,…`
 *   - `data:image/webp;base64,…`
 *   - capped length to keep the SSR payload predictable.
 *
 * Anything else returns `null`. Callers should treat `null` as "no
 * preview available" and fall back to the skeleton-shimmer placeholder.
 *
 * Cross-references: SR2-MED-01, SR2-LOW-01, AGG2-M01, AGG2-L03.
 */

const ALLOWED_PREFIXES = [
    'data:image/jpeg;base64,',
    'data:image/png;base64,',
    'data:image/webp;base64,',
] as const;

/**
 * Maximum payload length, in characters of the data URI string.
 * Sharp's blur output (16x16 JPEG q40) is typically 200-500 bytes
 * (~270-680 base64 chars). 4096 chars caps SSR cost while leaving
 * headroom for high-entropy images.
 */
export const MAX_BLUR_DATA_URL_LENGTH = 4096;

export function isSafeBlurDataUrl(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    if (value.length === 0 || value.length > MAX_BLUR_DATA_URL_LENGTH) return false;
    return ALLOWED_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Server-side write barrier. Returns the value if it conforms to the
 * contract, or `null` otherwise. Logs a warning on rejection so an
 * upstream regression is observable.
 */
export function assertBlurDataUrl(value: unknown): string | null {
    if (value == null) return null;
    if (isSafeBlurDataUrl(value)) return value;
    const preview = typeof value === 'string'
        ? `${value.slice(0, 24)}…`
        : typeof value;
    console.warn(`[blur-data-url] Rejecting non-conforming value: ${preview}`);
    return null;
}
