/**
 * Apple HDR gain map detection tests (P4-A1 / R4-H1).
 *
 * Pure-function tests for `hasGainMap`. No real iPhone HEIC fixture is
 * required — gain map signaling is a structural property of the ISOBMFF
 * container that we can synthesize byte-for-byte. The fixtures cover
 *
 *   - Pre-iOS-17 Apple HDR HEIC: 'urim' infe + Apple gain map URI.
 *   - iOS-17+ ISO 21496-1 HEIC: 'tmap' infe.
 *   - 'auxl' iref pointing at a 'urim' / 'tmap' item that did not carry
 *     the URI inline on the infe.
 *   - HEIF without any gain map signaling (Sony / Canon style).
 *   - Plain bytes (JPEG / PNG / WebP analogue) — must return false.
 *   - Malformed / truncated containers — must return false (no throw).
 */

import { describe, it, expect } from 'vitest';
import { hasGainMap } from '@/lib/gain-map-detection';

const APPLE_GAIN_MAP_URI = 'urn:com:apple:photo:2020:aux:hdrgainmap';

// ---------------------------------------------------------------------------
// ISOBMFF fixture helpers
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

/**
 * Build an `infe` (item info entry) FullBox for ISOBMFF version 2 layout.
 *
 *   item_id (2) + item_protection_index (2) + item_type (4)
 *     + item_name '\0' + [item_uri '\0' when item_type == 'urim']
 */
function makeInfe(itemId: number, itemType: string, itemUri?: string, itemName: string = ''): Buffer {
    const nameBuf = Buffer.from(itemName + '\0', 'utf8');
    const uriBuf = itemUri !== undefined ? Buffer.from(itemUri + '\0', 'utf8') : Buffer.alloc(0);
    const data = Buffer.alloc(2 + 2 + 4 + nameBuf.length + uriBuf.length);
    let pos = 0;
    data.writeUInt16BE(itemId, pos); pos += 2;
    data.writeUInt16BE(0, pos); pos += 2; // item_protection_index
    data.write(itemType, pos, 4, 'ascii'); pos += 4;
    nameBuf.copy(data, pos); pos += nameBuf.length;
    uriBuf.copy(data, pos);
    return makeFullBox('infe', 2, 0, data);
}

function makeIinf(infeBoxes: Buffer[]): Buffer {
    const entryCount = Buffer.alloc(2);
    entryCount.writeUInt16BE(infeBoxes.length, 0);
    return makeFullBox('iinf', 0, 0, Buffer.concat([entryCount, ...infeBoxes]));
}

/**
 * Build a single typed reference entry inside iref (e.g. an `auxl` box).
 *
 *   from_item_id (2) + reference_count (2) + N × to_item_id (2)
 */
function makeIrefEntry(referenceType: string, fromItemId: number, toItemIds: number[]): Buffer {
    const data = Buffer.alloc(2 + 2 + toItemIds.length * 2);
    let pos = 0;
    data.writeUInt16BE(fromItemId, pos); pos += 2;
    data.writeUInt16BE(toItemIds.length, pos); pos += 2;
    for (const id of toItemIds) {
        data.writeUInt16BE(id, pos); pos += 2;
    }
    return makeBox(referenceType, data);
}

function makeIref(entries: Buffer[]): Buffer {
    return makeFullBox('iref', 0, 0, Buffer.concat(entries));
}

function makeMeta(children: Buffer[]): Buffer {
    return makeFullBox('meta', 0, 0, Buffer.concat(children));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hasGainMap', () => {
    it('returns false for empty / tiny buffer', () => {
        expect(hasGainMap(Buffer.alloc(0))).toBe(false);
        expect(hasGainMap(Buffer.alloc(7))).toBe(false);
    });

    it('returns false for plain JPEG / PNG / WebP analogue (no meta box)', () => {
        // Make something that *looks* like JPEG header bytes but has no ISOBMFF
        // structure at all.
        const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00]);
        expect(hasGainMap(buf)).toBe(false);
    });

    it('returns false for HEIF without any gain map signaling (Sony / Canon style)', () => {
        const iinf = makeIinf([
            makeInfe(1, 'hvc1'),
            makeInfe(2, 'Exif'),
        ]);
        const meta = makeMeta([iinf]);
        expect(hasGainMap(meta)).toBe(false);
    });

    it('detects pre-iOS-17 Apple HDR HEIC: urim infe + Apple gain map URI', () => {
        const iinf = makeIinf([
            makeInfe(1, 'hvc1'),
            makeInfe(2, 'urim', APPLE_GAIN_MAP_URI, 'gainmap'),
        ]);
        const meta = makeMeta([iinf]);
        expect(hasGainMap(meta)).toBe(true);
    });

    it('detects iOS-17+ ISO 21496-1 gain map: tmap infe', () => {
        const iinf = makeIinf([
            makeInfe(1, 'hvc1'),
            makeInfe(2, 'tmap', undefined, 'tonemap'),
        ]);
        const meta = makeMeta([iinf]);
        expect(hasGainMap(meta)).toBe(true);
    });

    it('detects gain map via auxl iref when urim has no inline URI', () => {
        // Some encoders write the URI in a sibling URI box rather than inline
        // on infe. The auxl reference still pinpoints the auxiliary item.
        const iinf = makeIinf([
            makeInfe(1, 'hvc1'),
            makeInfe(42, 'urim', undefined, 'aux'),
        ]);
        const iref = makeIref([
            makeIrefEntry('auxl', 1, [42]),
        ]);
        const meta = makeMeta([iinf, iref]);
        expect(hasGainMap(meta)).toBe(true);
    });

    it('does NOT detect gain map when auxl iref points at a non-urim/tmap item', () => {
        // Generic auxl pointing at e.g. an alpha mask is NOT a gain map.
        const iinf = makeIinf([
            makeInfe(1, 'hvc1'),
            makeInfe(42, 'hvc1', undefined, 'alpha'),
        ]);
        const iref = makeIref([
            makeIrefEntry('auxl', 1, [42]),
        ]);
        const meta = makeMeta([iinf, iref]);
        expect(hasGainMap(meta)).toBe(false);
    });

    it('does NOT detect gain map when urim URI is unrelated', () => {
        const iinf = makeIinf([
            makeInfe(1, 'hvc1'),
            makeInfe(2, 'urim', 'urn:example:something:else', 'other'),
        ]);
        const meta = makeMeta([iinf]);
        expect(hasGainMap(meta)).toBe(false);
    });

    it('returns false for malformed / truncated buffer (no throw)', () => {
        // Truncated meta box header
        const truncated = Buffer.from([0, 0, 0, 0xFF, 0x6D, 0x65, 0x74, 0x61]);
        expect(hasGainMap(truncated)).toBe(false);

        // Bogus box-size larger than buffer
        const bogus = Buffer.alloc(20);
        bogus.writeUInt32BE(0xFFFFFFF0, 0);
        bogus.write('meta', 4, 4, 'ascii');
        expect(hasGainMap(bogus)).toBe(false);
    });

    it('detects multiple gain map item ids without false positives', () => {
        const iinf = makeIinf([
            makeInfe(1, 'hvc1'),
            makeInfe(2, 'urim', APPLE_GAIN_MAP_URI, 'gainmap'),
            makeInfe(3, 'tmap', undefined, 'tonemap'),
            makeInfe(4, 'Exif'),
        ]);
        const meta = makeMeta([iinf]);
        expect(hasGainMap(meta)).toBe(true);
    });
});
