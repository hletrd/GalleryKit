import { describe, it, expect } from 'vitest';
import { verifyAvifNclxInBuffer, verifyWebpIccInBuffer } from '@/lib/process-image';

describe('verifyAvifNclxInBuffer', () => {
    function buildNclxColrBox(primaries: number, transfer: number): Buffer {
        // ISOBMFF colr box: [size: 4 BE][type: 'colr'][color_type: 'nclx'][primaries: 2 BE][transfer: 2 BE][matrix: 2 BE][full_range: 1]
        const payloadSize = 4 + 2 + 2 + 2 + 1; // nclx + primaries + transfer + matrix + full_range
        const boxSize = 8 + payloadSize;
        const buf = Buffer.alloc(boxSize);
        buf.writeUInt32BE(boxSize, 0);
        buf.write('colr', 4, 4, 'ascii');
        buf.write('nclx', 8, 4, 'ascii');
        buf.writeUInt16BE(primaries, 12);
        buf.writeUInt16BE(transfer, 14);
        buf.writeUInt16BE(1, 16); // matrix = BT.709
        buf.writeUInt8(1, 18); // full_range = true
        return buf;
    }

    function buildProfColrBox(): Buffer {
        // ISOBMFF colr box with ICC profile type
        const iccData = Buffer.from('mock-icc-profile-data');
        const payloadSize = 4 + iccData.length;
        const boxSize = 8 + payloadSize;
        const buf = Buffer.alloc(boxSize);
        buf.writeUInt32BE(boxSize, 0);
        buf.write('colr', 4, 4, 'ascii');
        buf.write('prof', 8, 4, 'ascii');
        iccData.copy(buf, 12);
        return buf;
    }

    it('passes when NCLX primaries and transfer match expected values', () => {
        const box = buildNclxColrBox(12, 13);
        const result = verifyAvifNclxInBuffer(box, 12, 13);
        expect(result.ok).toBe(true);
        // R28-CP-MED-1: message now includes matrix (fixture writes matrix=1).
        expect(result.message).toContain('NCLX primaries=12 transfer=13');
        expect(result.message).toContain('matrix=1');
    });

    // R28-CP-MED-1: matrix coefficient verification — fail FAST when matrix
    // drifts even though primaries and transfer are right. This catches
    // encoder regressions (libheif/libavif default matrix change) that today
    // pass through silently because the audit only inspects primaries/transfer.
    it('fails when expected matrix mismatches the NCLX matrix field', () => {
        // Fixture writes matrix=1 (BT.709); caller expects matrix=6 (BT.601).
        const box = buildNclxColrBox(12, 13);
        const result = verifyAvifNclxInBuffer(box, 12, 13, 6);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('matrix mismatch');
        expect(result.message).toContain('matrix=1');
        expect(result.message).toContain('expected 6');
    });

    it('passes when expected matrix matches the NCLX matrix field', () => {
        const box = buildNclxColrBox(12, 13);
        const result = verifyAvifNclxInBuffer(box, 12, 13, 1);
        expect(result.ok).toBe(true);
        expect(result.message).toContain('matrix=1');
    });

    it('passes when no expected matrix is provided (backward-compatible)', () => {
        const box = buildNclxColrBox(12, 13);
        const result = verifyAvifNclxInBuffer(box, 12, 13);
        expect(result.ok).toBe(true);
    });

    it('fails when NCLX primaries mismatch', () => {
        const box = buildNclxColrBox(1, 13);
        const result = verifyAvifNclxInBuffer(box, 12, 13);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('NCLX mismatch');
        expect(result.message).toContain('primaries=1');
    });

    it('fails when NCLX transfer mismatch', () => {
        const box = buildNclxColrBox(12, 1);
        const result = verifyAvifNclxInBuffer(box, 12, 13);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('transfer=1');
    });

    it('accepts ICC profile (prof) as valid alternative to NCLX', () => {
        const box = buildProfColrBox();
        const result = verifyAvifNclxInBuffer(box, 12, 13);
        expect(result.ok).toBe(true);
        expect(result.message).toContain('prof');
    });

    // R27-CP-LOW-1: real-world `colr(prof)` boxes contain a full ICC payload
    // (kilobytes). The scanner must not gate on the NCLX 64-byte cap when the
    // color_type is `prof`, otherwise legitimate ICC-embedded AVIFs are
    // misreported as "no NCLX colr box found" in the audit log.
    it('accepts large ICC profile (prof) box exceeding NCLX size cap', () => {
        // Build a colr(prof) box whose payload is 4 KB of mock ICC data.
        const iccData = Buffer.alloc(4096, 0x42);
        const payloadSize = 4 + iccData.length;
        const boxSize = 8 + payloadSize;
        const buf = Buffer.alloc(boxSize);
        buf.writeUInt32BE(boxSize, 0);
        buf.write('colr', 4, 4, 'ascii');
        buf.write('prof', 8, 4, 'ascii');
        iccData.copy(buf, 12);
        const result = verifyAvifNclxInBuffer(buf, 12, 13);
        expect(result.ok).toBe(true);
        expect(result.message).toContain('prof');
    });

    it('fails when no colr box is present', () => {
        const buf = Buffer.from('not an avif file');
        const result = verifyAvifNclxInBuffer(buf, 12, 13);
        expect(result.ok).toBe(false);
        expect(result.message).toBe('no NCLX colr box found');
    });

    it('fails when buffer is too small', () => {
        const buf = Buffer.alloc(8);
        const result = verifyAvifNclxInBuffer(buf, 12, 13);
        expect(result.ok).toBe(false);
        expect(result.message).toBe('buffer too small');
    });

    it('accepts sRGB NCLX values (primaries=1, transfer=13)', () => {
        const box = buildNclxColrBox(1, 13);
        const result = verifyAvifNclxInBuffer(box, 1, 13);
        expect(result.ok).toBe(true);
        expect(result.message).toContain('primaries=1');
    });
});

describe('verifyWebpIccInBuffer', () => {
    function buildWebpWithIccp(): Buffer {
        // RIFF header + ICCP chunk
        const iccData = Buffer.from('mock-icc');
        const chunkSize = iccData.length;
        const paddedSize = chunkSize + (chunkSize % 2);
        const totalSize = 12 + 8 + paddedSize;
        const buf = Buffer.alloc(totalSize);
        buf.write('RIFF', 0, 4, 'ascii');
        buf.writeUInt32LE(totalSize - 8, 4);
        buf.write('WEBP', 8, 4, 'ascii');
        buf.writeUInt32LE(chunkSize, 12);
        buf.write('ICCP', 16, 4, 'ascii');
        iccData.copy(buf, 20);
        return buf;
    }

    function buildWebpWithoutIccp(): Buffer {
        // RIFF header + VP8 chunk (no ICCP)
        const vp8Data = Buffer.from('mock-vp8-data');
        const chunkSize = vp8Data.length;
        const paddedSize = chunkSize + (chunkSize % 2);
        const totalSize = 12 + 8 + paddedSize;
        const buf = Buffer.alloc(totalSize);
        buf.write('RIFF', 0, 4, 'ascii');
        buf.writeUInt32LE(totalSize - 8, 4);
        buf.write('WEBP', 8, 4, 'ascii');
        buf.writeUInt32LE(chunkSize, 12);
        buf.write('VP8 ', 16, 4, 'ascii');
        vp8Data.copy(buf, 20);
        return buf;
    }

    it('passes when ICCP chunk is present', () => {
        const buf = buildWebpWithIccp();
        const result = verifyWebpIccInBuffer(buf);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('ICCP chunk found');
    });

    it('fails when no ICCP chunk is present', () => {
        const buf = buildWebpWithoutIccp();
        const result = verifyWebpIccInBuffer(buf);
        expect(result.ok).toBe(false);
        expect(result.message).toBe('no ICCP chunk found');
    });

    it('fails when buffer is too small', () => {
        const buf = Buffer.from('short');
        const result = verifyWebpIccInBuffer(buf);
        expect(result.ok).toBe(false);
        expect(result.message).toBe('buffer too small');
    });

    it('fails when not a valid WebP file', () => {
        const buf = Buffer.from('this is not webp');
        const result = verifyWebpIccInBuffer(buf);
        expect(result.ok).toBe(false);
        expect(result.message).toBe('not a valid WebP file');
    });

    it('handles multiple chunks and still finds ICCP', () => {
        // RIFF + VP8 + ICCP (ICCP after VP8)
        const vp8Data = Buffer.from('mock-vp8');
        const iccData = Buffer.from('mock-icc');
        const vp8Size = vp8Data.length;
        const vp8Padded = vp8Size + (vp8Size % 2);
        const iccSize = iccData.length;
        const iccPadded = iccSize + (iccSize % 2);
        const totalSize = 12 + 8 + vp8Padded + 8 + iccPadded;
        const buf = Buffer.alloc(totalSize);
        buf.write('RIFF', 0, 4, 'ascii');
        buf.writeUInt32LE(totalSize - 8, 4);
        buf.write('WEBP', 8, 4, 'ascii');
        // VP8 chunk
        buf.writeUInt32LE(vp8Size, 12);
        buf.write('VP8 ', 16, 4, 'ascii');
        vp8Data.copy(buf, 20);
        // ICCP chunk
        const iccOffset = 20 + vp8Padded;
        buf.writeUInt32LE(iccSize, iccOffset);
        buf.write('ICCP', iccOffset + 4, 4, 'ascii');
        iccData.copy(buf, iccOffset + 8);
        const result = verifyWebpIccInBuffer(buf);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('ICCP chunk found');
    });
});
