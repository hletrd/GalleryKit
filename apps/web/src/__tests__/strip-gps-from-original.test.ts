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

    // AGG-C6-01 / AGG-C6-02: the lossless WebP RIFF scrub. These pin the
    // pure scrubber DIRECTLY — the dispatcher-level WebP test above asserts
    // only decoded-pixel equality, which the lossy re-encode FALLBACK also
    // satisfies, so it passed green even while the scrubber returned null on
    // every real WebP (a RIFF field-order inversion: it read [size][tag]
    // instead of the spec's [tag][size]). These tests go RED against that
    // buggy version (stripped:false / null) and GREEN once tag/size are read
    // in the correct order. The VP8 pixel-chunk byte-identity check is what
    // proves the LOSSLESS contract (no re-encode) — exactly what was broken.
    function webpPixelChunk(b: Buffer): Buffer | null {
        let off = 12;
        while (off + 8 <= b.length) {
            const tag = b.toString('ascii', off, off + 4);
            const size = b.readUInt32LE(off + 4);
            if (tag === 'VP8 ' || tag === 'VP8L' || tag === 'VP8X') {
                if (tag !== 'VP8X') return b.subarray(off + 8, off + 8 + size);
            }
            off = off + 8 + size + (size % 2);
        }
        return null;
    }

    it('stripGpsFromWebpBuffer losslessly removes GPS (VP8 pixel chunk byte-identical, EXIF neutralized)', async () => {
        const file = await makeFixture('pure-gps.webp', 'webp', true);
        const input = await fs.readFile(file);
        // Precondition: the fixture really carries GPS in a RIFF EXIF chunk.
        expect(await gpsInFile(file)).not.toBeNull();
        const pixelsBefore = webpPixelChunk(input);
        expect(pixelsBefore).not.toBeNull();

        const result = stripGpsFromWebpBuffer(input);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);

        // Lossless contract: the compressed pixel chunk is byte-identical —
        // i.e. the original was NOT decoded/re-encoded (the whole point of
        // the byte-surgery path). This is the assertion the dispatcher test
        // could not make (it compared decoded pixels, which survive a q95
        // re-encode of an already-q95 decode).
        const pixelsAfter = webpPixelChunk(result!.buffer);
        expect(pixelsAfter).not.toBeNull();
        expect(pixelsAfter!.equals(pixelsBefore!)).toBe(true);

        // GPS is actually gone from the scrubbed EXIF block.
        const parsed = exifReader(
            (await sharp(result!.buffer).metadata()).exif ?? Buffer.alloc(0),
        ) as { GPSInfo?: Record<string, unknown>; gps?: Record<string, unknown> };
        const gps = parsed.GPSInfo ?? parsed.gps ?? null;
        const meaningful = gps ? Object.entries(gps).filter(([, v]) => v != null) : [];
        expect(meaningful.length).toBe(0);
    });

    it('stripGpsFromWebpBuffer reports stripped=false and returns the input reference for GPS-free WebP', async () => {
        const file = await makeFixture('pure-nogps.webp', 'webp', false);
        const input = await fs.readFile(file);
        const result = stripGpsFromWebpBuffer(input);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(false);
        expect(result!.buffer).toBe(input);
    });

    it('stripGpsFromWebpBuffer returns null for non-WebP bytes', () => {
        // 12+ bytes so the length guard is not what trips it — the RIFF/WEBP
        // magic check must reject.
        expect(stripGpsFromWebpBuffer(Buffer.from('not a webp file at all'))).toBeNull();
    });

    // AGG-C6-T1: direct ISOBMFF pure-scrubber test, for symmetry with the WebP
    // and JPEG pure-scrubber tests above. The dispatcher-level AVIF test (further
    // up) is less vacuous than WebP's was (the AVIF re-encode fallback is lossy
    // q90, so it would perturb decoded pixels) — but a DIRECT test that asserts
    // the file LENGTH is unchanged is strictly stronger: it proves the in-place
    // byte-zeroing scrub ran, not a re-encode (which would change the length).
    it('stripGpsFromIsobmffBuffer losslessly removes GPS (in-place, file length unchanged)', async () => {
        const file = await makeFixture('pure-gps.avif', 'avif', true);
        const input = await fs.readFile(file);
        expect(await gpsInFile(file)).not.toBeNull();

        const result = stripGpsFromIsobmffBuffer(input);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
        // In-place GPS zeroing preserves the file length (a re-encode would not).
        expect(result!.buffer.length).toBe(input.length);
        // GPS is actually gone from the scrubbed bytes.
        const scrubbedPath = path.join(tmpDir, 'scrubbed.avif');
        await fs.writeFile(scrubbedPath, result!.buffer);
        expect(await gpsInFile(scrubbedPath)).toBeNull();
    });

    it('stripGpsFromIsobmffBuffer reports stripped=false and returns the input reference for GPS-free AVIF', async () => {
        const file = await makeFixture('pure-nogps.avif', 'avif', false);
        const input = await fs.readFile(file);
        const result = stripGpsFromIsobmffBuffer(input);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(false);
        expect(result!.buffer).toBe(input);
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

    // SEC-R4C9-01 helpers: hand-assemble XMP APP1 segments per the XMP
    // Specification Part 3 §1.1.3.1 layouts.
    const app1 = (payload: Buffer): Buffer => {
        const segment = Buffer.alloc(4 + payload.length);
        segment[0] = 0xff;
        segment[1] = 0xe1;
        segment.writeUInt16BE(2 + payload.length, 2);
        payload.copy(segment, 4);
        return segment;
    };
    const stdXmpSegment = (xml: string): Buffer =>
        app1(Buffer.from(`http://ns.adobe.com/xap/1.0/\0${xml}`, 'latin1'));
    const extXmpSegment = (fullLength: number, offset: number, data: string): Buffer => {
        const u32 = (n: number) => {
            const b = Buffer.alloc(4);
            b.writeUInt32BE(n, 0);
            return b;
        };
        return app1(Buffer.concat([
            Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1'),
            Buffer.from('A'.repeat(32), 'latin1'), // 32-byte GUID
            u32(fullLength),
            u32(offset),
            Buffer.from(data, 'latin1'),
        ]));
    };

    it('SEC-R4C9-01: drops ExtendedXMP segments whose overflow chunk carries the GPS markers', async () => {
        const file = await makeFixture('ext-xmp.jpg', 'jpeg', false);
        const original = await fs.readFile(file);
        // Standard packet carries ONLY the HasExtendedXMP pointer — the GPS
        // properties overflowed into the extension (the empirically proven
        // leak shape from the cycle-9 review).
        const std = stdXmpSegment('<x:xmpmeta xmlns:xmpNote="http://ns.adobe.com/xmp/note/"><rdf:Description xmpNote:HasExtendedXMP="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"/></x:xmpmeta>');
        const extData = '<rdf:Description exif:GPSLatitude="37,33.98N" exif:GPSLongitude="126,58.94E"/>';
        const ext = extXmpSegment(extData.length, 0, extData);
        const withXmp = Buffer.concat([original.subarray(0, 2), std, ext, original.subarray(2)]);

        const result = stripGpsFromJpegBuffer(withXmp);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
        expect(result!.buffer.includes(Buffer.from('GPSLatitude', 'latin1'))).toBe(false);
        // BOTH XMP signatures must be gone (std + extension dropped together).
        expect(result!.buffer.includes(Buffer.from('http://ns.adobe.com/xap/1.0/', 'latin1'))).toBe(false);
        expect(result!.buffer.includes(Buffer.from('http://ns.adobe.com/xmp/extension/', 'latin1'))).toBe(false);
        // Output decodes to the same pixels.
        const pixelsBefore = await sharp(original).raw().toBuffer();
        const pixelsAfter = await sharp(result!.buffer).raw().toBuffer();
        expect(pixelsAfter.equals(pixelsBefore)).toBe(true);
    });

    it('SEC-R4C9-01: catches a GPS token split across two ExtendedXMP chunk boundaries', async () => {
        const file = await makeFixture('ext-xmp-split.jpg', 'jpeg', false);
        const original = await fs.readFile(file);
        const part1 = '<rdf:Description exif:GPSLat';
        const part2 = 'itude="37,33.98N"/>';
        const fullLength = part1.length + part2.length;
        // Splice in REVERSE declared-offset order so the reconstruction's
        // offset sort is exercised (file order alone would not match).
        const extB = extXmpSegment(fullLength, part1.length, part2);
        const extA = extXmpSegment(fullLength, 0, part1);
        const withXmp = Buffer.concat([original.subarray(0, 2), extB, extA, original.subarray(2)]);

        const result = stripGpsFromJpegBuffer(withXmp);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
        expect(result!.buffer.includes(Buffer.from('http://ns.adobe.com/xmp/extension/', 'latin1'))).toBe(false);
    });

    it('SEC-R4C9-01: leaves a GPS-free ExtendedXMP JPEG byte-identical (stripped=false, same reference)', async () => {
        const file = await makeFixture('ext-xmp-clean.jpg', 'jpeg', false);
        const original = await fs.readFile(file);
        const std = stdXmpSegment('<x:xmpmeta xmlns:xmpNote="http://ns.adobe.com/xmp/note/"><rdf:Description xmpNote:HasExtendedXMP="BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"/></x:xmpmeta>');
        const extData = '<rdf:Description xmp:Rating="5" dc:title="harbor at dusk"/>';
        const ext = extXmpSegment(extData.length, 0, extData);
        const withXmp = Buffer.concat([original.subarray(0, 2), std, ext, original.subarray(2)]);

        const result = stripGpsFromJpegBuffer(withXmp);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(false);
        expect(result!.buffer).toBe(withXmp);
    });

    it('SEC-R4C10-01: returns null for a JPEG with a GPS-bearing post-EOI trailer (forces re-encode)', async () => {
        // A motion-photo / MPF JPEG = [primary still][second full JPEG].
        // Build both with GPS EXIF; the primary scrub alone would leave the
        // trailer's coordinates intact, so the lossless path must bail to the
        // re-encode fallback (null) which decodes only the primary still.
        const primaryFile = await makeFixture('trailer-primary.jpg', 'jpeg', true);
        const trailerFile = await makeFixture('trailer-secondary.jpg', 'jpeg', true);
        const primary = await fs.readFile(primaryFile);
        const trailer = await fs.readFile(trailerFile);
        // Sanity: the trailer really carries GPS before scrubbing (binary
        // EXIF GPS IFD, read via exif-reader — NOT an ASCII string scan).
        expect(await gpsInFile(trailerFile)).not.toBeNull();
        const motionPhoto = Buffer.concat([primary, trailer]);

        const result = stripGpsFromJpegBuffer(motionPhoto);
        // Proven-failing-before: the old walker returned { stripped: true }
        // with the trailer GPS surviving. The fix returns null so
        // stripGpsFromOriginal re-encodes (trailer dropped entirely).
        expect(result).toBeNull();
    });

    it('SEC-R4C10-01: returns null for a JPEG with a trailer even when neither image carries GPS', async () => {
        // The lossless path cannot certify a trailer is GPS-free (the
        // secondary's EXIF GPS is binary), so ANY non-trivial trailer routes
        // to the safe re-encode. Privacy-correct trade for a narrow slice of
        // uploads when strip_gps_on_upload is ON.
        const primaryFile = await makeFixture('trailer-clean-primary.jpg', 'jpeg', false);
        const trailerFile = await makeFixture('trailer-clean-secondary.jpg', 'jpeg', false);
        const primary = await fs.readFile(primaryFile);
        const trailer = await fs.readFile(trailerFile);
        const concatenated = Buffer.concat([primary, trailer]);

        expect(stripGpsFromJpegBuffer(concatenated)).toBeNull();
    });

    it('SEC-R4C10-01: a single-image JPEG with no trailer is unaffected (lossless tier-1 preserved)', async () => {
        // Regression guard: the trailer check must not false-positive on a
        // normal single-image GPS JPEG — it still scrubs losslessly.
        const file = await makeFixture('single-image-gps.jpg', 'jpeg', true);
        const input = await fs.readFile(file);
        const result = stripGpsFromJpegBuffer(input);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
        // Decodes to the same pixels (lossless byte surgery, not a re-encode).
        const pixelsBefore = await sharp(input).raw().toBuffer();
        const pixelsAfter = await sharp(result!.buffer).raw().toBuffer();
        expect(pixelsAfter.equals(pixelsBefore)).toBe(true);
        // And the GPS is gone.
        expect(await gpsInFile(file)).not.toBeNull(); // fixture had GPS
        const outPath = path.join(tmpDir, 'single-image-gps.out.jpg');
        await fs.writeFile(outPath, result!.buffer);
        expect(await gpsInFile(outPath)).toBeNull();
    });

    it('SEC-R4C10-01: tolerates a couple of trailing padding bytes after EOI', async () => {
        // Some encoders emit 1-2 trailing bytes after the final EOI; these
        // must NOT trip the trailer guard (no leak risk from <=2 bytes).
        const file = await makeFixture('padded-eoi-gps.jpg', 'jpeg', true);
        const input = await fs.readFile(file);
        const padded = Buffer.concat([input, Buffer.from([0x00, 0x00])]);
        const result = stripGpsFromJpegBuffer(padded);
        expect(result).not.toBeNull();
        expect(result!.stripped).toBe(true);
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
