/**
 * Color signal detection tests (US-CM04).
 *
 * Pure-function tests for inferColorPrimaries, inferTransferFunction,
 * inferMatrixCoefficients, and the top-level detectColorSignals.
 * No real files needed — we mock Sharp metadata shapes directly.
 */

import { describe, it, expect } from 'vitest';
import { detectColorSignals } from '@/lib/color-detection';

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
});
