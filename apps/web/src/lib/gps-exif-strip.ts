/**
 * Lossless byte-level GPS metadata removal for photographer originals.
 *
 * R4C8 COR-R4C8-01: the previous `strip_gps_on_upload` implementation
 * relied on Sharp's `withMetadata({ orientation, icc })`, which in
 * Sharp 0.33+ KEEPS all input EXIF (it is the keep-metadata API; the
 * options merely override orientation/ICC on top). The GPS IFD therefore
 * survived the "strip" byte-for-byte — and the rewrite additionally
 * re-encoded the original at default quality (JPEG q80 / HEIF q50),
 * silently degrading the stored original.
 *
 * This module performs container-aware byte surgery instead: the pixel
 * stream is NEVER decoded, so the original stays bit-identical except
 * for the neutralized GPS regions. Every walker is bounds-checked and
 * returns `null` on any structural anomaly so the caller can fall back
 * to a (lossy but privacy-preserving) re-encode.
 *
 * Supported containers:
 *  - JPEG  (APP1 Exif segment; GPS-bearing XMP APP1 segments dropped —
 *           BOTH the standard packet and ExtendedXMP overflow segments
 *           are token-tested, including a reconstruction pass that
 *           catches tokens split across ExtendedXMP chunk boundaries.
 *           A JPEG carrying a post-EOI trailer — a second full FFD8…FFD9
 *           image (MPF secondary / Samsung·Pixel Motion Photo) or an
 *           appended container — is treated as a structural anomaly:
 *           the lossless single-image walker returns null so the caller's
 *           re-encode fallback strips the trailer entirely, SEC-R4C10-01)
 *  - TIFF  (whole-file IFD walk; GPS-bearing XMP tag value zeroed)
 *  - ISOBMFF / HEIF / AVIF / HEIC (Exif item located via iinf+iloc;
 *    GPS-bearing XMP mime items zeroed)
 *  - WebP  (RIFF EXIF chunk TIFF scrub; GPS-bearing XMP chunk retagged)
 *
 * GPS neutralization inside a TIFF block: every entry of the GPS IFD
 * (referenced by tag 0x8825 in IFD0/IFD1) has its value bytes zeroed —
 * both inline values and offset-referenced ranges — the 12-byte entries
 * themselves are zeroed, and the entry count is set to 0. Readers
 * (exiftool, exif-reader, OS shells) then report no GPS tags, and no
 * coordinate bytes remain recoverable in the file.
 */

const GPS_IFD_POINTER_TAG = 0x8825;
const XMP_TIFF_TAG = 0x02bc;
const MAX_IFD_CHAIN = 8;
const MAX_IFD_ENTRIES = 1024;

/** Field byte width per TIFF type id. Unknown ids are structural anomalies. */
const TIFF_TYPE_SIZE: Record<number, number> = {
    1: 1, // BYTE
    2: 1, // ASCII
    3: 2, // SHORT
    4: 4, // LONG
    5: 8, // RATIONAL
    6: 1, // SBYTE
    7: 1, // UNDEFINED
    8: 2, // SSHORT
    9: 4, // SLONG
    10: 8, // SRATIONAL
    11: 4, // FLOAT
    12: 8, // DOUBLE
};

/** Case-sensitive markers that identify location data inside XMP packets. */
const XMP_GPS_TOKEN = /GPS(?:Latitude|Longitude|Altitude|Position|Coordinates|DestLatitude|DestLongitude)/;

export interface GpsStripResult {
    /** The (possibly rewritten) file bytes. Same reference as input when `stripped` is false. */
    buffer: Buffer;
    /** True when GPS data was found and neutralized (file must be rewritten). */
    stripped: boolean;
}

interface TiffReader {
    u16(offset: number): number;
    u32(offset: number): number;
    w16(offset: number, value: number): void;
    w32(offset: number, value: number): void;
}

function makeTiffReader(buf: Buffer, littleEndian: boolean): TiffReader {
    return littleEndian
        ? {
            u16: (o) => buf.readUInt16LE(o),
            u32: (o) => buf.readUInt32LE(o),
            w16: (o, v) => { buf.writeUInt16LE(v, o); },
            w32: (o, v) => { buf.writeUInt32LE(v, o); },
        }
        : {
            u16: (o) => buf.readUInt16BE(o),
            u32: (o) => buf.readUInt32BE(o),
            w16: (o, v) => { buf.writeUInt16BE(v, o); },
            w32: (o, v) => { buf.writeUInt32BE(v, o); },
        };
}

/**
 * Neutralize GPS data inside one TIFF block of `buf` spanning
 * [tiffStart, tiffEnd). Mutates `buf` in place.
 *
 * @returns true when GPS data was found and zeroed, false when none was
 *          present, null on any structural anomaly (caller must treat
 *          the buffer as suspect and fall back to re-encode).
 */
export function stripGpsFromTiffRegion(buf: Buffer, tiffStart: number, tiffEnd: number): boolean | null {
    if (tiffEnd > buf.length || tiffEnd - tiffStart < 8) return null;
    const order = buf.toString('ascii', tiffStart, tiffStart + 2);
    let r: TiffReader;
    if (order === 'II') r = makeTiffReader(buf, true);
    else if (order === 'MM') r = makeTiffReader(buf, false);
    else return null;
    if (r.u16(tiffStart + 2) !== 42) return null;

    const inBounds = (abs: number, size: number) => abs >= tiffStart && abs + size <= tiffEnd;

    let stripped = false;

    const zeroGpsIfd = (gpsIfdAbs: number): boolean | null => {
        if (!inBounds(gpsIfdAbs, 2)) return null;
        const count = r.u16(gpsIfdAbs);
        if (count > MAX_IFD_ENTRIES) return null;
        const entriesStart = gpsIfdAbs + 2;
        // entries + 4-byte next-IFD pointer must fit
        if (!inBounds(entriesStart, count * 12 + 4)) return null;
        for (let i = 0; i < count; i++) {
            const entry = entriesStart + i * 12;
            const type = r.u16(entry + 2);
            const valueCount = r.u32(entry + 4);
            const typeSize = TIFF_TYPE_SIZE[type];
            if (typeSize === undefined) return null;
            const valueSize = typeSize * valueCount;
            if (valueSize > 4) {
                const valueAbs = tiffStart + r.u32(entry + 8);
                if (!inBounds(valueAbs, valueSize)) return null;
                buf.fill(0, valueAbs, valueAbs + valueSize);
            }
            buf.fill(0, entry, entry + 12);
        }
        // Zero the next-IFD pointer that follows the (now zeroed) entries,
        // then collapse the IFD to zero entries. Readers see an empty GPS
        // IFD terminated by a 0 next pointer.
        buf.fill(0, entriesStart + count * 12, entriesStart + count * 12 + 4);
        r.w16(gpsIfdAbs, 0);
        return count > 0;
    };

    // Walk the IFD chain (IFD0 → IFD1 → …, bounded) looking for the GPS
    // pointer tag and GPS-bearing XMP tag values.
    let ifdAbs = tiffStart + r.u32(tiffStart + 4);
    // AGG-L2 / CR-02 (run-6 cycle-2): a structurally-valid TIFF always points
    // IFD0 past the 8-byte header (offset >= 8). A literal 0 offset (ifdAbs ===
    // tiffStart) or one pointing into the header is a structural anomaly. The
    // old code let `ifdAbs !== tiffStart` short-circuit the loop and return the
    // LENIENT `false` ("no GPS found" → leave the original byte-identical),
    // whereas the rest of this module's doctrine is to return `null` on any
    // anomaly so the caller falls through to the tier-2 metadata-free re-encode.
    // Return null here to match that fail-safe posture for malformed/hostile
    // files. (No real GPS bytes are reachable through a 0-offset IFD0 anyway.)
    if (ifdAbs <= tiffStart + 7) return null;
    const visited = new Set<number>();
    for (let chain = 0; chain < MAX_IFD_CHAIN && ifdAbs !== tiffStart; chain++) {
        if (visited.has(ifdAbs)) return null;
        visited.add(ifdAbs);
        if (!inBounds(ifdAbs, 2)) return null;
        const count = r.u16(ifdAbs);
        if (count > MAX_IFD_ENTRIES) return null;
        const entriesStart = ifdAbs + 2;
        if (!inBounds(entriesStart, count * 12 + 4)) return null;
        for (let i = 0; i < count; i++) {
            const entry = entriesStart + i * 12;
            const tag = r.u16(entry);
            if (tag === GPS_IFD_POINTER_TAG) {
                const gpsIfdAbs = tiffStart + r.u32(entry + 8);
                const zeroed = zeroGpsIfd(gpsIfdAbs);
                if (zeroed === null) return null;
                if (zeroed) stripped = true;
            } else if (tag === XMP_TIFF_TAG) {
                // TIFF-embedded XMP packet — zero it entirely when it
                // carries GPS markers (XML validity is sacrificed; readers
                // skip unparsable XMP).
                const type = r.u16(entry + 2);
                const valueCount = r.u32(entry + 4);
                const typeSize = TIFF_TYPE_SIZE[type];
                if (typeSize === undefined) return null;
                const valueSize = typeSize * valueCount;
                const valueAbs = valueSize > 4 ? tiffStart + r.u32(entry + 8) : entry + 8;
                if (!inBounds(valueAbs, valueSize)) return null;
                const xmp = buf.toString('latin1', valueAbs, valueAbs + valueSize);
                if (XMP_GPS_TOKEN.test(xmp)) {
                    buf.fill(0, valueAbs, valueAbs + valueSize);
                    stripped = true;
                }
            }
        }
        const next = r.u32(entriesStart + count * 12);
        if (next === 0) break;
        ifdAbs = tiffStart + next;
    }

    return stripped;
}

const EXIF_APP1_SIGNATURE = Buffer.from('Exif\0\0', 'latin1');
const XMP_APP1_SIGNATURE = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1');
const XMP_EXT_APP1_SIGNATURE = Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1');

/** JPEG End-Of-Image marker. Cannot occur inside valid entropy-coded scan
 *  data (a literal 0xFF there is always followed by 0x00 stuffing or an
 *  RSTn marker), so `indexOf(JPEG_EOI_MARKER, scanStart)` reliably locates
 *  the primary image's true terminator. */
const JPEG_EOI_MARKER = Buffer.from([0xff, 0xd9]);
/** Tolerate a couple of trailing padding bytes some encoders emit after EOI
 *  before treating the remainder as a post-EOI trailer (SEC-R4C10-01). */
const JPEG_TRAILER_TOLERANCE_BYTES = 2;

/**
 * Lossless GPS strip for a JPEG file. Zeroes the GPS IFD inside every
 * APP1 Exif segment and DROPS XMP APP1 segments (standard + extended)
 * when the standard XMP packet carries GPS markers.
 *
 * @returns null on structural anomaly; `{ stripped: false }` when the
 *          file carries no GPS (input buffer returned unmodified).
 */
export function stripGpsFromJpegBuffer(input: Buffer): GpsStripResult | null {
    if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
    const buf = Buffer.from(input); // work on a copy
    let stripped = false;
    let dropXmp = false;

    // SEC-R4C9-01: ExtendedXMP chunk bookkeeping. Per XMP Specification
    // Part 3 §1.1.3.1 each ExtendedXMP APP1 payload is:
    //   signature(35) + GUID(32) + full_length u32(4) + offset u32(4) + data.
    // The GPS properties of a > 64 KB packet commonly live ONLY in these
    // overflow chunks (the standard packet then carries just the
    // xmpNote:HasExtendedXMP pointer), so the extension payloads must be
    // token-tested too — per chunk AND as the offset-ordered reconstruction
    // (a token can straddle a chunk boundary).
    type ExtXmpChunk = { offset: number; data: Buffer };
    const extXmpChunks: ExtXmpChunk[] = [];

    type Segment = { start: number; end: number; marker: number; dataStart: number; dataEnd: number };
    const segments: Segment[] = [];

    let pos = 2;
    // SEC-R4C10-01: position of the SOS/EOI marker that ended the header
    // walk — the start of the region in which the primary image's terminal
    // EOI lives. Used to detect a post-EOI trailer below.
    let scanRegionStart = -1;
    while (pos + 4 <= buf.length) {
        if (buf[pos] !== 0xff) return null;
        // Skip fill bytes (0xFF padding before a marker)
        let markerPos = pos;
        while (markerPos + 1 < buf.length && buf[markerPos + 1] === 0xff) markerPos++;
        if (markerPos + 1 >= buf.length) return null;
        const marker = buf[markerPos + 1];
        if (marker === 0xda || marker === 0xd9) { scanRegionStart = markerPos; break; } // SOS / EOI — no metadata beyond
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            pos = markerPos + 2;
            continue;
        }
        if (markerPos + 4 > buf.length) return null;
        const segLength = buf.readUInt16BE(markerPos + 2);
        if (segLength < 2 || markerPos + 2 + segLength > buf.length) return null;
        segments.push({
            start: markerPos,
            end: markerPos + 2 + segLength,
            marker,
            dataStart: markerPos + 4,
            dataEnd: markerPos + 2 + segLength,
        });
        pos = markerPos + 2 + segLength;
    }

    // SEC-R4C10-01: reject a post-EOI trailer. A JPEG may carry a second
    // full FFD8…FFD9 image after the primary EOI (MPF secondary, Samsung /
    // Pixel Motion Photo) or an appended container. The header walk above
    // only inspects the PRIMARY image's segments, so a GPS-bearing trailer
    // (binary EXIF GPS IFD or GPS XMP in the embedded secondary) would be
    // copied verbatim into the rewritten output while we report success.
    // The lossless path cannot certify the trailer is GPS-free, so a
    // non-trivial trailer is a structural anomaly: return null and let the
    // caller's tier-2 Sharp re-encode drop the trailer entirely (it decodes
    // only the primary still). FF D9 cannot occur inside valid entropy-coded
    // scan data, so indexOf finds the true primary EOI even for progressive
    // (multi-SOS) JPEGs whose only EOI is the final one.
    if (scanRegionStart !== -1) {
        const eoiIdx = buf.indexOf(JPEG_EOI_MARKER, scanRegionStart);
        if (eoiIdx !== -1 && buf.length - (eoiIdx + 2) > JPEG_TRAILER_TOLERANCE_BYTES) {
            return null;
        }
    }

    for (const seg of segments) {
        if (seg.marker !== 0xe1) continue;
        const data = buf.subarray(seg.dataStart, seg.dataEnd);
        if (data.length >= EXIF_APP1_SIGNATURE.length
            && data.subarray(0, EXIF_APP1_SIGNATURE.length).equals(EXIF_APP1_SIGNATURE)) {
            const tiffStart = seg.dataStart + EXIF_APP1_SIGNATURE.length;
            const result = stripGpsFromTiffRegion(buf, tiffStart, seg.dataEnd);
            if (result === null) return null;
            if (result) stripped = true;
        } else if (data.length >= XMP_APP1_SIGNATURE.length
            && data.subarray(0, XMP_APP1_SIGNATURE.length).equals(XMP_APP1_SIGNATURE)) {
            const xmp = data.toString('latin1');
            if (XMP_GPS_TOKEN.test(xmp)) dropXmp = true;
        } else if (data.length >= XMP_EXT_APP1_SIGNATURE.length
            && data.subarray(0, XMP_EXT_APP1_SIGNATURE.length).equals(XMP_EXT_APP1_SIGNATURE)) {
            // SEC-R4C9-01: token-test ExtendedXMP overflow chunks too. The
            // whole payload (GUID header included — hex ASCII, cannot
            // false-negative the token) is tested per chunk; data runs are
            // additionally collected for the joined reconstruction below.
            const xmp = data.toString('latin1');
            if (XMP_GPS_TOKEN.test(xmp)) dropXmp = true;
            const headerEnd = XMP_EXT_APP1_SIGNATURE.length + 40;
            if (data.length > headerEnd) {
                extXmpChunks.push({
                    offset: data.readUInt32BE(XMP_EXT_APP1_SIGNATURE.length + 36),
                    data: data.subarray(headerEnd),
                });
            }
        }
    }

    // SEC-R4C9-01: reconstruct the extended packet in declared-offset order
    // and token-test the joined string so a GPS marker split across two
    // ExtendedXMP chunks cannot slip through. Only needed when the
    // per-chunk pass above found nothing and there are multiple chunks.
    if (!dropXmp && extXmpChunks.length > 1) {
        extXmpChunks.sort((a, b) => a.offset - b.offset);
        const joined = Buffer.concat(extXmpChunks.map((c) => c.data)).toString('latin1');
        if (XMP_GPS_TOKEN.test(joined)) dropXmp = true;
    }

    if (!stripped && !dropXmp) {
        return { buffer: input, stripped: false };
    }
    if (!dropXmp) {
        return { buffer: buf, stripped: true };
    }

    // Rebuild the byte stream without the XMP APP1 segments (standard and
    // extended — ExtendedXMP chunks can carry the overflow of the packet
    // that contained the GPS markers).
    const dropRanges: Array<{ start: number; end: number }> = [];
    for (const seg of segments) {
        if (seg.marker !== 0xe1) continue;
        const data = buf.subarray(seg.dataStart, seg.dataEnd);
        const isXmp = data.length >= XMP_APP1_SIGNATURE.length
            && data.subarray(0, XMP_APP1_SIGNATURE.length).equals(XMP_APP1_SIGNATURE);
        const isXmpExt = data.length >= XMP_EXT_APP1_SIGNATURE.length
            && data.subarray(0, XMP_EXT_APP1_SIGNATURE.length).equals(XMP_EXT_APP1_SIGNATURE);
        if (isXmp || isXmpExt) dropRanges.push({ start: seg.start, end: seg.end });
    }
    const parts: Buffer[] = [];
    let cursor = 0;
    for (const range of dropRanges) {
        parts.push(buf.subarray(cursor, range.start));
        cursor = range.end;
    }
    parts.push(buf.subarray(cursor));
    return { buffer: Buffer.concat(parts), stripped: true };
}

/** Lossless GPS strip for a TIFF file (the file IS the TIFF block). */
export function stripGpsFromTiffBuffer(input: Buffer): GpsStripResult | null {
    const buf = Buffer.from(input);
    const result = stripGpsFromTiffRegion(buf, 0, buf.length);
    if (result === null) return null;
    return result ? { buffer: buf, stripped: true } : { buffer: input, stripped: false };
}

/**
 * Lossless GPS strip for HEIF-family containers (HEIC / HEIF / AVIF).
 *
 * Locates `Exif` items via the meta → iinf → infe boxes, resolves their
 * payload extents via iloc (construction_method 0, i.e. file offsets),
 * and runs the TIFF scrub on each payload. XMP mime items with GPS
 * markers are zeroed in place. Bounded walk mirroring the project's
 * existing ISOBMFF parsers (color-detection / gain-map-detection).
 */
export function stripGpsFromIsobmffBuffer(input: Buffer): GpsStripResult | null {
    const buf = Buffer.from(input);
    const MAX_DEPTH = 5;

    type Box = { type: string; dataStart: number; dataEnd: number };

    function* walkChildren(start: number, end: number, depth: number): Generator<Box> {
        if (depth > MAX_DEPTH) return;
        let pos = start;
        while (pos + 8 <= end) {
            let size = buf.readUInt32BE(pos);
            const type = buf.toString('ascii', pos + 4, pos + 8);
            let headerSize = 8;
            if (size === 1) {
                if (pos + 16 > end) return;
                const big = buf.readBigUInt64BE(pos + 8);
                if (big > BigInt(Number.MAX_SAFE_INTEGER)) return;
                size = Number(big);
                headerSize = 16;
            } else if (size === 0) {
                size = end - pos;
            }
            if (size < headerSize || pos + size > end) return;
            yield { type, dataStart: pos + headerSize, dataEnd: pos + size };
            pos += size;
        }
    }

    // Find the top-level meta box (FullBox: 4 bytes version/flags).
    let meta: Box | null = null;
    for (const box of walkChildren(0, buf.length, 0)) {
        if (box.type === 'meta') { meta = box; break; }
    }
    if (!meta || meta.dataEnd - meta.dataStart < 4) return null;
    const metaContentStart = meta.dataStart + 4;

    // Collect item_ID → item_type from iinf/infe, and iloc extents.
    const exifItemIds = new Set<number>();
    const xmpItemIds = new Set<number>();
    let ilocBox: Box | null = null;

    for (const box of walkChildren(metaContentStart, meta.dataEnd, 1)) {
        if (box.type === 'iinf') {
            if (box.dataEnd - box.dataStart < 4) return null;
            const version = buf.readUInt8(box.dataStart);
            const entriesStart = box.dataStart + (version === 0 ? 6 : 8);
            for (const infe of walkChildren(entriesStart, box.dataEnd, 2)) {
                if (infe.type !== 'infe') continue;
                if (infe.dataEnd - infe.dataStart < 8) continue;
                const infeVersion = buf.readUInt8(infe.dataStart);
                if (infeVersion < 2) continue; // HEIF items use infe v2/v3
                const idSize = infeVersion === 2 ? 2 : 4;
                const itemId = infeVersion === 2
                    ? buf.readUInt16BE(infe.dataStart + 4)
                    : buf.readUInt32BE(infe.dataStart + 4);
                const typeOffset = infe.dataStart + 4 + idSize + 2; // + protection_index
                if (typeOffset + 4 > infe.dataEnd) continue;
                const itemType = buf.toString('ascii', typeOffset, typeOffset + 4);
                if (itemType === 'Exif') exifItemIds.add(itemId);
                if (itemType === 'mime') {
                    // content_type string follows the (null-terminated) item_name
                    const tail = buf.toString('latin1', typeOffset + 4, infe.dataEnd);
                    if (tail.includes('application/rdf+xml') || tail.toLowerCase().includes('xmp')) {
                        xmpItemIds.add(itemId);
                    }
                }
            }
        } else if (box.type === 'iloc') {
            ilocBox = box;
        }
    }

    if (exifItemIds.size === 0 && xmpItemIds.size === 0) {
        return { buffer: input, stripped: false };
    }
    if (!ilocBox) return null;

    // Parse iloc (versions 0-2) and collect extents for the target items.
    const d = ilocBox.dataStart;
    if (ilocBox.dataEnd - d < 8) return null;
    const ilocVersion = buf.readUInt8(d);
    if (ilocVersion > 2) return null;
    const sizesByte = buf.readUInt8(d + 4);
    const offsetSize = (sizesByte >> 4) & 0xf;
    const lengthSize = sizesByte & 0xf;
    const sizesByte2 = buf.readUInt8(d + 5);
    const baseOffsetSize = (sizesByte2 >> 4) & 0xf;
    const indexSize = ilocVersion >= 1 ? (sizesByte2 & 0xf) : 0;
    const readSized = (offset: number, size: number): number | null => {
        if (size === 0) return 0;
        if (size === 4) return buf.readUInt32BE(offset);
        if (size === 8) {
            const big = buf.readBigUInt64BE(offset);
            return big > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(big);
        }
        return null;
    };
    for (const size of [offsetSize, lengthSize, baseOffsetSize]) {
        if (size !== 0 && size !== 4 && size !== 8) return null;
    }

    let pos: number;
    let itemCount: number;
    if (ilocVersion < 2) {
        itemCount = buf.readUInt16BE(d + 6);
        pos = d + 8;
    } else {
        if (ilocBox.dataEnd - d < 10) return null;
        itemCount = buf.readUInt32BE(d + 6);
        pos = d + 10;
    }
    if (itemCount > 4096) return null;

    const extents: Array<{ id: number; start: number; length: number }> = [];
    for (let i = 0; i < itemCount; i++) {
        const idSize = ilocVersion === 2 ? 4 : 2;
        if (pos + idSize > ilocBox.dataEnd) return null;
        const itemId = ilocVersion === 2 ? buf.readUInt32BE(pos) : buf.readUInt16BE(pos);
        pos += idSize;
        let constructionMethod = 0;
        if (ilocVersion >= 1) {
            if (pos + 2 > ilocBox.dataEnd) return null;
            constructionMethod = buf.readUInt16BE(pos) & 0xf;
            pos += 2;
        }
        if (pos + 2 + baseOffsetSize + 2 > ilocBox.dataEnd) return null;
        pos += 2; // data_reference_index
        const baseOffset = readSized(pos, baseOffsetSize);
        if (baseOffset === null) return null;
        pos += baseOffsetSize;
        const extentCount = buf.readUInt16BE(pos);
        pos += 2;
        if (extentCount > 64) return null;
        for (let e = 0; e < extentCount; e++) {
            const extentEntrySize = indexSize + offsetSize + lengthSize;
            if (pos + extentEntrySize > ilocBox.dataEnd) return null;
            pos += indexSize;
            const extentOffset = readSized(pos, offsetSize);
            pos += offsetSize;
            const extentLength = readSized(pos, lengthSize);
            pos += lengthSize;
            if (extentOffset === null || extentLength === null) return null;
            const isTarget = exifItemIds.has(itemId) || xmpItemIds.has(itemId);
            if (!isTarget) continue;
            if (constructionMethod !== 0) return null; // only file-offset items supported
            extents.push({ id: itemId, start: baseOffset + extentOffset, length: extentLength });
        }
    }

    let stripped = false;
    for (const extent of extents) {
        const { id, start, length } = extent;
        if (start < 0 || length < 0 || start + length > buf.length) return null;
        if (exifItemIds.has(id)) {
            // HEIF Exif item payload: u32 exif_tiff_header_offset, then the
            // EXIF block (which may itself start with "Exif\0\0").
            if (length < 8) continue;
            const headerOffset = buf.readUInt32BE(start);
            if (headerOffset > length - 8) return null;
            let tiffStart = start + 4 + headerOffset;
            if (buf.length - tiffStart >= 6
                && buf.subarray(tiffStart, tiffStart + 6).equals(EXIF_APP1_SIGNATURE)) {
                tiffStart += 6;
            }
            const result = stripGpsFromTiffRegion(buf, tiffStart, start + 4 + (length - 4));
            if (result === null) return null;
            if (result) stripped = true;
        } else {
            const xmp = buf.toString('latin1', start, start + length);
            if (XMP_GPS_TOKEN.test(xmp)) {
                buf.fill(0, start, start + length);
                stripped = true;
            }
        }
    }

    return stripped ? { buffer: buf, stripped: true } : { buffer: input, stripped: false };
}

/**
 * Lossless GPS strip for WebP (RIFF). The EXIF chunk payload is a TIFF
 * block (optionally prefixed with "Exif\0\0"); GPS-bearing XMP chunks
 * are retagged to JUNK with a zeroed payload (sizes preserved — readers
 * skip JUNK chunks per RIFF convention).
 */
export function stripGpsFromWebpBuffer(input: Buffer): GpsStripResult | null {
    if (input.length < 12
        || input.toString('ascii', 0, 4) !== 'RIFF'
        || input.toString('ascii', 8, 12) !== 'WEBP') {
        return null;
    }
    const buf = Buffer.from(input);
    let stripped = false;
    let offset = 12;
    while (offset + 8 <= buf.length) {
        // RIFF sub-chunk layout is [FourCC tag: 4 bytes][size: 4 bytes LE][data]
        // — the tag comes FIRST, then the size (per the WebP RIFF container spec).
        const chunkTag = buf.toString('ascii', offset, offset + 4);
        const chunkSize = buf.readUInt32LE(offset + 4);
        const dataStart = offset + 8;
        const dataEnd = dataStart + chunkSize;
        if (dataEnd > buf.length) return null;
        if (chunkTag === 'EXIF') {
            let tiffStart = dataStart;
            if (chunkSize >= 6 && buf.subarray(dataStart, dataStart + 6).equals(EXIF_APP1_SIGNATURE)) {
                tiffStart += 6;
            }
            const result = stripGpsFromTiffRegion(buf, tiffStart, dataEnd);
            if (result === null) return null;
            if (result) stripped = true;
        } else if (chunkTag === 'XMP ') {
            const xmp = buf.toString('latin1', dataStart, dataEnd);
            if (XMP_GPS_TOKEN.test(xmp)) {
                // Retag the chunk's FourCC (bytes 0-3 of the sub-chunk) to JUNK
                // so readers skip it; the size field (bytes 4-7) is preserved.
                buf.write('JUNK', offset, 4, 'ascii');
                buf.fill(0, dataStart, dataEnd);
                stripped = true;
            }
        }
        const paddedSize = chunkSize + (chunkSize % 2);
        const next = dataStart + paddedSize;
        if (next <= offset) return null;
        offset = next;
    }
    return stripped ? { buffer: buf, stripped: true } : { buffer: input, stripped: false };
}
