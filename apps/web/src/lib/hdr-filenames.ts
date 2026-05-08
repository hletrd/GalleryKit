/**
 * HDR filename helpers.
 *
 * Extracted for reuse when WI-09 (HDR AVIF encoder) ships.
 * Currently unused in UI after P3-1 removed the HDR download menu item.
 */

export function deriveHdrAvifFilename(avifFilename: string): string {
    return avifFilename.replace(/\.avif$/i, (match) => '_hdr' + match);
}
