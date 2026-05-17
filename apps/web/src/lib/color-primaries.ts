/**
 * Client-safe color primaries helpers.
 *
 * C3-A1 / C3-COL-LOW-1 / C3-ARCH-MED-2: this module exposes the canonical
 * WIDE_GAMUT_PRIMARIES set + isWideGamutPrimary helper to BOTH the upload
 * pipeline (process-image.ts, actions/images.ts — server) AND the viewer
 * surface (photo-viewer.tsx, histogram.tsx, info-bottom-sheet.tsx,
 * wide-gamut-hint.tsx — client). It is intentionally kept free of
 * server-only imports (fs/promises, Sharp metadata, etc.) so client
 * components can import it without dragging the upload pipeline into the
 * client bundle.
 *
 * lib/color-detection.ts retains the heavier server-side detection logic
 * (HEIF colr walker, ICC parser, Sharp metadata bridge) and re-exports
 * these client-safe symbols for backwards compatibility.
 */

/**
 * Canonical color-primaries enum used across the upload pipeline and
 * viewer surface. Matches lib/color-detection.ts ColorSignals.colorPrimaries.
 */
export type ColorPrimariesValue =
    | 'bt709'
    | 'p3-d65'
    | 'dci-p3'
    | 'adobergb'
    | 'prophoto'
    | 'bt2020'
    | 'unknown';

/**
 * Wide-gamut primaries set. Adding a new wide-gamut primary in only ONE
 * call site (e.g. when WI-09 lands rec2100) silently breaks histogram /
 * preview / chroma decisions on the others — the source of truth lives
 * here.
 */
export const WIDE_GAMUT_PRIMARIES: ReadonlySet<ColorPrimariesValue> = new Set([
    'p3-d65',
    'dci-p3',
    'adobergb',
    'prophoto',
    'bt2020',
]);

/** Convenience helper. Returns false on null / undefined / unknown / sRGB. */
export function isWideGamutPrimary(p: string | null | undefined): boolean {
    if (!p) return false;
    return (WIDE_GAMUT_PRIMARIES as ReadonlySet<string>).has(p);
}

/**
 * Gamut "family" classification: collapse functionally-equivalent
 * primaries strings (e.g. `p3-d65` vs `dci-p3` both deliver as Display
 * P3) into a single bucket. Used for UX decisions that key on the
 * delivered gamut (e.g. R13-M2 WideGamutHint dismiss key) rather than
 * the literal source-primaries string.
 *
 * Returns one of:
 *   - 'srgb'     — bt709 (and the implicit default)
 *   - 'p3'       — p3-d65, dci-p3 (both deliver as Display P3)
 *   - 'rec2020'  — bt2020
 *   - 'adobergb' — adobergb
 *   - 'prophoto' — prophoto
 *   - 'unknown'  — null / undefined / unrecognised
 */
export type GamutFamily =
    | 'srgb'
    | 'p3'
    | 'rec2020'
    | 'adobergb'
    | 'prophoto'
    | 'unknown';

export function getGamutFamily(p: string | null | undefined): GamutFamily {
    if (!p) return 'unknown';
    if (p === 'bt709') return 'srgb';
    if (p === 'p3-d65' || p === 'dci-p3') return 'p3';
    if (p === 'bt2020') return 'rec2020';
    if (p === 'adobergb') return 'adobergb';
    if (p === 'prophoto') return 'prophoto';
    return 'unknown';
}
