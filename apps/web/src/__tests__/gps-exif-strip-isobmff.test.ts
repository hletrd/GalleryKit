/**
 * R19C19 F2 (PRIVACY): the bounded ISOBMFF walker in stripGpsFromIsobmffBuffer
 * must NOT report `{ stripped: false }` (= "no GPS present, keep original
 * bytes") when it actually ABORTED on a malformed box before reaching the
 * iinf/infe Exif items. A malformed-box abort must surface as `null` (structural
 * anomaly) so stripGpsFromOriginal falls through to the metadata-free re-encode
 * tier instead of trusting a "clean" verdict it never established — otherwise a
 * crafted HEIF/AVIF could smuggle GPS through the strip.
 */
import { describe, it, expect } from 'vitest';
import { stripGpsFromIsobmffBuffer } from '@/lib/gps-exif-strip';

/** Build a minimal top-level `meta` box wrapping the given content bytes. */
function metaBox(content: Buffer): Buffer {
    const versionFlags = Buffer.alloc(4); // FullBox version+flags
    const size = 8 + versionFlags.length + content.length;
    const header = Buffer.alloc(8);
    header.writeUInt32BE(size, 0);
    header.write('meta', 4, 'ascii');
    return Buffer.concat([header, versionFlags, content]);
}

/** Build an `infe` v2 box advertising the given item id with type "Exif". */
function exifInfe(itemId: number): Buffer {
    const data = Buffer.alloc(12);
    data.writeUInt8(2, 0);            // FullBox version 2 (HEIF item)
    data.writeUInt16BE(itemId, 4);   // item_ID
    // bytes 6-7 item_protection_index = 0
    data.write('Exif', 8, 'ascii');  // item_type
    const box = Buffer.alloc(8 + data.length);
    box.writeUInt32BE(box.length, 0);
    box.write('infe', 4, 'ascii');
    data.copy(box, 8);
    return box;
}

/** Build an `iinf` v0 box wrapping a single infe entry. */
function iinfWith(infe: Buffer): Buffer {
    const data = Buffer.concat([Buffer.alloc(6), infe]); // version(1)+flags(3)+entry_count(2)
    data.writeUInt8(0, 0);           // version 0
    data.writeUInt16BE(1, 4);        // entry_count = 1
    const box = Buffer.alloc(8 + data.length);
    box.writeUInt32BE(box.length, 0);
    box.write('iinf', 4, 'ascii');
    data.copy(box, 8);
    return box;
}

/** Build a minimal `iloc` v0 box with itemCount = 0 (no extents). */
function emptyIloc(): Buffer {
    const data = Buffer.alloc(8); // version+flags(4), sizesByte, sizesByte2, itemCount(2) — all 0
    const box = Buffer.alloc(8 + data.length);
    box.writeUInt32BE(box.length, 0);
    box.write('iloc', 4, 'ascii');
    data.copy(box, 8);
    return box;
}

/** A 64-bit box whose largesize overflows MAX_SAFE_INTEGER (aborts the walk). */
function oversizedBox(): Buffer {
    const box = Buffer.alloc(16);
    box.writeUInt32BE(1, 0);                       // size = 1 → read 64-bit largesize
    box.write('free', 4, 'ascii');
    box.writeBigUInt64BE(0xffffffffffffffffn, 8);  // > Number.MAX_SAFE_INTEGER
    return box;
}

describe('stripGpsFromIsobmffBuffer malformed-box handling (R19C19 F2)', () => {
    it('returns null (anomaly → re-encode) when a 64-bit box claims an oversized size before Exif items', () => {
        // Child box with size===1 (extended size) and largesize > MAX_SAFE_INTEGER.
        const child = Buffer.alloc(16);
        child.writeUInt32BE(1, 0);          // size = 1 → read 64-bit largesize
        child.write('free', 4, 'ascii');    // arbitrary type, reached before any iinf
        child.writeBigUInt64BE(0xffffffffffffffffn, 8); // largesize > Number.MAX_SAFE_INTEGER
        const buf = metaBox(child);

        // BEFORE the fix this returned { stripped: false } (falsely "clean").
        expect(stripGpsFromIsobmffBuffer(buf)).toBeNull();
    });

    it('returns null when a box claims a size that runs past its parent', () => {
        // A box whose declared size overruns the meta content end.
        const child = Buffer.alloc(8);
        child.writeUInt32BE(9999, 0);       // size far beyond the buffer
        child.write('free', 4, 'ascii');
        const buf = metaBox(child);
        expect(stripGpsFromIsobmffBuffer(buf)).toBeNull();
    });

    it('still reports { stripped: false } for a well-formed container with no Exif/XMP items (no false anomaly)', () => {
        // iinf v0 with entry_count = 0: the walk completes cleanly with zero
        // Exif/mime items — a genuine "nothing to strip", NOT an abort.
        const iinf = Buffer.alloc(14);
        iinf.writeUInt32BE(14, 0);
        iinf.write('iinf', 4, 'ascii');
        iinf.writeUInt8(0, 8);  // version 0
        // bytes 9-11 flags = 0; bytes 12-13 entry_count = 0 (left zero)
        const buf = metaBox(iinf);

        const result = stripGpsFromIsobmffBuffer(buf);
        expect(result).not.toBeNull();
        expect(result?.stripped).toBe(false);
    });

    it('R20C20 (CQ20-06): returns null when the walk aborts AFTER finding an Exif item', () => {
        // Container with a valid Exif infe (exifItemIds becomes non-empty) and an
        // empty iloc, followed by a malformed box that aborts the walk. BEFORE the
        // fix the walkAborted check lived inside the empty-items branch, so this
        // returned { stripped: false } — a "clean" verdict that trusted a walk it
        // never finished (a later GPS-bearing item could have survived). AFTER the
        // fix any structural anomaly returns null → metadata-free re-encode.
        const aborted = metaBox(Buffer.concat([
            iinfWith(exifInfe(1)),
            emptyIloc(),
            oversizedBox(),
        ]));
        expect(stripGpsFromIsobmffBuffer(aborted)).toBeNull();

        // Discriminator: the SAME container WITHOUT the malformed trailing box
        // completes cleanly and reports { stripped: false } (Exif item found, no
        // extent to strip) — proving the null above is driven by walkAborted, not
        // by the Exif item or the empty iloc.
        const clean = metaBox(Buffer.concat([
            iinfWith(exifInfe(1)),
            emptyIloc(),
        ]));
        const cleanResult = stripGpsFromIsobmffBuffer(clean);
        expect(cleanResult).not.toBeNull();
        expect(cleanResult?.stripped).toBe(false);
    });
});
