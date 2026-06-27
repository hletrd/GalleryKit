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
});
