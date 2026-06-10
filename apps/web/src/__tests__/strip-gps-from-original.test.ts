import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { stripGpsFromOriginal } from '@/lib/process-image';
import {
    stripGpsFromJpegBuffer,
    stripGpsFromTiffBuffer,
    stripGpsFromIsobmffBuffer,
    stripGpsFromWebpBuffer,
} from '@/lib/gps-exif-strip';

/**
 * R4C8 COR-R4C8-01 behavioral coverage.
 *
 * The prior implementation used Sharp's `withMetadata({orientation,icc})`,
 * which KEEPS all input EXIF in Sharp 0.33+ — the GPS IFD survived the
 * "strip" byte-for-byte AND the original was re-encoded at default
 * quality. The derivative-focused suite (process-image-exif-strip)
 * never exercised the ORIGINAL path, which is how the defect survived.
 * These tests run the real function against GPS-tagged fixtures.
 */

const GPS_EXIF = {
    IFD0: { Make: 'TestCam', Model: 'X100' },
    IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '37/1 33/1 59/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '126/1 58/1 41/1',
    },
} as const;

let tmpDir: string;

function readGps(exifBuf: Buffer | undefined): Record<string, unknown> | null {
    if (!exifBuf) return null;
    const parsed = exifReader(exifBuf) as { GPSInfo?: Record<string, unknown>; gps?: Record<string, unknown> };
    const gps = parsed.GPSInfo ?? parsed.gps ?? null;
    if (!gps) return null;
    // exif-reader may surface an empty object for a zero-entry GPS IFD.
    const meaningful = Object.entries(gps).filter(([, v]) => v !== undefined && v !== null);
    return meaningful.length > 0 ? Object.fromEntries(meaningful) : null;
}

async function gpsInFile(filePath: string): Promise<Record<string, unknown> | null> {
    const meta = await sharp(filePath).metadata();
    return readGps(meta.exif);
}

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gps-strip-test-'));
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

async function makeFixture(name: string, format: 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff', withGps = true): Promise<string> {
    const filePath = path.join(tmpDir, name);
    let pipeline = sharp({
        create: { width: 64, height: 48, channels: 3, background: { r: 40, g: 90, b: 160 } },
    });
    if (withGps) {
        pipeline = pipeline.withExif(GPS_EXIF as unknown as Record<string, Record<string, string>>);
    }
    if (format === 'jpeg') await pipeline.jpeg({ quality: 95 }).toFile(filePath);
    else if (format === 'png') await pipeline.png().toFile(filePath);
    else if (format === 'webp') await pipeline.webp({ quality: 95 }).toFile(filePath);
    else if (format === 'avif') await pipeline.avif({ quality: 60 }).toFile(filePath);
    else await pipeline.tiff({ compression: 'lzw' }).toFile(filePath);
    return filePath;
}

describe('stripGpsFromOriginal (R4C8 COR-R4C8-01)', () => {
    it('removes GPS from a JPEG original losslessly (pixels byte-identical, camera EXIF retained)', async () => {
        const file = await makeFixture('gps.jpg', 'jpeg');
        expect(await gpsInFile(file)).not.toBeNull(); // fixture sanity

        const pixelsBefore = await sharp(file).raw().toBuffer();

        await stripGpsFromOriginal(file);

        expect(await gpsInFile(file)).toBeNull();
        const meta = await sharp(file).metadata();
        const parsed = exifReader(meta.exif!) as { Image?: { Make?: string; Model?: string } };
        expect(parsed.Image?.Make).toBe('TestCam'); // non-GPS EXIF survives
        expect(parsed.Image?.Model).toBe('X100');

        const pixelsAfter = await sharp(file).raw().toBuffer();
        expect(pixelsAfter.equals(pixelsBefore)).toBe(true); // no re-encode
    });

    it('leaves a GPS-free JPEG byte-identical (no rewrite at all)', async () => {
        const file = await makeFixture('nogps.jpg', 'jpeg', false);
        const before = await fs.readFile(file);
        await stripGpsFromOriginal(file);
        const after = await fs.readFile(file);
        expect(after.equals(before)).toBe(true);
    });

    it('removes GPS from an AVIF original via the ISOBMFF scrub (pixels byte-identical)', async () => {
        const file = await makeFixture('gps.avif', 'avif');
        expect(await gpsInFile(file)).not.toBeNull();
        const pixelsBefore = await sharp(file).raw().toBuffer();

        await stripGpsFromOriginal(file);

        expect(await gpsInFile(file)).toBeNull();
        const pixelsAfter = await sharp(file).raw().toBuffer();
        expect(pixelsAfter.equals(pixelsBefore)).toBe(true);
    });

    it('removes GPS from a WebP original via the RIFF scrub (pixels byte-identical)', async () => {
        const file = await makeFixture('gps.webp', 'webp');
        expect(await gpsInFile(file)).not.toBeNull();
        const pixelsBefore = await sharp(file).raw().toBuffer();

        await stripGpsFromOriginal(file);

        expect(await gpsInFile(file)).toBeNull();
        const pixelsAfter = await sharp(file).raw().toBuffer();
        expect(pixelsAfter.equals(pixelsBefore)).toBe(true);
    });

    it('leaves a GPS-free TIFF byte-identical (no rewrite)', async () => {
        // Sharp's withExif does not propagate a GPS IFD into TIFF output,
        // so the GPS-bearing TIFF walk is covered at the unit level below
        // (stripGpsFromTiffBuffer on a real EXIF TIFF block). This test
        // pins the file-level no-GPS identity contract for .tif paths.
        const file = await makeFixture('nogps.tif', 'tiff', false);
        const before = await fs.readFile(file);
        await stripGpsFromOriginal(file);
        const after = await fs.readFile(file);
        expect(after.equals(before)).toBe(true);
    });

    it('strips a PNG original through the re-encode tier (pixel-lossless)', async () => {
        const file = await makeFixture('img.png', 'png');
        const pixelsBefore = await sharp(file).raw().toBuffer();

        await stripGpsFromOriginal(file);

        expect(await gpsInFile(file)).toBeNull();
        const pixelsAfter = await sharp(file).raw().toBuffer();
        expect(pixelsAfter.equals(pixelsBefore)).toBe(true);
    });

    it('falls back to re-encode when the JPEG structure defeats the scrubber, still removing GPS', async () => {
        const file = await makeFixture('weird.jpg', 'jpeg');
        // Corrupt the APP1 EXIF segment signature so the lossless scrubber
        // cannot certify the structure (returns null) while Sharp can
        // still decode the image — Tier 2 must take over.
        const bytes = await fs.readFile(file);
        const sigIndex = bytes.indexOf(Buffer.from('Exif\0\0', 'latin1'));
        expect(sigIndex).toBeGreaterThan(0);
        // Truncate the declared APP1 segment length to an impossible value.
        bytes.writeUInt16BE(1, sigIndex - 2);
        await fs.writeFile(file, bytes);

        await stripGpsFromOriginal(file);

        expect(await gpsInFile(file)).toBeNull();
    });

    it('never throws on an unreadable path (best-effort contract)', async () => {
        await expect(
            stripGpsFromOriginal(path.join(tmpDir, 'does-not-exist.jpg')),
        ).resolves.toBeUndefined();
    });
});

describe('gps-exif-strip pure scrubbers', () => {
    it('stripGpsFromJpegBuffer reports stripped=false and returns the input reference for GPS-free files', async () => {
        const file = await makeFixture('pure-nogps.jpg', 'jpeg', false);
        const input = await fs.readFile(file);
        const result = stripGpsFromJpegBuffer(input);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(false);
        expect(result!.buffer).toBe(input);
    });

    it('stripGpsFromJpegBuffer returns null for non-JPEG bytes', () => {
        expect(stripGpsFromJpegBuffer(Buffer.from('not a jpeg'))).toBeNull();
    });

    it('stripGpsFromJpegBuffer drops GPS-bearing XMP APP1 segments', async () => {
        const file = await makeFixture('xmp.jpg', 'jpeg', false);
        const original = await fs.readFile(file);
        // Hand-assemble an XMP APP1 segment carrying a GPS marker and
        // splice it right after SOI.
        const xmpPayload = Buffer.from(
            'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:Description exif:GPSLatitude="37,33.98N"/></x:xmpmeta>',
            'latin1',
        );
        const segment = Buffer.alloc(4 + xmpPayload.length);
        segment[0] = 0xff;
        segment[1] = 0xe1;
        segment.writeUInt16BE(2 + xmpPayload.length, 2);
        xmpPayload.copy(segment, 4);
        const withXmp = Buffer.concat([original.subarray(0, 2), segment, original.subarray(2)]);

        const result = stripGpsFromJpegBuffer(withXmp);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
        expect(result!.buffer.includes(Buffer.from('GPSLatitude', 'latin1'))).toBe(false);
        // Output decodes to the same pixels.
        const pixelsBefore = await sharp(original).raw().toBuffer();
        const pixelsAfter = await sharp(result!.buffer).raw().toBuffer();
        expect(pixelsAfter.equals(pixelsBefore)).toBe(true);
    });

    it('stripGpsFromTiffBuffer zeroes the GPS IFD of a real EXIF TIFF block', async () => {
        // The APP1 payload of a GPS-tagged JPEG (after "Exif\0\0") IS a
        // TIFF block — extract it and run the whole-file TIFF scrubber on
        // it, which is exactly what the .tif path executes.
        const file = await makeFixture('tiff-block-src.jpg', 'jpeg');
        const jpeg = await fs.readFile(file);
        const sig = jpeg.indexOf(Buffer.from('Exif\0\0', 'latin1'));
        expect(sig).toBeGreaterThan(0);
        const segLength = jpeg.readUInt16BE(sig - 2);
        const tiffBlock = Buffer.from(jpeg.subarray(sig + 6, sig - 2 + segLength));
        expect(readGps(tiffBlock)).not.toBeNull(); // sanity: block carries GPS

        const result = stripGpsFromTiffBuffer(tiffBlock);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
        expect(readGps(result!.buffer)).toBeNull();
    });

    it('stripGpsFromTiffBuffer / stripGpsFromIsobmffBuffer / stripGpsFromWebpBuffer reject garbage', () => {
        const garbage = Buffer.from('garbage-bytes-not-a-container');
        expect(stripGpsFromTiffBuffer(garbage)).toBeNull();
        expect(stripGpsFromIsobmffBuffer(garbage)).toBeNull();
        expect(stripGpsFromWebpBuffer(garbage)).toBeNull();
    });

    it('zeroes the coordinate bytes themselves (no forensic residue) in the JPEG path', async () => {
        const file = await makeFixture('residue.jpg', 'jpeg');
        const input = await fs.readFile(file);
        const result = stripGpsFromJpegBuffer(input);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
        // The rational 37/1 latitude degree value (LE or BE 32-bit 37
        // followed by 1) must not survive anywhere in the APP1 region.
        const exifSig = result!.buffer.indexOf(Buffer.from('Exif\0\0', 'latin1'));
        expect(exifSig).toBeGreaterThan(0);
        const segLength = result!.buffer.readUInt16BE(exifSig - 2);
        const app1 = result!.buffer.subarray(exifSig, exifSig - 2 + segLength);
        const deg37LE = Buffer.from([37, 0, 0, 0, 1, 0, 0, 0]);
        const deg37BE = Buffer.from([0, 0, 0, 37, 0, 0, 0, 1]);
        expect(app1.includes(deg37LE)).toBe(false);
        expect(app1.includes(deg37BE)).toBe(false);
    });
});
