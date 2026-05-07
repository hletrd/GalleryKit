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
    12: 'p3-d65',
};

const NCLX_TRANSFER_MAP: Record<number, ColorSignals['transferFunction']> = {
    1: 'srgb',
    2: 'gamma22',
    13: 'pq',
    14: 'hlg',
    18: 'gamma18',
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
                // colr is a FullBox: version(1) + flags(3) + colour_type(4) + ...
                if (dataSize >= 11) {
                    const colourType = buffer.toString('ascii', dataStart + 4, dataStart + 8);
                    if (colourType === 'nclx' && dataSize >= 15) {
                        // FullBox(4) + colour_type(4) + primaries(2) + transfer(2) + matrix(2) + full_range(1) = 15
                        return {
                            colourPrimaries: buffer.readUInt16BE(dataStart + 8),
                            transferCharacteristics: buffer.readUInt16BE(dataStart + 10),
                            matrixCoefficients: buffer.readUInt16BE(dataStart + 12),
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
    // by reusing the same bounds-checked parser used in process-image.ts.
    // For detectColorSignals we only need the name string, not the full ICC.
    let iccName: string | null = null;
    if (metadata.icc && Buffer.isBuffer(metadata.icc)) {
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
    let nclxCicp: CicpTriplet | null = null;
    const format = metadata.format?.toLowerCase();
    if (format === 'heif' || format === 'avif') {
        try {
            const fileHandle = await open(filepath, 'r');
            try {
                const header = Buffer.alloc(1024 * 1024); // 1 MB cap
                const { bytesRead } = await fileHandle.read(header, 0, header.length, 0);
                if (bytesRead > 0) {
                    nclxCicp = parseCicpFromHeif(header.subarray(0, bytesRead));
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
