/**
 * ISOBMFF parent-container bounds regression tests (DBG-01, run-10 c2).
 *
 * `readBoxHeader` in gain-map-detection.ts and the inline box walker in
 * color-detection.ts's `parseCicpFromHeif` previously validated a child
 * box's declared size only against the WHOLE-BUFFER length, not against the
 * true end of its enclosing container (iinf, ipco, etc). A child box that
 * lies about its size — declaring an end past its container's true boundary
 * but still within the overall buffer — could therefore "borrow" bytes that
 * belong to a sibling structure and have them misread as its own trailing
 * fields (an infe's item_uri string, or a colr box's nclx payload).
 *
 * gps-exif-strip.ts's walkChildren() already gets this right (rejects when
 * `pos + size > end`, the container end, not `buffer.length`); this file
 * locks the equivalent fix in gain-map-detection.ts and color-detection.ts.
 */

import { describe, it, expect } from 'vitest';
import { hasGainMap } from '@/lib/gain-map-detection';
import { parseCicpFromHeif } from '@/lib/color-detection';

const APPLE_GAIN_MAP_URI = 'urn:com:apple:photo:2020:aux:hdrgainmap';

// ---------------------------------------------------------------------------
// ISOBMFF fixture helpers (mirrors gain-map-detection.test.ts / color-detection.test.ts)
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

function makeMeta(children: Buffer[]): Buffer {
    return makeFullBox('meta', 0, 0, Buffer.concat(children));
}

function makeIprp(children: Buffer[]): Buffer {
    return makeBox('iprp', Buffer.concat(children));
}

function makeIpco(children: Buffer[]): Buffer {
    return makeBox('ipco', Buffer.concat(children));
}

function makeColrNclx(primaries: number, transfer: number, matrix: number): Buffer {
    // colour_type(4) + primaries(2) + transfer(2) + matrix(2) + full_range(1) = 11
    const data = Buffer.alloc(11);
    data.write('nclx', 0, 4, 'ascii');
    data.writeUInt16BE(primaries, 4);
    data.writeUInt16BE(transfer, 6);
    data.writeUInt16BE(matrix, 8);
    data.writeUInt8(0x80, 10);
    return makeBox('colr', data);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ISOBMFF parent-container bounds (DBG-01, run-10 c2)', () => {
    describe('hasGainMap — infe overflow past the iinf end', () => {
        // DBG-01 (a): a child infe declares a size past the iinf end but
        // within the overall buffer. Before the fix, readBoxHeader validated
        // only against buffer.length, so parseInfe's item_uri read reached
        // into the foreign bytes below and picked up the Apple gain-map URI
        // that does NOT belong to this infe's true (short) content.
        it('does NOT treat an infe that overflows past the iinf end as a valid gain-map entry', () => {
            const infe1 = makeInfe(1, 'hvc1');

            // True physical bytes are a harmless, URI-less 'urim' entry
            // (empty item_name, no item_uri) — but the declared size field
            // is overwritten to lie, claiming a size that reaches well past
            // the iinf container's true end into the foreign bytes below.
            const maliciousInfe = makeInfe(99, 'urim', undefined, '');
            const trueLen = maliciousInfe.length;
            const lieSize = trueLen + 60; // overflows into foreignBytes below
            maliciousInfe.writeUInt32BE(lieSize, 0);

            const iinf = makeIinf([infe1, maliciousInfe]);

            // Sibling bytes within meta, positioned immediately after iinf's
            // true end — NOT part of iinf's content. Only reachable if the
            // overflow bug lets the malicious infe's declared size overrun
            // its true container.
            const foreignBytes = Buffer.concat([
                Buffer.from(APPLE_GAIN_MAP_URI + '\0', 'utf8'),
                Buffer.alloc(100),
            ]);

            const meta = makeMeta([iinf, foreignBytes]);

            expect(hasGainMap(meta)).toBe(false);
        });

        // Positive control: the same shape without the lie must still detect
        // the gain map — the fix must not regress well-formed containers.
        it('positive control: a well-formed equivalent (no overflow) still detects the gain map', () => {
            const infe1 = makeInfe(1, 'hvc1');
            const infe2 = makeInfe(2, 'urim', APPLE_GAIN_MAP_URI, 'gainmap');
            const iinf = makeIinf([infe1, infe2]);
            const meta = makeMeta([iinf]);
            expect(hasGainMap(meta)).toBe(true);
        });
    });

    describe('parseCicpFromHeif — colr box overflow past the ipco end', () => {
        // DBG-01 (b): a meta -> iprp -> ipco structure where the (only)
        // child box inside ipco overflows its container into sibling bytes
        // within iprp that contain a fake colr/nclx payload. Before the fix,
        // the inline walker validated the declared size only against
        // buffer.length, so it would read the colour_type + CICP fields from
        // those foreign bytes and return a fabricated triplet.
        it('does NOT parse CICP from foreign bytes reached via an overflowing colr header', () => {
            // A "colr" box whose true physical bytes are just its 8-byte
            // header (zero data) — its declared size lies, claiming 19 bytes
            // (8 header + 11 nclx payload), reaching past ipco's true end.
            const fakeColrHeader = Buffer.alloc(8);
            fakeColrHeader.writeUInt32BE(19, 0); // LIE: true size is 8
            fakeColrHeader.write('colr', 4, 4, 'ascii');

            const ipco = makeIpco([fakeColrHeader]);

            // Foreign nclx-shaped payload placed immediately after ipco's
            // true end — a sibling within iprp, not part of ipco's content.
            const foreignNclxPayload = Buffer.alloc(11);
            foreignNclxPayload.write('nclx', 0, 4, 'ascii');
            foreignNclxPayload.writeUInt16BE(9, 4); // bt2020
            foreignNclxPayload.writeUInt16BE(16, 6); // pq
            foreignNclxPayload.writeUInt16BE(9, 8); // bt2020-ncl
            foreignNclxPayload.writeUInt8(0x80, 10);

            const iprp = makeIprp([ipco, foreignNclxPayload]);
            const meta = makeMeta([iprp]);

            expect(parseCicpFromHeif(meta)).toBeNull();
        });

        // Positive control: a well-formed nclx colr box nested normally in
        // meta -> iprp -> ipco (no overflow) must still parse correctly.
        it('positive control: a well-formed nclx colr box nested in meta/iprp/ipco still parses', () => {
            const ipco = makeIpco([makeColrNclx(12, 1, 0)]);
            const iprp = makeIprp([ipco]);
            const meta = makeMeta([iprp]);
            const result = parseCicpFromHeif(meta);
            expect(result).not.toBeNull();
            expect(result!.colourPrimaries).toBe(12);
            expect(result!.transferCharacteristics).toBe(1);
            expect(result!.matrixCoefficients).toBe(0);
        });
    });
});
