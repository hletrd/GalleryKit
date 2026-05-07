/**
 * Color signal detection tests (US-CM04).
 *
 * Pure-function tests for inferColorPrimaries, inferTransferFunction,
 * inferMatrixCoefficients, and the top-level detectColorSignals.
 * No real files needed — we mock Sharp metadata shapes directly.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { detectColorSignals, parseCicpFromHeif } from '@/lib/color-detection';
import { extractIccProfileName as extractFromShared } from '@/lib/icc-extractor';

// ---------------------------------------------------------------------------
// Helpers — build mock Sharp metadata objects
// ---------------------------------------------------------------------------

function makeMockMeta(partial: Partial<import('sharp').Metadata> = {}): import('sharp').Metadata {
    return {
        format: 'jpeg',
        width: 100,
        height: 100,
        space: 'srgb',
        ...partial,
    } as import('sharp').Metadata;
}

// ---------------------------------------------------------------------------
// detectColorSignals — top-level integration
// ---------------------------------------------------------------------------

describe('detectColorSignals', () => {
    it('returns sRGB for untagged / null ICC', async () => {
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, makeMockMeta({ icc: undefined }));
        expect(signals.colorPrimaries).toBe('unknown');
        expect(signals.transferFunction).toBe('srgb');
        expect(signals.matrixCoefficients).toBe('unknown');
        expect(signals.isHdr).toBe(false);
        expect(signals.iccProfileName).toBeNull();
    });

    it('returns bt709 for sRGB ICC name', async () => {
        // Test via string icc field (Sharp sometimes reports this as a string).
        const metaStr = makeMockMeta({ icc: 'sRGB IEC61966-2.1' as unknown as Buffer });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, metaStr);
        expect(signals.colorPrimaries).toBe('bt709');
        expect(signals.transferFunction).toBe('srgb');
        expect(signals.matrixCoefficients).toBe('identity');
        expect(signals.isHdr).toBe(false);
    });

    it('returns p3-d65 for Display P3 ICC name', async () => {
        const meta = makeMockMeta({ icc: 'Display P3' as unknown as Buffer });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, meta);
        expect(signals.colorPrimaries).toBe('p3-d65');
        expect(signals.transferFunction).toBe('srgb');
        expect(signals.matrixCoefficients).toBe('identity');
        expect(signals.isHdr).toBe(false);
    });

    it('returns bt2020 for Rec.2020 ICC name', async () => {
        const meta = makeMockMeta({ icc: 'Rec.2020' as unknown as Buffer });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, meta);
        expect(signals.colorPrimaries).toBe('bt2020');
        expect(signals.transferFunction).toBe('srgb');
        expect(signals.matrixCoefficients).toBe('bt2020-ncl');
        expect(signals.isHdr).toBe(false);
    });

    it('returns adobergb for Adobe RGB ICC name', async () => {
        const meta = makeMockMeta({ icc: 'Adobe RGB (1998)' as unknown as Buffer });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, meta);
        expect(signals.colorPrimaries).toBe('adobergb');
        expect(signals.transferFunction).toBe('gamma22');
        expect(signals.matrixCoefficients).toBe('identity');
        expect(signals.isHdr).toBe(false);
    });

    it('returns prophoto for ProPhoto ICC name', async () => {
        const meta = makeMockMeta({ icc: 'ProPhoto RGB' as unknown as Buffer });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, meta);
        expect(signals.colorPrimaries).toBe('prophoto');
        expect(signals.transferFunction).toBe('gamma18');
        expect(signals.matrixCoefficients).toBe('identity');
        expect(signals.isHdr).toBe(false);
    });

    it('detects HDR from PQ transfer hint in ICC string', async () => {
        const meta = makeMockMeta({ icc: 'PQ HDR' as unknown as Buffer });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, meta);
        expect(signals.transferFunction).toBe('pq');
        expect(signals.isHdr).toBe(true);
    });

    it('detects HDR from HLG transfer hint in ICC string', async () => {
        const meta = makeMockMeta({ icc: 'HLG' as unknown as Buffer });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, meta);
        expect(signals.transferFunction).toBe('hlg');
        expect(signals.isHdr).toBe(true);
    });

    it('reads iccProfileName from Buffer via embedded parser', async () => {
        // Build a minimal ICC header + tag table with a 'desc' tag.
        // ICC header: 128 bytes
        // Profile size (4) + CMM type (4) + version (4) + device class (4) + color space (4) + PCS (4)
        // + date (12) + 'acsp' (4) + primary platform (4) + flags (4) + device manufacturer (4)
        // + device model (4) + device attributes (8) + rendering intent (4) + illuminant XYZ (12)
        // + creator (4) + profile ID (16) + reserved (28) = 128 bytes total.
        const buf = Buffer.alloc(256);
        buf.write('acsp', 36); // profile header magic at offset 36
        // Tag count at offset 128
        buf.writeUInt32BE(1, 128);
        // Tag entry 0: sig='desc' at offset 132
        buf.writeUInt32BE(0x64657363, 132); // 'desc'
        buf.writeUInt32BE(144, 136); // tag data offset
        buf.writeUInt32BE(20, 140); // tag data size
        // Tag data at offset 144: type signature 'desc', reserved, ascii count, then string
        buf.writeUInt32BE(0x64657363, 144); // 'desc' type
        buf.writeUInt32BE(0, 148); // reserved
        buf.writeUInt32BE(6, 152); // ascii count (including null)
        buf.write('sRGB\x00', 156); // ascii string
        const meta = makeMockMeta({ icc: buf });
        const signals = await detectColorSignals('/tmp/fake.jpg', {}, meta);
        expect(signals.iccProfileName).toBe('sRGB');
        expect(signals.colorPrimaries).toBe('bt709');
    });

    // A1: verify NCLX mapped enum values through detectColorSignals
    it('maps nclx transfer=16 to pq and marks HDR', async () => {
        const tmpFile = path.join(os.tmpdir(), `gk-cicp-16-${Date.now()}.avif`);
        const ipco = makeIpco([makeColrNclx(9, 16, 9)]);
        const iprp = makeIprp([ipco]);
        const metaBuf = makeMeta([iprp]);
        await fs.writeFile(tmpFile, metaBuf);
        try {
            const signals = await detectColorSignals(tmpFile, {}, makeMockMeta({ format: 'avif' }));
            expect(signals.transferFunction).toBe('pq');
            expect(signals.isHdr).toBe(true);
            expect(signals.colorPrimaries).toBe('bt2020');
        } finally {
            await fs.unlink(tmpFile).catch(() => {});
        }
    });

    it('maps nclx transfer=18 to hlg and marks HDR', async () => {
        const tmpFile = path.join(os.tmpdir(), `gk-cicp-18-${Date.now()}.avif`);
        const ipco = makeIpco([makeColrNclx(9, 18, 9)]);
        const iprp = makeIprp([ipco]);
        const metaBuf = makeMeta([iprp]);
        await fs.writeFile(tmpFile, metaBuf);
        try {
            const signals = await detectColorSignals(tmpFile, {}, makeMockMeta({ format: 'avif' }));
            expect(signals.transferFunction).toBe('hlg');
            expect(signals.isHdr).toBe(true);
            expect(signals.colorPrimaries).toBe('bt2020');
        } finally {
            await fs.unlink(tmpFile).catch(() => {});
        }
    });

    it('maps nclx primaries=11 to dci-p3', async () => {
        const tmpFile = path.join(os.tmpdir(), `gk-cicp-11-${Date.now()}.avif`);
        const ipco = makeIpco([makeColrNclx(11, 1, 1)]);
        const iprp = makeIprp([ipco]);
        const metaBuf = makeMeta([iprp]);
        await fs.writeFile(tmpFile, metaBuf);
        try {
            const signals = await detectColorSignals(tmpFile, {}, makeMockMeta({ format: 'avif' }));
            expect(signals.colorPrimaries).toBe('dci-p3');
            expect(signals.transferFunction).toBe('srgb');
            expect(signals.isHdr).toBe(false);
        } finally {
            await fs.unlink(tmpFile).catch(() => {});
        }
    });
});

// ---------------------------------------------------------------------------
// US-CM05: parseCicpFromHeif — ISOBMFF nclx box walker
// ---------------------------------------------------------------------------

function makeBox(type: string, data: Buffer): Buffer {
    const size = 8 + data.length;
    const buf = Buffer.alloc(size);
    buf.writeUInt32BE(size, 0);
    buf.write(type, 4, 4, 'ascii');
    data.copy(buf, 8);
    return buf;
}

function makeFullBox(type: string, version: number, flags: number, data: Buffer): Buffer {
    const size = 12 + data.length;
    const buf = Buffer.alloc(size);
    buf.writeUInt32BE(size, 0);
    buf.write(type, 4, 4, 'ascii');
    buf.writeUInt8(version, 8);
    buf.writeUInt8((flags >> 16) & 0xFF, 9);
    buf.writeUInt8((flags >> 8) & 0xFF, 10);
    buf.writeUInt8(flags & 0xFF, 11);
    data.copy(buf, 12);
    return buf;
}

function makeColrNclx(primaries: number, transfer: number, matrix: number): Buffer {
    // colour_type(4) + primaries(2) + transfer(2) + matrix(2) + full_range(1) = 11
    // colr is a regular Box (not FullBox) per ISOBMFF.
    const data = Buffer.alloc(11);
    data.write('nclx', 0, 4, 'ascii');
    data.writeUInt16BE(primaries, 4);
    data.writeUInt16BE(transfer, 6);
    data.writeUInt16BE(matrix, 8);
    data.writeUInt8(0x80, 10); // full_range = 1
    return makeBox('colr', data);
}

function makeColrProf(): Buffer {
    // colour_type = 'prof' with dummy ICC data
    // colr is a regular Box (not FullBox) per ISOBMFF.
    const data = Buffer.alloc(8);
    data.write('prof', 0, 4, 'ascii');
    data.writeUInt32BE(0, 4);
    return makeBox('colr', data);
}

function makeMeta(children: Buffer[]): Buffer {
    return makeFullBox('meta', 0, 0, Buffer.concat(children));
}

function makeIprp(children: Buffer[]): Buffer {
    return makeBox('iprp', Buffer.concat(children));
}

function makeIpco(children: Buffer[]): Buffer {
    return makeBox('ipco', Buffer.concat(children));
}

describe('parseCicpFromHeif', () => {
    it('finds nclx in a flat colr box', () => {
        const buf = makeColrNclx(12, 1, 0); // P3-D65, sRGB, identity
        const result = parseCicpFromHeif(buf);
        expect(result).not.toBeNull();
        expect(result!.colourPrimaries).toBe(12);
        expect(result!.transferCharacteristics).toBe(1);
        expect(result!.matrixCoefficients).toBe(0);
    });

    it('finds nclx inside meta → iprp → ipco', () => {
        const ipco = makeIpco([makeColrNclx(9, 13, 9)]); // BT.2020, PQ, BT.2020-ncl
        const iprp = makeIprp([ipco]);
        const meta = makeMeta([iprp]);
        const result = parseCicpFromHeif(meta);
        expect(result).not.toBeNull();
        expect(result!.colourPrimaries).toBe(9);
        expect(result!.transferCharacteristics).toBe(13);
        expect(result!.matrixCoefficients).toBe(9);
    });

    it('returns null for malformed colr box (too small)', () => {
        // colr FullBox with only 3 bytes of data — too small for colour_type
        const buf = makeFullBox('colr', 0, 0, Buffer.from([0, 0, 0]));
        const result = parseCicpFromHeif(buf);
        expect(result).toBeNull();
    });

    it('skips prof colr and finds later nclx colr (nclx wins)', () => {
        const ipco = makeIpco([makeColrProf(), makeColrNclx(12, 14, 0)]); // prof then P3/HLG
        const iprp = makeIprp([ipco]);
        const meta = makeMeta([iprp]);
        const result = parseCicpFromHeif(meta);
        expect(result).not.toBeNull();
        expect(result!.colourPrimaries).toBe(12);
        expect(result!.transferCharacteristics).toBe(14); // HLG
    });

    it('returns null when colr has prof type and no nclx', () => {
        const ipco = makeIpco([makeColrProf()]);
        const iprp = makeIprp([ipco]);
        const meta = makeMeta([iprp]);
        const result = parseCicpFromHeif(meta);
        expect(result).toBeNull();
    });

    it('returns null when no colr box exists', () => {
        const meta = makeMeta([makeBox('pitm', Buffer.from([0, 0, 0, 1]))]);
        const result = parseCicpFromHeif(meta);
        expect(result).toBeNull();
    });

    it('respects depth bound — stops at >5 levels', () => {
        // Nest iprp → ipco 6 levels deep (exceeds MAX_DEPTH=5)
        let deep = makeIpco([makeColrNclx(1, 1, 1)]) as Buffer;
        for (let i = 0; i < 6; i++) {
            deep = makeIprp([deep]);
        }
        const meta = makeMeta([deep]);
        const result = parseCicpFromHeif(meta);
        expect(result).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// WI-02: extractIccProfileName consolidation — shared module correctness
// ---------------------------------------------------------------------------

describe('extractIccProfileName (shared module)', () => {
    it('parses sRGB ICC profile name from minimal valid buffer', () => {
        const buf = Buffer.alloc(256);
        buf.write('acsp', 36); // profile header magic at offset 36
        buf.writeUInt32BE(1, 128); // tag count
        buf.writeUInt32BE(0x64657363, 132); // 'desc' tag sig
        buf.writeUInt32BE(144, 136); // tag data offset
        buf.writeUInt32BE(20, 140); // tag data size
        buf.writeUInt32BE(0x64657363, 144); // 'desc' type
        buf.writeUInt32BE(0, 148); // reserved
        buf.writeUInt32BE(6, 152); // ascii count (including null)
        buf.write('sRGB\x00', 156); // ascii string
        expect(extractFromShared(buf)).toBe('sRGB');
    });

    it('returns null for non-Buffer input', () => {
        expect(extractFromShared(null)).toBeNull();
        expect(extractFromShared(undefined)).toBeNull();
        expect(extractFromShared('string' as unknown as Buffer)).toBeNull();
    });

    it('returns null for buffer too short', () => {
        expect(extractFromShared(Buffer.alloc(100))).toBeNull();
    });
});
