import { describe, expect, it } from 'vitest';

import { extractExifForDb, extractIccProfileName } from '@/lib/process-image';

function utf16be(text: string) {
    const buffer = Buffer.alloc(text.length * 2);
    for (let i = 0; i < text.length; i++) {
        buffer.writeUInt16BE(text.charCodeAt(i), i * 2);
    }
    return buffer;
}

function makeMlucIcc(text: string) {
    const dataOffset = 144;
    const recordSize = 12;
    const textOffset = 16 + recordSize;
    const encoded = utf16be(text);
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
