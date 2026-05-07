/**
 * ICC profile name extractor.
 *
 * Shared between color-detection.ts and process-image.ts to avoid circular
 * imports. Returns the human-readable profile description (e.g. "sRGB IEC61966-2.1")
 * from the embedded ICC header.
 */

function decodeUtf16BE(buffer: Buffer): string {
    return new TextDecoder('utf-16be').decode(buffer);
}

function clampUtf8Bytes(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
        return value;
    }
    let output = '';
    let bytes = 0;
    for (const char of value) {
        const charBytes = Buffer.byteLength(char, 'utf8');
        if (bytes + charBytes > maxBytes) break;
        output += char;
        bytes += charBytes;
    }
    return output.trim();
}

function cleanString(value: string): string | null {
    const s = value.replace(/\0/g, '').trim();
    if (s.length === 0) return null;
    return clampUtf8Bytes(s, 255) || null;
}

export function extractIccProfileName(icc?: Buffer | null): string | null {
    if (!icc || icc.length <= 132) return null;

    try {
        const iccLen = icc.length;
        // ICC profile structure: 128-byte header, then tag table. Bound the
        // tag count so malformed profiles cannot force large loops.
        const tagCount = Math.min(icc.readUInt32BE(128), 100);
        for (let i = 0; i < tagCount; i++) {
            const tagOffset = 132 + i * 12;
            if (tagOffset + 12 > iccLen) break;
            const tagSig = icc.subarray(tagOffset, tagOffset + 4).toString('ascii');
            if (tagSig !== 'desc') continue;

            const dataOffset = icc.readUInt32BE(tagOffset + 4);
            const dataSize = icc.readUInt32BE(tagOffset + 8);
            if (dataOffset + 12 > iccLen || dataSize < 12 || dataOffset + dataSize > iccLen) break;

            const descType = icc.subarray(dataOffset, dataOffset + 4).toString('ascii');
            if (descType === 'desc') {
                const declaredLength = icc.readUInt32BE(dataOffset + 8);
                if (declaredLength === 0) break;
                const strLen = Math.min(declaredLength, dataSize - 12, 1024);
                const strStart = dataOffset + 12;
                const strEnd = strStart + Math.max(0, strLen - 1);
                if (strEnd > iccLen || strStart >= strEnd) break;
                return cleanString(icc.subarray(strStart, strEnd).toString('ascii'));
            }

            if (descType === 'mluc') {
                // Multi-localized Unicode: type/reserved, record count, record
                // size, then records. Text is UTF-16BE per ICC, not UTF-16LE.
                const numRecords = Math.min(icc.readUInt32BE(dataOffset + 8), 100);
                const recordSize = icc.readUInt32BE(dataOffset + 12);
                if (recordSize < 12) break;
                const recordsStart = dataOffset + 16;
                for (let recordIndex = 0; recordIndex < numRecords; recordIndex++) {
                    const recOffset = recordsStart + recordIndex * recordSize;
                    if (recOffset + 12 > iccLen || recOffset + 12 > dataOffset + dataSize) break;
                    const recLen = Math.min(icc.readUInt32BE(recOffset + 4), 1024);
                    const recTextOffset = icc.readUInt32BE(recOffset + 8);
                    const strStart = dataOffset + recTextOffset;
                    const strEnd = strStart + recLen;
                    if (strEnd > iccLen || strEnd > dataOffset + dataSize || strStart >= strEnd) continue;
                    const decoded = decodeUtf16BE(icc.subarray(strStart, strEnd));
                    const cleaned = cleanString(decoded);
                    if (cleaned) return cleaned;
                }
            }

            break;
        }
    } catch {
        // ICC parsing is best-effort.
    }

    return null;
}
