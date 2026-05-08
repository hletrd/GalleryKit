/**
 * ICC chromaticity-based gamut detection tests (P4-A2 / R4-H2).
 *
 * Pure-function tests for `detectGamutFromIccChromaticity`. The fixtures
 * are synthesized byte-for-byte: a minimal ICC profile header, a tag
 * table with `wtpt` / `rXYZ` / `gXYZ` / `bXYZ` entries, and XYZType
 * payloads encoded as s15Fixed16 fixed-point. The synthesizer mirrors
 * the structure that real ICC profiles use, which is the same shape
 * the parser walks at runtime.
 */

import { describe, it, expect } from 'vitest';
import { detectGamutFromIccChromaticity } from '@/lib/icc-chromaticity';

// ---------------------------------------------------------------------------
// ICC fixture helpers
// ---------------------------------------------------------------------------

interface PresetXyz {
    wp: { x: number; y: number };
    r: { x: number; y: number };
    g: { x: number; y: number };
    b: { x: number; y: number };
}

/**
 * Convert xy chromaticity to XYZ tristimulus, normalizing Y = 1.
 *   X = x / y, Y = 1, Z = (1 - x - y) / y
 */
function xyToXyz(p: { x: number; y: number }): { x: number; y: number; z: number } {
    return { x: p.x / p.y, y: 1, z: (1 - p.x - p.y) / p.y };
}

function writeS15Fixed16(buf: Buffer, offset: number, value: number): void {
    const raw = Math.round(value * 65536);
    buf.writeInt32BE(raw, offset);
}

/** Build a 20-byte XYZType payload: 'XYZ ' (4) + reserved (4) + XYZ (12). */
function makeXyzPayload(xyz: { x: number; y: number; z: number }): Buffer {
    const buf = Buffer.alloc(20);
    buf.write('XYZ ', 0, 4, 'ascii');
    buf.writeUInt32BE(0, 4);
    writeS15Fixed16(buf, 8, xyz.x);
    writeS15Fixed16(buf, 12, xyz.y);
    writeS15Fixed16(buf, 16, xyz.z);
    return buf;
}

/**
 * Build a minimal ICC profile with wtpt / rXYZ / gXYZ / bXYZ tags.
 * Layout:
 *   [0]   128-byte header (only 'acsp' magic at 36 written)
 *   [128] tag count (4 bytes) = 4
 *   [132] tag table: 4 × 12-byte entries (sig, offset, size)
 *   [180] wtpt payload (20 bytes)
 *   [200] rXYZ payload (20 bytes)
 *   [220] gXYZ payload (20 bytes)
 *   [240] bXYZ payload (20 bytes)
 *   [260] end
 */
function makeIccProfile(preset: PresetXyz): Buffer {
    const buf = Buffer.alloc(260);
    buf.write('acsp', 36, 4, 'ascii');
    buf.writeUInt32BE(4, 128); // tag count

    const tags: { sig: string; offset: number; payload: Buffer }[] = [
        { sig: 'wtpt', offset: 180, payload: makeXyzPayload(xyToXyz(preset.wp)) },
        { sig: 'rXYZ', offset: 200, payload: makeXyzPayload(xyToXyz(preset.r)) },
        { sig: 'gXYZ', offset: 220, payload: makeXyzPayload(xyToXyz(preset.g)) },
        { sig: 'bXYZ', offset: 240, payload: makeXyzPayload(xyToXyz(preset.b)) },
    ];

    for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        const tagOffset = 132 + i * 12;
        buf.write(t.sig, tagOffset, 4, 'ascii');
        buf.writeUInt32BE(t.offset, tagOffset + 4);
        buf.writeUInt32BE(t.payload.length, tagOffset + 8);
        t.payload.copy(buf, t.offset);
    }
    return buf;
}

const SRGB_PRESET: PresetXyz = {
    wp: { x: 0.3127, y: 0.3290 },
    r: { x: 0.640, y: 0.330 },
    g: { x: 0.300, y: 0.600 },
    b: { x: 0.150, y: 0.060 },
};

const P3_D65_PRESET: PresetXyz = {
    wp: { x: 0.3127, y: 0.3290 },
    r: { x: 0.680, y: 0.320 },
    g: { x: 0.265, y: 0.690 },
    b: { x: 0.150, y: 0.060 },
};

const ADOBERGB_PRESET: PresetXyz = {
    wp: { x: 0.3127, y: 0.3290 },
    r: { x: 0.640, y: 0.330 },
    g: { x: 0.210, y: 0.710 },
    b: { x: 0.150, y: 0.060 },
};

const PROPHOTO_PRESET: PresetXyz = {
    wp: { x: 0.3457, y: 0.3585 },
    r: { x: 0.7347, y: 0.2653 },
    g: { x: 0.1596, y: 0.8404 },
    b: { x: 0.0366, y: 0.0001 },
};

const BT2020_PRESET: PresetXyz = {
    wp: { x: 0.3127, y: 0.3290 },
    r: { x: 0.708, y: 0.292 },
    g: { x: 0.170, y: 0.797 },
    b: { x: 0.131, y: 0.046 },
};

// Eizo CG2700X ships AdobeRGB-equivalent primaries with very small drift.
// The matcher should pick adobergb at high confidence regardless of the
// (synthetic, profile-name-less) buffer.
const EIZO_CG2700X_FLAVORED: PresetXyz = {
    wp: { x: 0.3128, y: 0.3291 },
    r: { x: 0.6395, y: 0.3303 },
    g: { x: 0.2102, y: 0.7100 },
    b: { x: 0.1501, y: 0.0601 },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectGamutFromIccChromaticity', () => {
    it('returns null for null / undefined / too-small buffer', () => {
        expect(detectGamutFromIccChromaticity(null)).toBeNull();
        expect(detectGamutFromIccChromaticity(undefined)).toBeNull();
        expect(detectGamutFromIccChromaticity(Buffer.alloc(50))).toBeNull();
    });

    it('returns null when wtpt / rXYZ / gXYZ / bXYZ are missing (CMYK-style)', () => {
        // Header + tag count = 0
        const buf = Buffer.alloc(260);
        buf.write('acsp', 36, 4, 'ascii');
        buf.writeUInt32BE(0, 128);
        expect(detectGamutFromIccChromaticity(buf)).toBeNull();
    });

    it('detects sRGB primaries at high confidence', () => {
        const icc = makeIccProfile(SRGB_PRESET);
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('srgb');
        expect(result!.confidence).toBe('high');
        expect(result!.whitePoint.x).toBeCloseTo(0.3127, 3);
        expect(result!.whitePoint.y).toBeCloseTo(0.3290, 3);
    });

    it('detects P3-D65 primaries at high confidence', () => {
        const icc = makeIccProfile(P3_D65_PRESET);
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('p3-d65');
        expect(result!.confidence).toBe('high');
    });

    it('detects Adobe RGB primaries at high confidence', () => {
        const icc = makeIccProfile(ADOBERGB_PRESET);
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('adobergb');
        expect(result!.confidence).toBe('high');
    });

    it('detects ProPhoto primaries at high confidence (D50 white point)', () => {
        const icc = makeIccProfile(PROPHOTO_PRESET);
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('prophoto');
        expect(result!.confidence).toBe('high');
        expect(result!.whitePoint.x).toBeCloseTo(0.3457, 3);
    });

    it('detects BT.2020 primaries at high confidence', () => {
        const icc = makeIccProfile(BT2020_PRESET);
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('bt2020');
        expect(result!.confidence).toBe('high');
    });

    it('detects custom Eizo CG2700X-flavored ICC as adobergb', () => {
        // Calibrated profile name is opaque (no rRGB / DCI / P3 hint), but the
        // chromaticities land on AdobeRGB primaries within the tolerance window.
        const icc = makeIccProfile(EIZO_CG2700X_FLAVORED);
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('adobergb');
        expect(['high', 'medium']).toContain(result!.confidence);
    });

    it('returns "unknown" for an off-gamut profile far outside any preset', () => {
        // Nonsensical primaries that don't match any canonical gamut.
        const garbage: PresetXyz = {
            wp: { x: 0.45, y: 0.40 },
            r: { x: 0.55, y: 0.40 },
            g: { x: 0.40, y: 0.55 },
            b: { x: 0.20, y: 0.20 },
        };
        const icc = makeIccProfile(garbage);
        const result = detectGamutFromIccChromaticity(icc);
        expect(result).not.toBeNull();
        expect(result!.primary).toBe('unknown');
        expect(result!.confidence).toBe('low');
    });

    it('does not throw on truncated buffer (corrupt tag table)', () => {
        const icc = makeIccProfile(SRGB_PRESET);
        // Slice off the last 60 bytes (loses bXYZ + part of gXYZ payload).
        const truncated = icc.subarray(0, icc.length - 60);
        expect(() => detectGamutFromIccChromaticity(truncated)).not.toThrow();
        // Truncated buffers should return null (missing required tags).
        const result = detectGamutFromIccChromaticity(truncated);
        expect(result).toBeNull();
    });
});
