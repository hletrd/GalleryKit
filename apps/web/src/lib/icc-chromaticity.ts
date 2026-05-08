/**
 * ICC chromaticity-based gamut detection (P4-A2 / R4-H2).
 *
 * Walks the ICC profile tag table for `wtpt` (white point) and `rXYZ` /
 * `gXYZ` / `bXYZ` (red / green / blue primaries) entries, decodes the
 * XYZType payloads as s15Fixed16 fixed-point, converts XYZ → xy
 * chromaticity, and compares against canonical gamut presets.
 *
 * This is the third resolver in the precedence chain inside
 * `detectColorSignals`:
 *
 *   NCLX (container CICP) > ICC chromaticity > ICC name (heuristic)
 *
 * The ICC-name heuristic in `color-detection.ts` only works for profiles
 * with a recognizable description string. Custom monitor profiles
 * (Eizo CG2700X, BenQ SW272U, calibrated workflow profiles) often carry
 * arbitrary descriptions like "Eizo CG2700X 2026-05-01" — chromaticity-
 * based detection lets us identify the actual gamut from the geometry
 * even when the name is opaque.
 *
 * Bounded: max 100 tags scanned, max 4 KB tag table read.
 */

const MAX_TAG_COUNT = 100;
const MAX_TAG_TABLE_BYTES = 4 * 1024;
// White-point / primary chromaticity tolerance for high-confidence match.
const HIGH_CONFIDENCE_TOLERANCE = 0.005;
// Looser tolerance — accept as a medium-confidence match (calibration
// drift, slight rounding).
const MEDIUM_CONFIDENCE_TOLERANCE = 0.015;

export type GamutPrimary = 'srgb' | 'p3-d65' | 'adobergb' | 'prophoto' | 'bt2020' | 'unknown';

export interface ChromaticityResult {
    primary: GamutPrimary;
    whitePoint: { x: number; y: number };
    primaries: {
        r: { x: number; y: number };
        g: { x: number; y: number };
        b: { x: number; y: number };
    };
    confidence: 'high' | 'medium' | 'low';
}

interface PresetGamut {
    r: { x: number; y: number };
    g: { x: number; y: number };
    b: { x: number; y: number };
    wp: { x: number; y: number };
}

/**
 * Reference primaries / white points for canonical gamuts. Values are the
 * SMPTE / IEC / ITU spec values; ICC profiles may carry slightly drifted
 * numbers because of D50 PCS adaptation or vendor rounding, which is why
 * we use a tolerance window rather than an exact match.
 *
 * ProPhoto's white point is D50 (0.3457, 0.3585). Every other gamut here
 * uses D65 (0.3127, 0.3290).
 */
const PRESETS: Record<Exclude<GamutPrimary, 'unknown'>, PresetGamut> = {
    'srgb': {
        r: { x: 0.640, y: 0.330 },
        g: { x: 0.300, y: 0.600 },
        b: { x: 0.150, y: 0.060 },
        wp: { x: 0.3127, y: 0.3290 },
    },
    'p3-d65': {
        r: { x: 0.680, y: 0.320 },
        g: { x: 0.265, y: 0.690 },
        b: { x: 0.150, y: 0.060 },
        wp: { x: 0.3127, y: 0.3290 },
    },
    'adobergb': {
        r: { x: 0.640, y: 0.330 },
        g: { x: 0.210, y: 0.710 },
        b: { x: 0.150, y: 0.060 },
        wp: { x: 0.3127, y: 0.3290 },
    },
    'prophoto': {
        r: { x: 0.7347, y: 0.2653 },
        g: { x: 0.1596, y: 0.8404 },
        b: { x: 0.0366, y: 0.0001 },
        wp: { x: 0.3457, y: 0.3585 },
    },
    'bt2020': {
        r: { x: 0.708, y: 0.292 },
        g: { x: 0.170, y: 0.797 },
        b: { x: 0.131, y: 0.046 },
        wp: { x: 0.3127, y: 0.3290 },
    },
};

/** Read a 4-byte big-endian s15Fixed16 fixed-point at offset and return as a JS Number. */
function readS15Fixed16(buf: Buffer, offset: number): number {
    if (offset + 4 > buf.length) return NaN;
    const raw = buf.readInt32BE(offset);
    return raw / 65536;
}

/** Convert tristimulus XYZ to xy chromaticity. Returns null when X+Y+Z is zero. */
function xyzToXy(x: number, y: number, z: number): { x: number; y: number } | null {
    const sum = x + y + z;
    if (!Number.isFinite(sum) || Math.abs(sum) < 1e-9) return null;
    return { x: x / sum, y: y / sum };
}

interface XyzTriple { x: number; y: number; z: number }

/**
 * Read a single XYZType tag payload at the given offset. The XYZType
 * structure is:
 *
 *   - 4-byte type signature ('XYZ ' = 0x58595A20)
 *   - 4-byte reserved (zero)
 *   - 12-byte XYZ triple, each component s15Fixed16
 *
 * For multi-XYZ payloads (rare in calibration profiles), only the first
 * triple is consumed — that matches every preset gamut here.
 */
function readXyzTag(buf: Buffer, offset: number, size: number): XyzTriple | null {
    if (offset < 0 || size < 20 || offset + 20 > buf.length) return null;
    const sig = buf.toString('ascii', offset, offset + 4);
    if (sig !== 'XYZ ' && sig !== 'XYZT') return null;
    const x = readS15Fixed16(buf, offset + 8);
    const y = readS15Fixed16(buf, offset + 12);
    const z = readS15Fixed16(buf, offset + 16);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return { x, y, z };
}

/** 2D Euclidean chromaticity distance. */
function chromaDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Walk the ICC tag table for `wtpt` / `rXYZ` / `gXYZ` / `bXYZ`, decode the
 * XYZType payloads, convert to xy chromaticity, and compare against the
 * preset gamuts. Returns null when any required tag is missing (CMYK
 * profiles, monochrome profiles, malformed buffers).
 *
 * The match metric is the maximum of per-primary 2D Euclidean Δxy across
 * R / G / B and the white point. A custom Eizo profile calibrated to
 * AdobeRGB primaries will land well within HIGH_CONFIDENCE_TOLERANCE
 * regardless of the description string.
 */
export function detectGamutFromIccChromaticity(icc: Buffer | null | undefined): ChromaticityResult | null {
    if (!icc || icc.length < 132 + 12) return null;

    let tagCount: number;
    try {
        tagCount = icc.readUInt32BE(128);
    } catch {
        return null;
    }
    if (!Number.isFinite(tagCount) || tagCount <= 0) return null;
    if (tagCount > MAX_TAG_COUNT) tagCount = MAX_TAG_COUNT;

    // Defense-in-depth: cap how far we walk into the tag table even when
    // tagCount is plausible, in case the file is truncated.
    const tagTableEnd = Math.min(132 + tagCount * 12, 132 + MAX_TAG_TABLE_BYTES, icc.length);

    let wtptOffset = -1, wtptSize = 0;
    let rXyzOffset = -1, rXyzSize = 0;
    let gXyzOffset = -1, gXyzSize = 0;
    let bXyzOffset = -1, bXyzSize = 0;

    for (let i = 132; i + 12 <= tagTableEnd; i += 12) {
        const sig = icc.toString('ascii', i, i + 4);
        const offset = icc.readUInt32BE(i + 4);
        const size = icc.readUInt32BE(i + 8);
        if (offset + size > icc.length || size < 20 || size > MAX_TAG_TABLE_BYTES) continue;
        switch (sig) {
            case 'wtpt': wtptOffset = offset; wtptSize = size; break;
            case 'rXYZ': rXyzOffset = offset; rXyzSize = size; break;
            case 'gXYZ': gXyzOffset = offset; gXyzSize = size; break;
            case 'bXYZ': bXyzOffset = offset; bXyzSize = size; break;
        }
    }

    if (wtptOffset < 0 || rXyzOffset < 0 || gXyzOffset < 0 || bXyzOffset < 0) {
        // Missing one of the required tags — typical for CMYK / monochrome /
        // perceptual-LUT profiles. Caller falls through to ICC-name detection.
        return null;
    }

    const wtpt = readXyzTag(icc, wtptOffset, wtptSize);
    const rXyz = readXyzTag(icc, rXyzOffset, rXyzSize);
    const gXyz = readXyzTag(icc, gXyzOffset, gXyzSize);
    const bXyz = readXyzTag(icc, bXyzOffset, bXyzSize);
    if (!wtpt || !rXyz || !gXyz || !bXyz) return null;

    const wpXy = xyzToXy(wtpt.x, wtpt.y, wtpt.z);
    const rXy = xyzToXy(rXyz.x, rXyz.y, rXyz.z);
    const gXy = xyzToXy(gXyz.x, gXyz.y, gXyz.z);
    const bXy = xyzToXy(bXyz.x, bXyz.y, bXyz.z);
    if (!wpXy || !rXy || !gXy || !bXy) return null;

    let bestMatch: GamutPrimary = 'unknown';
    let bestDistance = Infinity;
    for (const [primaryName, preset] of Object.entries(PRESETS) as [Exclude<GamutPrimary, 'unknown'>, PresetGamut][]) {
        const dR = chromaDistance(rXy, preset.r);
        const dG = chromaDistance(gXy, preset.g);
        const dB = chromaDistance(bXy, preset.b);
        const dW = chromaDistance(wpXy, preset.wp);
        const worst = Math.max(dR, dG, dB, dW);
        if (worst < bestDistance) {
            bestDistance = worst;
            bestMatch = primaryName;
        }
    }

    let confidence: ChromaticityResult['confidence'] = 'low';
    if (bestDistance <= HIGH_CONFIDENCE_TOLERANCE) confidence = 'high';
    else if (bestDistance <= MEDIUM_CONFIDENCE_TOLERANCE) confidence = 'medium';
    else bestMatch = 'unknown';

    return {
        primary: bestMatch,
        whitePoint: wpXy,
        primaries: { r: rXy, g: gXy, b: bXy },
        confidence,
    };
}
