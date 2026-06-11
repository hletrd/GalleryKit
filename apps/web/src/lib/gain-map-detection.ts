/**
 * Apple HDR gain map detection (P4-A1 / R4-H1).
 *
 * Walks the HEIF / AVIF ISOBMFF container looking for evidence that the file
 * carries an Apple-style HDR gain map auxiliary item. The gain map encodes
 * the per-pixel scale factor used at decode time to reconstruct the HDR
 * extended-range image from an SDR base. GalleryKit currently delivers the
 * SDR base only — detection lets the admin audit panel honestly tell the
 * photographer when the source carries an HDR layer that we're not yet
 * passing through (WI-09).
 *
 * Two signaling shapes coexist in the wild:
 *
 *   1. Pre-iOS 17 Apple gain maps: the auxiliary item declares item_type
 *      'urim' (URI item) with the URI string
 *      `urn:com:apple:photo:2020:aux:hdrgainmap`.
 *
 *   2. iOS 17+ ISO 21496-1 gain maps: the auxiliary item uses item_type
 *      'tmap' (the ISO HEIF tone map representation) and an `auxl` item
 *      reference points the primary image at it.
 *
 * Adobe Lightroom HDR export and Pixel Camera also emit gain maps in
 * these shapes — detection is correct for them too.
 *
 * Bounded: max box depth 5, max scan 1 MB, rejects malformed boxes.
 */

const APPLE_GAIN_MAP_URI = 'urn:com:apple:photo:2020:aux:hdrgainmap';
const MAX_DEPTH = 5;
const MAX_SCAN_BYTES = 1024 * 1024;

interface InfeEntry {
    itemId: number;
    itemType: string; // FOURCC, e.g. 'urim', 'tmap', 'hvc1'
    itemUri: string | null;
}

interface IrefEntry {
    referenceType: string; // FOURCC, e.g. 'auxl', 'thmb'
    fromItemId: number;
    toItemIds: number[];
}

/**
 * Walk an ISOBMFF buffer looking for evidence of a gain map auxiliary item.
 *
 * The two heuristics are evaluated together (logical OR):
 *
 *   - Any infe declares item_type == 'urim' with an item_uri matching the
 *     Apple HDR gain map URI, OR item_type == 'tmap'.
 *   - Any iref entry of type 'auxl' references an item whose infe declared
 *     item_type 'urim' or 'tmap'.
 *
 * Returns true on the first match. Returns false on any malformed box,
 * truncated buffer, or empty container.
 */
export function hasGainMap(buffer: Buffer): boolean {
    if (!buffer || buffer.length < 8) return false;

    const infeEntries: InfeEntry[] = [];
    const irefEntries: IrefEntry[] = [];

    function readBoxHeader(pos: number): { size: number; type: string; headerSize: number; dataStart: number } | null {
        if (pos + 8 > buffer.length) return null;
        let size = buffer.readUInt32BE(pos);
        const type = buffer.toString('ascii', pos + 4, pos + 8);
        let headerSize = 8;
        let dataStart = pos + 8;

        if (size === 1) {
            if (pos + 16 > buffer.length) return null;
            size = Number(buffer.readBigUInt64BE(pos + 8));
            headerSize = 16;
            dataStart = pos + 16;
        } else if (size === 0) {
            size = buffer.length - pos;
        }

        if (size < headerSize || pos + size > buffer.length) return null;
        return { size, type, headerSize, dataStart };
    }

    function readNullTerminatedAscii(start: number, end: number): string {
        const limit = Math.min(end, buffer.length);
        let p = start;
        while (p < limit && buffer[p] !== 0) p++;
        if (p > limit) return '';
        return buffer.toString('ascii', start, p);
    }

    /**
     * Parse an `infe` FullBox entry.
     *
     * version 2: item_id (2), item_protection_index (2), item_type (4),
     *            item_name (string, null-terminated), [item_uri (string)
     *            when item_type == 'urim'].
     * version 3: item_id (4), rest as v2.
     *
     * Older versions (0/1) carry MIME / XML hints rather than a FOURCC item
     * type — treat them as opaque (no gain map signal).
     */
    function parseInfe(dataStart: number, dataEnd: number): InfeEntry | null {
        if (dataStart + 4 > dataEnd) return null;
        const version = buffer.readUInt8(dataStart);
        let pos = dataStart + 4; // skip version + flags
        let itemId = 0;
        if (version === 2) {
            if (pos + 2 > dataEnd) return null;
            itemId = buffer.readUInt16BE(pos);
            pos += 2;
        } else if (version === 3) {
            if (pos + 4 > dataEnd) return null;
            itemId = buffer.readUInt32BE(pos);
            pos += 4;
        } else {
            return null;
        }
        // item_protection_index (2)
        if (pos + 2 > dataEnd) return null;
        pos += 2;
        // item_type (4)
        if (pos + 4 > dataEnd) return null;
        const itemType = buffer.toString('ascii', pos, pos + 4);
        pos += 4;
        // item_name (null-terminated string)
        const nameStart = pos;
        while (pos < dataEnd && buffer[pos] !== 0) pos++;
        if (pos >= dataEnd) return { itemId, itemType, itemUri: null };
        pos++; // skip null terminator
        void nameStart;
        // For 'urim' items, item_uri follows the name. COR-R4C14-02: also
        // read a trailing URI for 'tmap' items — heuristic 1 in hasGainMap()
        // promises to flag a tmap that carries the Apple HDR gain-map URN
        // (R5-M3), which was unreachable while the URI was parsed for urim
        // only. ISO 21496-1 tmap items carry no URI in practice, so this
        // changes nothing for real files; it makes the documented intent
        // executable.
        let itemUri: string | null = null;
        if ((itemType === 'urim' || itemType === 'tmap') && pos < dataEnd) {
            itemUri = readNullTerminatedAscii(pos, dataEnd);
        }
        return { itemId, itemType, itemUri };
    }

    /**
     * Parse `iinf` FullBox: entry_count followed by N infe boxes.
     *
     * version 0: entry_count (2). version 1+: entry_count (4).
     */
    function parseIinf(dataStart: number, boxEnd: number): void {
        if (dataStart + 4 > boxEnd) return;
        const version = buffer.readUInt8(dataStart);
        let pos = dataStart + 4;
        let entryCount = 0;
        if (version === 0) {
            if (pos + 2 > boxEnd) return;
            entryCount = buffer.readUInt16BE(pos);
            pos += 2;
        } else {
            if (pos + 4 > boxEnd) return;
            entryCount = buffer.readUInt32BE(pos);
            pos += 4;
        }
        let parsed = 0;
        while (pos + 8 <= boxEnd && parsed < entryCount && parsed < 1024) {
            const header = readBoxHeader(pos);
            if (!header) return;
            if (header.type === 'infe') {
                const entry = parseInfe(header.dataStart, pos + header.size);
                if (entry) infeEntries.push(entry);
            }
            pos += header.size;
            parsed++;
        }
    }

    /**
     * Parse `iref` FullBox: variable-length reference entries.
     *
     * Each entry is an inner Box whose type is the reference type FOURCC
     * (e.g. 'auxl', 'thmb', 'cdsc'). Body: from_item_id, ref_count, and
     * `ref_count` × to_item_id. Item id width depends on the iref version
     * (v0: 16-bit ids, v1+: 32-bit ids).
     */
    function parseIref(dataStart: number, boxEnd: number): void {
        if (dataStart + 4 > boxEnd) return;
        const version = buffer.readUInt8(dataStart);
        const idSize = version === 0 ? 2 : 4;
        let pos = dataStart + 4;
        let parsed = 0;
        while (pos + 8 <= boxEnd && parsed < 1024) {
            const header = readBoxHeader(pos);
            if (!header) return;
            const innerEnd = pos + header.size;
            let inner = header.dataStart;
            if (inner + idSize + 2 > innerEnd) {
                pos = innerEnd;
                parsed++;
                continue;
            }
            const fromItemId = idSize === 2 ? buffer.readUInt16BE(inner) : buffer.readUInt32BE(inner);
            inner += idSize;
            const refCount = buffer.readUInt16BE(inner);
            inner += 2;
            const toItemIds: number[] = [];
            for (let i = 0; i < refCount && i < 1024; i++) {
                if (inner + idSize > innerEnd) break;
                const id = idSize === 2 ? buffer.readUInt16BE(inner) : buffer.readUInt32BE(inner);
                toItemIds.push(id);
                inner += idSize;
            }
            irefEntries.push({ referenceType: header.type, fromItemId, toItemIds });
            pos = innerEnd;
            parsed++;
        }
    }

    function walk(offset: number, end: number, depth: number): void {
        if (depth > MAX_DEPTH) return;
        let pos = offset;
        const limit = Math.min(end, offset + MAX_SCAN_BYTES, buffer.length);
        while (pos + 8 <= limit) {
            const header = readBoxHeader(pos);
            if (!header) break;
            const boxEnd = pos + header.size;
            if (header.type === 'meta') {
                // meta is a FullBox — skip version+flags before recursing.
                if (header.dataStart + 4 <= boxEnd) {
                    walk(header.dataStart + 4, boxEnd, depth + 1);
                }
            } else if (header.type === 'iinf') {
                parseIinf(header.dataStart, boxEnd);
            } else if (header.type === 'iref') {
                parseIref(header.dataStart, boxEnd);
            } else if (header.type === 'iprp' || header.type === 'ipco') {
                walk(header.dataStart, boxEnd, depth + 1);
            }
            pos = boxEnd;
        }
    }

    try {
        walk(0, buffer.length, 0);
    } catch {
        // Defensive: corrupt/truncated containers should never throw to the
        // caller. Treat any parse error as "no gain map detected".
        return false;
    }

    // Heuristic 1 — direct detection by item_type / URI on the infe.
    const gainMapItemIds = new Set<number>();
    // R5-M3: standalone `tmap` without an `auxl` reference or Apple URI is
    // ambiguous — ISO 21496-1 defines `tmap` as a generic tone-map item type
    // that future encoders may use for non-HDR purposes. Only flag `tmap`
    // immediately when it carries the Apple HDR gain-map URN; defer all
    // other `tmap` items to heuristic 2 (iref `auxl` check).
    for (const entry of infeEntries) {
        if (entry.itemType === 'tmap') {
            if (entry.itemUri && entry.itemUri.startsWith(APPLE_GAIN_MAP_URI)) {
                gainMapItemIds.add(entry.itemId);
            }
            continue;
        }
        if (entry.itemType === 'urim' && entry.itemUri && entry.itemUri.startsWith(APPLE_GAIN_MAP_URI)) {
            gainMapItemIds.add(entry.itemId);
        }
    }

    if (gainMapItemIds.size > 0) {
        return true;
    }

    // Heuristic 2 — auxl iref pointing at a urim/tmap-typed item we did not
    // catch above (some encoders write the URI on a sibling URI box rather
    // than inline on infe). Build the type lookup once.
    const typeById = new Map<number, string>();
    for (const entry of infeEntries) {
        typeById.set(entry.itemId, entry.itemType);
    }
    for (const ref of irefEntries) {
        if (ref.referenceType !== 'auxl') continue;
        for (const targetId of ref.toItemIds) {
            const targetType = typeById.get(targetId);
            if (targetType === 'urim' || targetType === 'tmap') {
                return true;
            }
        }
    }

    return false;
}
