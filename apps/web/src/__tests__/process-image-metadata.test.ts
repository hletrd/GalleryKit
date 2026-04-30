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
});
