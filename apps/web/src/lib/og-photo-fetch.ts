/**
 * R24-M1: ascending sized-derivative fetch chain for the per-photo OG route.
 *
 * Used by `apps/web/src/app/api/og/photo/[id]/route.tsx`. Extracted to a
 * sibling lib module because Next.js App Router route files only permit
 * conventional exports (`runtime`, HTTP method handlers, etc.); auxiliary
 * helpers must live outside the route.
 *
 * Design intent (full context in the R24-M1 plan):
 *
 *  - The OG canvas is 1200x630. Any derivative >= 1024 px is sufficient.
 *    Iterating sizes ASCENDING biases toward smaller files that comfortably
 *    fit under the 1 MB byte cap and minimises base64 bloat into the
 *    Satori embed.
 *  - When `image_sizes` admin config changes and backfill has not yet
 *    caught up to every photo, the originally-targeted size may not exist
 *    on disk for legacy photos. Falling back through the configured size
 *    list keeps the photo-specific OG card alive across the backfill
 *    window, instead of degrading all the way to the site-default OG.
 *  - The encoder atomic-rename contract guarantees every configured size
 *    for `processed = true` photos eventually exists; the iteration only
 *    bridges the transient backfill window.
 *
 * Lineage: R21-M1 / R22-M1 / R23-M1 closed the browser-side onError
 * fallback contract on every public `<img>`. R24-M1 closes the equivalent
 * server-side fallback contract on the only remaining sized-derivative-
 * only consumer (per-photo OG generator).
 */

/** Byte cap for a single OG-embedded photo (post-base64 stays under 2 MB). */
export const OG_PHOTO_MAX_BYTES = 1024 * 1024;

/** Per-attempt timeout for the internal photo fetch. */
const OG_PHOTO_FETCH_TIMEOUT_MS = 10000;

/**
 * Try fetching one sized JPEG derivative for the OG image. Returns the
 * buffered photo on success, or null on any of:
 *   - HTTP non-2xx (e.g. 404 because the derivative is not yet on disk),
 *   - Content-Length > OG_PHOTO_MAX_BYTES (pre-buffer reject),
 *   - buffered body > OG_PHOTO_MAX_BYTES (post-buffer reject),
 *   - AbortSignal timeout or network throw.
 */
export async function tryFetchPhotoBuffer(
    origin: string,
    baseFilename: string,
    size: number,
): Promise<Buffer | null> {
    const sizedFilename = baseFilename.replace(/\.jpg$/i, `_${size}.jpg`);
    const photoUrl = `${origin}/uploads/jpeg/${sizedFilename}`;
    try {
        const photoRes = await fetch(photoUrl, {
            signal: AbortSignal.timeout(OG_PHOTO_FETCH_TIMEOUT_MS),
        });
        if (!photoRes.ok) return null;
        const contentLength = photoRes.headers.get('Content-Length');
        // R16C16 DBG-16-02: guard the finite-ness before comparing. A non-numeric
        // header → NaN, and `NaN > MAX` is false, slipping the pre-check (the
        // post-buffer cap below still catches it, but mirror the correct
        // Number.isFinite guard used at search/semantic/route.ts).
        if (contentLength) {
            const len = Number(contentLength);
            if (Number.isFinite(len) && len > OG_PHOTO_MAX_BYTES) return null;
        }
        const photoBuffer = Buffer.from(await photoRes.arrayBuffer());
        if (photoBuffer.length > OG_PHOTO_MAX_BYTES) return null;
        return photoBuffer;
    } catch {
        // Timeout / network error: treat as a miss so the caller tries
        // the next configured size. Unexpected throws are caught by the
        // outer route's try/catch.
        return null;
    }
}

/**
 * Iterate configured `imageSizes` ascending and return the first
 * derivative that fetches successfully under the byte cap. Returns null
 * only after EVERY configured size fails, at which point the caller
 * falls back to the site-default OG image.
 */
export async function pickFirstAvailablePhotoBuffer(
    origin: string,
    baseFilename: string,
    imageSizes: number[],
): Promise<{ buffer: Buffer; size: number } | null> {
    const sortedSizes = [...imageSizes].sort((a, b) => a - b);
    for (const size of sortedSizes) {
        const buffer = await tryFetchPhotoBuffer(origin, baseFilename, size);
        if (buffer) return { buffer, size };
    }
    return null;
}
