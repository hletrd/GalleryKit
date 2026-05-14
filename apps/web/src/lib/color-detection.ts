/**
 * Color signal detection for uploaded images.
 *
 * Derives CICP-equivalent values from ICC profile metadata and Sharp-reported
 * bit depth. The output is consumed at upload time and stored in the images
 * table so future HDR delivery can query without re-parsing originals.
 *
 * HDR detection is heuristic: PQ (SMPTE ST 2084) and HLG (ARIB STD-B67 /
 * ITU-R BT.2100) transfer functions in the ICC description are treated as HDR.
 * True HDR AVIF delivery requires CICP signaling (deferred to US-CM12).
 */

import type { Metadata } from 'sharp';
import { open } from 'fs/promises';
import { extractIccProfileName } from '@/lib/icc-extractor';
import { hasGainMap as parseGainMapFromHeif } from '@/lib/gain-map-detection';
import { detectGamutFromIccChromaticity } from '@/lib/icc-chromaticity';

export interface ColorSignals {
    /** Canonical ICC profile name parsed from the file. */
    iccProfileName: string | null;
    /** Color primaries inferred from ICC name or nclx box. */
    colorPrimaries: 'bt709' | 'p3-d65' | 'dci-p3' | 'adobergb' | 'prophoto' | 'bt2020' | 'unknown';
    /** Transfer function inferred from ICC description + bit depth. */
    transferFunction: 'srgb' | 'gamma22' | 'gamma18' | 'gamma26' | 'pq' | 'hlg' | 'linear' | 'unknown';
    /** Matrix coefficients inferred from ICC / container metadata. */
    matrixCoefficients: 'bt709' | 'bt2020-ncl' | 'identity' | 'unknown';
    /** Whether the image is HDR (PQ or HLG transfer). */
    isHdr: boolean;
    /**
     * P4-A1 / R4-H1: whether the source carries an Apple-style HDR gain map
     * auxiliary item. Set when an HEIF / AVIF container declares either a
     * 'urim' infe with the Apple gain map URI or a 'tmap' infe (ISO 21496-1),
     * including the auxl-iref-only shape. Independent of `isHdr`: many
     * Apple HDR HEICs carry an SDR base + gain map without flipping the
     * transfer function on the primary item, so detection here is the only
     * honest way to surface "this source was authored as HDR" in the audit
     * panel until WI-09 wires the gain map through to delivery.
     */
    hasGainMap: boolean;
}

// C3-A1 / C3-COL-LOW-1 / C3-ARCH-MED-2: canonical wide-gamut primaries set
// is defined in lib/color-primaries.ts (client-safe — no fs/sharp imports)
// and re-exported here for callers that already import this module's heavier
// detection helpers. Client components must import from lib/color-primaries
// directly to avoid pulling fs/promises into the client bundle.
export { WIDE_GAMUT_PRIMARIES, isWideGamutPrimary } from '@/lib/color-primaries';

export function normalizeName(name: string | null | undefined): string {
    return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Derive color primaries from the ICC profile name using the same canonical
 * mapping as resolveColorPipelineDecision in process-image.ts.
 */
function inferColorPrimaries(iccProfileName: string | null): ColorSignals['colorPrimaries'] {
    const name = normalizeName(iccProfileName);
    if (!name) return 'unknown';

    if (name.includes('displayp3') || name.includes('displayp3aces')) return 'p3-d65';
    if (name.includes('dcip3')) return 'dci-p3';
    if (name.includes('adobe') || name.includes('adobergb')) return 'adobergb';
    if (name.includes('prophoto')) return 'prophoto';
    if (name.includes('bt2020') || name.includes('rec2020') || name.includes('iturbt2020')) return 'bt2020';
    if (name.includes('srgb') || name.includes('iec61966')) return 'bt709';

    return 'unknown';
}

/**
 * Guess transfer function from ICC description and bit depth.
 * This is heuristic — true CICP transfer signaling will be added via nclx
 * parsing (US-CM05) when available.
 */
function inferTransferFunction(
    iccProfileName: string | null,
    iccDescription: string | null | undefined,
    bitDepth: number | null,
): ColorSignals['transferFunction'] {
    const desc = (iccDescription ?? '').toLowerCase();
    const name = normalizeName(iccProfileName);

    // Explicit HDR transfer hints in ICC description or name
    if (desc.includes('pq') || desc.includes('st 2084') || desc.includes('smpte 2084') ||
        name.includes('pq') || name.includes('st2084')) {
        return 'pq';
    }
    if (desc.includes('hlg') || desc.includes('hybrid log') || desc.includes('arib') ||
        name.includes('hlg')) {
        return 'hlg';
    }

    // Gamma hints
    if (desc.includes('gamma 2.2') || desc.includes('g22') || name.includes('gamma22')) return 'gamma22';
    if (desc.includes('gamma 1.8') || desc.includes('g18') || name.includes('gamma18')) return 'gamma18';
    if (desc.includes('linear') || name.includes('linear')) return 'linear';

    // sRGB IEC61966-2.1 is the most common SDR case
    if (name.includes('srgb') || name.includes('iec61966')) return 'srgb';

    // Default heuristics by primaries
    if (name.includes('adobe') || name.includes('adobergb')) return 'gamma22';
    if (name.includes('prophoto')) return 'gamma18';

    // Display P3 ICC profiles use sRGB transfer per IEC 61966-2-1; this is
    // the documented Apple Display-P3 contract, not a guess.
    if (name.includes('displayp3') || name.includes('p3d65')) return 'srgb';

    // DCI-P3 (cinema) is gamma-2.6 by SMPTE EG 432-2; treat as gamma22 as
    // the closest available enum until a dedicated 'gamma26' value lands.
    if (name.includes('dcip3')) return 'gamma22';

    // BT.2020 / Rec.2020 SDR uses BT.1886-style transfer (gamma-2.4-ish);
    // we report 'srgb' for the SDR companion case where the ICC name says
    // Rec.2020 but no PQ/HLG hint is present. HDR Rec.2020 sources flow
    // through the explicit PQ/HLG branches above.
    if (name.includes('bt2020') || name.includes('rec2020') || name.includes('iturbt2020')) return 'srgb';

    // 16-bit+ with no other clues → could be HDR; mark unknown rather than guess
    if (bitDepth && bitDepth >= 10) return 'unknown';

    // C3-A7 / C3-HDR-MED-3: previously returned 'srgb' as a fallback for
    // unknown 8-bit profiles. That was a guess — for unrecognized ICC
    // profiles (custom calibration, off-brand RGB working spaces) we cannot
    // know the transfer characteristic. Return 'unknown' so the audit panel
    // shows nothing rather than lying about the transfer.
    //
    // isHdr stays false for 'unknown' (only PQ / HLG flip the flag), so this
    // does not change HDR detection. It only changes the audit label for
    // unrecognized profiles from a misleading 'sRGB' to an honest 'unknown'.
    return 'unknown';
}

/**
 * Guess matrix coefficients from ICC profile name.
 * For RGB images matrix is usually identity (R,G,B directly encode
 * primaries), but BT.2020 and BT.709 have defined matrices for YCbCr.
 * We report 'identity' for known RGB spaces and 'bt709'/'bt2020-ncl'
 * when the container suggests YCbCr encoding.
 */
function inferMatrixCoefficients(iccProfileName: string | null): ColorSignals['matrixCoefficients'] {
    const name = normalizeName(iccProfileName);
    if (!name) return 'unknown';

    if (name.includes('bt2020') || name.includes('rec2020') || name.includes('iturbt2020')) return 'bt2020-ncl';
    if (name.includes('srgb') || name.includes('iec61966') || name.includes('adobe') ||
        name.includes('prophoto') || name.includes('p3') || name.includes('displayp3') ||
        name.includes('dcip3')) {
        // RGB spaces encode primaries directly (identity-like for our purposes)
        return 'identity';
    }

    return 'unknown';
}

// ---------------------------------------------------------------------------
// US-CM05: CICP nclx box parsing for HEIF/AVIF containers (ISOBMFF walker)
// ---------------------------------------------------------------------------

interface CicpTriplet {
    colourPrimaries: number;
    transferCharacteristics: number;
    matrixCoefficients: number;
}

const NCLX_PRIMARIES_MAP: Record<number, ColorSignals['colorPrimaries']> = {
    1: 'bt709',
    9: 'bt2020',
    11: 'dci-p3',
    12: 'p3-d65',
};

const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    1: 'srgb',
    2: 'gamma22',
    // R8-M1: ITU-T H.273 gamma-2.2 family values 4, 5, 7
    4: 'gamma22', // ITU-T H.273 Gamma 2.2 curve
    5: 'gamma22', // BT.470 System M
    6: 'gamma22',
    7: 'gamma22', // SMPTE 240M
    8: 'linear',   // ITU-T H.273 linear transfer characteristic
    13: 'srgb',    // sRGB IEC 61966-2-1 (was wrongly mapped to 'pq')
    14: 'gamma22', // BT.2020 10-bit (was wrongly mapped to 'hlg')
    15: 'gamma22', // BT.2020 12-bit
    16: 'pq',      // PQ / SMPTE ST 2084 (was missing)
    17: 'gamma26', // SMPTE ST 428-1 (DCI-P3 gamma 2.6)
    18: 'hlg',     // ARIB STD-B67 (was wrongly mapped to 'gamma18')
};

const NCLX_MATRIX_MAP: Record<number, ColorSignals['matrixCoefficients']> = {
    0: 'identity',
    1: 'bt709',
    9: 'bt2020-ncl',
};

/**
 * Walk an ISOBMFF buffer to find a 'colr' box with colour_type 'nclx' and
 * extract the CICP triplet (primaries, transfer, matrix).
 *
 * Bounded: max depth 5 levels, max scan 1 MB, rejects malformed boxes.
 * Returns null when no nclx colr is found.
 */
export function parseCicpFromHeif(buffer: Buffer): CicpTriplet | null {
    const MAX_SCAN_BYTES = 1024 * 1024;
    const MAX_DEPTH = 5;

    function walk(offset: number, end: number, depth: number): CicpTriplet | null {
        if (depth > MAX_DEPTH) return null;

        let pos = offset;
        const limit = Math.min(end, offset + MAX_SCAN_BYTES, buffer.length);

        while (pos + 8 <= limit) {
            let size = buffer.readUInt32BE(pos);
            const type = buffer.toString('ascii', pos + 4, pos + 8);

            let headerSize = 8;
            let dataStart = pos + 8;

            if (size === 1) {
                if (pos + 16 > buffer.length) break;
                size = Number(buffer.readBigUInt64BE(pos + 8));
                headerSize = 16;
                dataStart = pos + 16;
            } else if (size === 0) {
                size = buffer.length - pos;
            }

            if (size < headerSize || pos + size > buffer.length) break;

            const boxEnd = pos + size;
            const dataSize = size - headerSize;

            if (type === 'colr') {
                // colr is a regular Box per ISOBMFF (not a FullBox).
                // colour_type FOURCC starts immediately after the box header.
                if (dataSize >= 11) {
                    const colourType = buffer.toString('ascii', dataStart, dataStart + 4);
                    if (colourType === 'nclx' && dataSize >= 11) {
                        // colour_type(4) + primaries(2) + transfer(2) + matrix(2) + full_range(1) = 11
                        return {
                            colourPrimaries: buffer.readUInt16BE(dataStart + 4),
                            transferCharacteristics: buffer.readUInt16BE(dataStart + 6),
                            matrixCoefficients: buffer.readUInt16BE(dataStart + 8),
                        };
                    }
                }
            }

            // Recurse into container boxes.
            // meta is a FullBox → skip version+flags. iprp / ipco are regular boxes.
            if (type === 'meta' || type === 'iprp' || type === 'ipco') {
                const contentOffset = type === 'meta' && dataSize >= 4
                    ? dataStart + 4
                    : dataStart;
                const result = walk(contentOffset, boxEnd, depth + 1);
                if (result) return result;
            }

            pos = boxEnd;
        }

        return null;
    }

    return walk(0, buffer.length, 0);
}

/**
 * Detect color signals from a Sharp-loaded image.
 *
 * @param filepath  — path to the saved original (used for nclx parsing on HEIF/AVIF)
 * @param metadata  — Sharp metadata() result (icc, depth, etc.)
 */
export async function detectColorSignals(
    filepath: string,
    _image: unknown,
    metadata: Metadata,
): Promise<ColorSignals> {
    // Sharp's metadata().icc is a Buffer when present; try to extract a name
    // by reusing the same bounds-checked parser from icc-extractor.ts.
    // For detectColorSignals we only need the name string, not the full ICC.
    let iccName: string | null = null;
    if (metadata.icc && Buffer.isBuffer(metadata.icc)) {
        // R5-M2: upload-time detection runs server-side with no request locale,
        // so `extractIccProfileName` is called without a locale argument and
        // always returns the first matching description (typically English).
        // Locale-matched `mluc` selection is available at render time in the
        // UI, but the stored ICC name is fixed at upload. This is acceptable
        // because Latinate technical names are universal among photographers.
        iccName = extractIccProfileName(metadata.icc);
    } else if (typeof metadata.icc === 'string') {
        iccName = metadata.icc;
    }
    void _image;

    const bitDepth = typeof metadata.depth === 'string'
        ? ({ uchar: 8, char: 8, ushort: 16, short: 16, uint: 32, int: 32, float: 32, complex: 64, double: 64, dpcomplex: 128 } as Record<string, number>)[metadata.depth] ?? null
        : (typeof metadata.depth === 'number' && Number.isFinite(metadata.depth) ? metadata.depth : null);

    // US-CM05: CICP nclx box parsing for HEIF/AVIF containers.
    // When nclx is present it takes precedence over ICC-derived values.
    // P4-A1 / R4-H1: gain map detection shares the 1 MB header read so
    // the upload pipeline only opens the file once for color-signal probes.
    let nclxCicp: CicpTriplet | null = null;
    let hasGainMap = false;
    const format = metadata.format?.toLowerCase();
    if (format === 'heif' || format === 'avif') {
        try {
            const fileHandle = await open(filepath, 'r');
            try {
                const header = Buffer.alloc(1024 * 1024); // 1 MB cap
                const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
                if (bytesRead > 0) {
                    const headerSlice = header.subarray(0, bytesRead);
                    nclxCicp = parseCicpFromHeif(headerSlice);
                    hasGainMap = parseGainMapFromHeif(headerSlice);
                }
            } finally {
                await fileHandle.close();
            }
        } catch {
            // Non-critical: fall back to ICC-based detection
        }
    }

    let colorPrimaries = inferColorPrimaries(iccName);
    let transferFunction = inferTransferFunction(iccName, null, bitDepth);
    let matrixCoefficients = inferMatrixCoefficients(iccName);

    // P4-A2 / R4-H2: ICC chromaticity-based detection upgrades primaries when
    // the ICC name is opaque. Custom monitor profiles (Eizo, BenQ, calibrated
    // workflow) often carry arbitrary description strings, but the embedded
    // wtpt / rXYZ / gXYZ / bXYZ tags identify the actual gamut geometry.
    // Precedence: NCLX > ICC chromaticity > ICC name (heuristic).
    //
    // The chromaticity module reports 'srgb' for sRGB-equivalent primaries;
    // map that to the ColorSignals 'bt709' enum at the boundary so the
    // schema (`color_primaries varchar`) keeps the canonical CIE / ITU-T
    // value. Other gamut names align between the two modules.
    if (colorPrimaries === 'unknown' && metadata.icc && Buffer.isBuffer(metadata.icc)) {
        const chromaticity = detectGamutFromIccChromaticity(metadata.icc);
        if (chromaticity && chromaticity.primary !== 'unknown' && chromaticity.confidence !== 'low') {
            colorPrimaries = chromaticity.primary === 'srgb' ? 'bt709' : chromaticity.primary;
            // Backfill matrix coefficients when chromaticity identifies an RGB
            // working space — the inferMatrixCoefficients pass already returned
            // 'unknown' because the name was opaque.
            if (matrixCoefficients === 'unknown') {
                matrixCoefficients = chromaticity.primary === 'bt2020' ? 'bt2020-ncl' : 'identity';
            }
        }
    }

    if (nclxCicp) {
        colorPrimaries = NCLX_PRIMARIES_MAP[nclxCicp.colourPrimaries] ?? 'unknown';
        transferFunction = NCLX_TRANSFER_MAP[nclxCicp.transferCharacteristics] ?? 'unknown';
        matrixCoefficients = NCLX_MATRIX_MAP[nclxCicp.matrixCoefficients] ?? 'unknown';
    }

    const isHdr = transferFunction === 'pq' || transferFunction === 'hlg';

    return {
        iccProfileName: iccName,
        colorPrimaries,
        transferFunction,
        matrixCoefficients,
        isHdr,
        hasGainMap,
    };
}

