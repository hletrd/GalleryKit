import { describe, expect, it } from 'vitest';

import { extractExifForDb, extractIccProfileName } from '@/lib/process-image';

function makeMlucIcc(text: string) {
    const dataOffset = 144;
    const recordSize = 12;
    const textOffset = 16 + recordSize;
    const encoded = utf16beFull(text);
    const dataSize = textOffset + encoded.length;
    const buffer = Buffer.alloc(dataOffset + dataSize);

    buffer.writeUInt32BE(1, 128);
    buffer.write('desc', 132, 'ascii');
    buffer.writeUInt32BE(dataOffset, 136);
    buffer.writeUInt32BE(dataSize, 140);

    buffer.write('mluc', dataOffset, 'ascii');
    buffer.writeUInt32BE(0, dataOffset + 4);
    buffer.writeUInt32BE(1, dataOffset + 8);
    buffer.writeUInt32BE(recordSize, dataOffset + 12);
    buffer.write('en', dataOffset + 16, 'ascii');
    buffer.write('US', dataOffset + 18, 'ascii');
    buffer.writeUInt32BE(encoded.length, dataOffset + 20);
    buffer.writeUInt32BE(textOffset, dataOffset + 24);
    encoded.copy(buffer, dataOffset + textOffset);

    return buffer;
}

/**
 * Build a multi-record `mluc` ICC fixture (P4-E1).
 * Each entry contributes one record: lang/country code + UTF-16BE text.
 */
function makeMultiLocaleMlucIcc(entries: { lang: string; country: string; text: string }[]) {
    const dataOffset = 144;
    const recordSize = 12;
    const numRecords = entries.length;
    // All record headers come first, then text payloads.
    const headerEnd = 16 + recordSize * numRecords;
    const encodedTexts = entries.map((e) => utf16beFull(e.text));
    const totalTextBytes = encodedTexts.reduce((sum, e) => sum + e.length, 0);
    const dataSize = headerEnd + totalTextBytes;
    const buffer = Buffer.alloc(dataOffset + dataSize);

    buffer.writeUInt32BE(1, 128);
    buffer.write('desc', 132, 'ascii');
    buffer.writeUInt32BE(dataOffset, 136);
    buffer.writeUInt32BE(dataSize, 140);

    buffer.write('mluc', dataOffset, 'ascii');
    buffer.writeUInt32BE(0, dataOffset + 4);
    buffer.writeUInt32BE(numRecords, dataOffset + 8);
    buffer.writeUInt32BE(recordSize, dataOffset + 12);

    let textCursor = headerEnd;
    for (let i = 0; i < numRecords; i++) {
        const entry = entries[i];
        const encoded = encodedTexts[i];
        const recOffset = dataOffset + 16 + i * recordSize;
        buffer.write(entry.lang, recOffset, 'ascii');
        buffer.write(entry.country, recOffset + 2, 'ascii');
        buffer.writeUInt32BE(encoded.length, recOffset + 4);
        buffer.writeUInt32BE(textCursor, recOffset + 8);
        encoded.copy(buffer, dataOffset + textCursor);
        textCursor += encoded.length;
    }

    return buffer;
}

/**
 * Encode a string as UTF-16BE, properly handling supplementary characters
 * (code points > 0xFFFF) by encoding them as surrogate pairs.
 */
function utf16beFull(text: string) {
    const codeUnits: number[] = [];
    for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        if (cp > 0xffff) {
            // Supplementary character: encode as surrogate pair
            const hi = Math.floor((cp - 0x10000) / 0x400) + 0xd800;
            const lo = ((cp - 0x10000) % 0x400) + 0xdc00;
            codeUnits.push(hi, lo);
        } else {
            codeUnits.push(cp);
        }
    }
    const buffer = Buffer.alloc(codeUnits.length * 2);
    for (let i = 0; i < codeUnits.length; i++) {
        buffer.writeUInt16BE(codeUnits[i], i * 2);
    }
    return buffer;
}

describe('process-image metadata normalization', () => {
    it('decodes ICC mluc profile names as UTF-16BE', () => {
        expect(extractIccProfileName(makeMlucIcc('Display P3'))).toBe('Display P3');
    });

    it('byte-bounds ICC profile names before DB insertion', () => {
        const name = '프로파일'.repeat(100);
        const extracted = extractIccProfileName(makeMlucIcc(name));

        expect(extracted).toBeTruthy();
        expect(Buffer.byteLength(extracted!, 'utf8')).toBeLessThanOrEqual(255);
    });

    it('decodes UTF-16BE with supplementary characters (C3-AGG-02)', () => {
        // U+1F600 (😀) encoded as UTF-16BE surrogate pair: D83D DE00
        const emoji = '\u{1F600}';
        const result = extractIccProfileName(makeMlucIcc(emoji));
        expect(result).toBe(emoji);
    });

    it('decodes UTF-16BE with mixed BMP and supplementary characters (C3-AGG-07)', () => {
        const mixed = 'A\u{1F600}Z';
        const result = extractIccProfileName(makeMlucIcc(mixed));
        expect(result).toBe(mixed);
    });

    // P4-E1 / LATENT-L1: mluc locale-matched record selection.
    it('returns the Korean record when locale="ko" is requested (P4-E1)', () => {
        const icc = makeMultiLocaleMlucIcc([
            { lang: 'en', country: 'US', text: 'Display P3' },
            { lang: 'ko', country: 'KR', text: 'Display P3 한국어' },
            { lang: 'ja', country: 'JP', text: 'Display P3 日本語' },
        ]);
        expect(extractIccProfileName(icc, 'ko')).toBe('Display P3 한국어');
    });

    it('returns the English record when locale="en" is requested (P4-E1)', () => {
        const icc = makeMultiLocaleMlucIcc([
            { lang: 'ko', country: 'KR', text: 'Display P3 한국어' },
            { lang: 'en', country: 'US', text: 'Display P3' },
            { lang: 'ja', country: 'JP', text: 'Display P3 日本語' },
        ]);
        expect(extractIccProfileName(icc, 'en')).toBe('Display P3');
    });

    it('falls back to the first non-empty record when no locale matches (P4-E1)', () => {
        const icc = makeMultiLocaleMlucIcc([
            { lang: 'ko', country: 'KR', text: 'Display P3 한국어' },
            { lang: 'en', country: 'US', text: 'Display P3' },
        ]);
        expect(extractIccProfileName(icc, 'fr')).toBe('Display P3 한국어');
    });

    it('preserves single-record behavior when no locale is requested (P4-E1)', () => {
        const icc = makeMlucIcc('Display P3');
        // No locale arg → first non-empty (existing behavior).
        expect(extractIccProfileName(icc)).toBe('Display P3');
    });

    it('byte-bounds EXIF strings before DB insertion', () => {
        const exif = extractExifForDb({
            image: {
                Model: '📷'.repeat(100),
            },
        });

        expect(exif.camera_model).toBeTruthy();
        expect(Buffer.byteLength(exif.camera_model!, 'utf8')).toBeLessThanOrEqual(255);
        expect(exif.camera_model).not.toContain('�');
    });

    // R15C15 DBG-15-01: a `0/0` GPS rational decodes (via exif-reader's rational
    // division) to NaN. The `<`/`>` range guard is all-false for NaN, so without
    // the finite-check NaN reaches the DB insert as a bare `NaN` token →
    // ER_BAD_FIELD_ERROR → the valid photo is silently rejected at upload.
    it('returns NULL coordinates for NaN GPS rationals (no NaN in DB insert)', () => {
        const exif = extractExifForDb({
            gps: {
                GPSLatitude: [NaN, 30, 0],
                GPSLatitudeRef: 'N',
                GPSLongitude: [10, NaN, 0],
                GPSLongitudeRef: 'E',
            },
        });

        expect(exif.latitude).toBeNull();
        expect(exif.longitude).toBeNull();
    });

    it('keeps valid GPS coordinates intact', () => {
        const exif = extractExifForDb({
            gps: {
                GPSLatitude: [37, 30, 0],
                GPSLatitudeRef: 'N',
                GPSLongitude: [127, 0, 0],
                GPSLongitudeRef: 'E',
            },
        });

        expect(exif.latitude).toBeCloseTo(37.5, 4);
        expect(exif.longitude).toBeCloseTo(127, 4);
    });
});
