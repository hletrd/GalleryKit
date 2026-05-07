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

export interface ColorSignals {
    /** Canonical ICC profile name parsed from the file. */
    iccProfileName: string | null;
    /** Color primaries inferred from ICC name or nclx box. */
    colorPrimaries: 'bt709' | 'p3-d65' | 'dci-p3' | 'adobergb' | 'prophoto' | 'bt2020' | 'unknown';
    /** Transfer function inferred from ICC description + bit depth. */
    transferFunction: 'srgb' | 'gamma22' | 'gamma18' | 'pq' | 'hlg' | 'linear' | 'unknown';
    /** Matrix coefficients inferred from ICC / container metadata. */
    matrixCoefficients: 'bt709' | 'bt2020-ncl' | 'identity' | 'unknown';
    /** Whether the image is HDR (PQ or HLG transfer). */
    isHdr: boolean;
}

function normalizeName(name: string | null | undefined): string {
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

    // 16-bit+ with no other clues → could be HDR; mark unknown rather than guess
    if (bitDepth && bitDepth >= 10) return 'unknown';

    return 'srgb';
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

/**
 * Detect color signals from a Sharp-loaded image.
 *
 * @param _filepath — reserved for future nclx box parsing (US-CM05)
 * @param metadata  — Sharp metadata() result (icc, depth, etc.)
 */
export async function detectColorSignals(
    _filepath: string,
    _image: unknown,
    metadata: Metadata,
): Promise<ColorSignals> {
    // Sharp's metadata().icc is a Buffer when present; try to extract a name
    // by reusing the same bounds-checked parser used in process-image.ts.
    // For detectColorSignals we only need the name string, not the full ICC.
    let iccName: string | null = null;
    if (metadata.icc && Buffer.isBuffer(metadata.icc)) {
        iccName = extractIccProfileName(metadata.icc);
    } else if (typeof metadata.icc === 'string') {
        iccName = metadata.icc;
    }
    void _filepath; // reserved for future nclx box parsing (US-CM05)

    const colorPrimaries = inferColorPrimaries(iccName);
    const bitDepth = typeof metadata.depth === 'string'
        ? ({ uchar: 8, char: 8, ushort: 16, short: 16, uint: 32, int: 32, float: 32, complex: 64, double: 64, dpcomplex: 128 } as Record<string, number>)[metadata.depth] ?? null
        : (typeof metadata.depth === 'number' && Number.isFinite(metadata.depth) ? metadata.depth : null);

    const transferFunction = inferTransferFunction(iccName, null, bitDepth);
    const matrixCoefficients = inferMatrixCoefficients(iccName);
    const isHdr = transferFunction === 'pq' || transferFunction === 'hlg';

    return {
        iccProfileName: iccName,
        colorPrimaries,
        transferFunction,
        matrixCoefficients,
        isHdr,
    };
}

// ---------------------------------------------------------------------------
// Shared ICC profile name extractor (duplicated here to keep color-detection
// self-contained and avoid a circular import with process-image.ts).
// ---------------------------------------------------------------------------

const ICC_TAG_TABLE = {
    desc: 0x64657363,
    dmdd: 0x646D6464,
    dmnd: 0x646D6E64,
};

function readTagCount(buf: Buffer, offset: number): number {
    return buf.readUInt32BE(offset + 128);
}

function readTagEntry(buf: Buffer, tableOffset: number, index: number): { sig: number; offset: number; size: number } | null {
    const entryOffset = tableOffset + 4 + index * 12;
    if (entryOffset + 12 > buf.length) return null;
    return {
        sig: buf.readUInt32BE(entryOffset),
        offset: buf.readUInt32BE(entryOffset + 4),
        size: buf.readUInt32BE(entryOffset + 8),
    };
}

function readAsciiFromTag(buf: Buffer, entry: { offset: number; size: number }, maxLen: number): string {
    const start = entry.offset;
    const maxRead = Math.min(entry.size, maxLen);
    if (start + maxRead > buf.length) return '';

    const typeSig = buf.readUInt32BE(start);
    let strOffset = start;
    let strLen = maxRead;

    if (typeSig === 0x64657363) {
        // 'desc' — ICC profile description tag
        strOffset = start + 12;
        const asciiCount = buf.readUInt32BE(start + 8);
        strLen = Math.min(asciiCount, maxRead - 12);
    } else if (typeSig === 0x74657874) {
        // 'text' — literal ASCII
        strOffset = start + 8;
        strLen = maxRead - 8;
    } else if (typeSig === 0x6D6C7563) {
        // 'mluc' — multi-localized Unicode; skip to first ASCII fallback
        const recCount = buf.readUInt32BE(start + 8);
        if (recCount > 0) {
            const recOffset = start + 16;
            const recSize = buf.readUInt32BE(recOffset + 8);
            strOffset = recOffset + 12;
            strLen = Math.min(recSize, maxRead - (recOffset - start) - 12);
        }
    }

    if (strOffset + strLen > buf.length) strLen = Math.max(0, buf.length - strOffset);
    if (strLen <= 0) return '';

    const slice = buf.subarray(strOffset, strOffset + strLen);
    let out = '';
    for (let i = 0; i < slice.length; i++) {
        const b = slice[i];
        if (b === 0) break;
        out += String.fromCharCode(b);
    }
    return out.trim();
}

// Internal copy — process-image.ts is the canonical export source.
function extractIccProfileName(iccBuffer: Buffer | null | undefined): string | null {
    if (!iccBuffer || !Buffer.isBuffer(iccBuffer) || iccBuffer.length < 132) {
        return null;
    }

    try {
        const tagCount = readTagCount(iccBuffer, 0);
        if (tagCount > 1024) return null;
        const tableOffset = 128;

        for (let i = 0; i < Math.min(tagCount, 1024); i++) {
            const entry = readTagEntry(iccBuffer, tableOffset, i);
            if (!entry) continue;
            if (entry.sig === ICC_TAG_TABLE.desc || entry.sig === ICC_TAG_TABLE.dmdd || entry.sig === ICC_TAG_TABLE.dmnd) {
                return readAsciiFromTag(iccBuffer, entry, 256) || null;
            }
        }
    } catch {
        // Defensive: malformed ICC buffer
    }

    return null;
}
