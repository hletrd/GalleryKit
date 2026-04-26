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
 * Cycle 3 RPF loop AGG3-L02 / SR3-LOW-01 / CR3-LOW-01 / PR3-LOW-01:
 * throttle the rejection warn so a poisoned `blur_data_url` row that
 * survives a DB restore does not flood stderr on every page load
 * (route is `revalidate = 0`, so a single bad row could otherwise log
 * once per request indefinitely).
 *
 * Strategy: bounded LRU keyed by `(typeof, length, head)` tuple. The
 * tuple is coarse enough that two rejections of the same poisoned
 * value collapse to one entry, and it intentionally does NOT include
 * any of the rejected payload past the first 8 chars (the head is what
 * we already log in the warn line, so no new information is revealed).
 * Cap is enforced by oldest-entry eviction (Map iteration order is
 * insertion order in modern JS engines).
 */
const REJECTION_LOG_CAP = 256;
const rejectionLog = new Map<string, number>();

function rejectionTuple(value: unknown): string {
    if (typeof value !== 'string') return `nonstring:${typeof value}`;
    return `s:${value.length}:${value.slice(0, 8)}`;
}

function shouldEmitRejectionWarn(value: unknown): boolean {
    const key = rejectionTuple(value);
    const count = rejectionLog.get(key) ?? 0;
    rejectionLog.set(key, count + 1);
    if (rejectionLog.size > REJECTION_LOG_CAP) {
        const oldestKey = rejectionLog.keys().next().value;
        if (oldestKey !== undefined) rejectionLog.delete(oldestKey);
    }
    // Emit the first sighting; emit again every 1000 hits so a sustained
    // poisoning is observable but not spammy.
    return count === 0 || count % 1000 === 0;
}

/**
 * Test-only: reset the throttle bookkeeping. Used by the unit test so
 * a sequence of rejection assertions runs deterministically without
 * inheriting state from prior tests.
 */
export function _resetBlurDataUrlRejectionLogForTests(): void {
    rejectionLog.clear();
}

/**
 * Server-side write barrier. Returns the value if it conforms to the
 * contract, or `null` otherwise. Logs a warning on rejection so an
 * upstream regression is observable, but throttles the warn so a
 * single poisoned row cannot flood stderr.
 */
export function assertBlurDataUrl(value: unknown): string | null {
    if (value == null) return null;
    if (isSafeBlurDataUrl(value)) return value;
    if (!shouldEmitRejectionWarn(value)) return null;
    // Cycle 1 RPF loop AGG1-L01 / CR1-LOW-02 / SR1-LOW-01: redact the
    // rejected-value preview. The previous `slice(0, 24)` could leak
    // arbitrary URL contents (tokens, query params) when a non-`data:`
    // URL is rejected — for example a malicious DB-restore loading
    // `https://attacker.example/?token=...` would copy the first 24
    // chars including the token prefix into the warn log. Restrict the
    // preview to typeof + length + the first 8 chars.
    const summary = typeof value === 'string'
        ? `string(len=${value.length}, head="${value.slice(0, 8)}")`
        : `${typeof value}`;
    console.warn(`[blur-data-url] Rejecting non-conforming value: ${summary}`);
    return null;
}
