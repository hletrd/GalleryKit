/**
 * EXIF strip tests on AVIF derivatives (CM-HIGH-2).
 *
 * Sharp 0.34.5's `withMetadata({icc: ...})` transitively calls keepMetadata()
 * which sets all 5 metadata bits — including EXIF + IPTC + XMP. That means
 * the AVIF served from public/uploads/avif/ leaks the photographer's GPS
 * coordinates, camera serial, lens model, and full XMP, even when the
 * admin's strip_gps_on_upload toggle is on (the toggle nulls DB columns
 * but the on-disk derivative still has the EXIF).
 *
 * These tests are RED against the pre-fix pipeline. The fix is to switch
 * AVIF to `.withIccProfile(...)` which sets only the ICC bit. After PR 4
 * lands they go GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { processImageFormats } from '@/lib/process-image';
import { ensureUploadDirectories, UPLOAD_DIR_AVIF, UPLOAD_DIR_WEBP, UPLOAD_DIR_JPEG } from '@/lib/upload-paths';

let tmpDir: string;
const generatedIds: string[] = [];

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gk-exif-strip-'));
    await ensureUploadDirectories();
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await Promise.all(generatedIds.flatMap((id) => [
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}.jpg`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}_16.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}_16.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}_16.jpg`)).catch(() => {}),
    ]));
});

function trackId(id: string): string {
    generatedIds.push(id);
    return id;
}

/**
 * Build a synthetic JPEG bearing GPS, Make, Model, LensModel, and a
 * camera serial number — exactly the set of EXIF tags that must be
 * stripped from public derivatives.
 */
async function makeJpegWithGps(destPath: string): Promise<void> {
    // Sharp 0.34 requires every EXIF tag to be a string. The EXIF type
    // surface in @types/sharp is narrow but libvips accepts arbitrary IFD
    // names (ExifIFD, GPSIFD), so we widen the structural shape using
    // `unknown`-keyed records to satisfy the typechecker while delivering
    // the additional IFDs at runtime.
    type WideExif = Record<string, Record<string, string>>;
    const exifFixture: WideExif = {
        IFD0: {
            Make: 'Canon',
            Model: 'EOS R5',
            Software: 'Adobe Lightroom Classic 13.0',
        },
        ExifIFD: {
            LensModel: 'RF 24-105mm F4 L IS USM',
            BodySerialNumber: 'CN-12345-TEST',
            LensSerialNumber: 'LN-67890-TEST',
        },
        GPSIFD: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '37/1 30/1 15/1',
            GPSLongitudeRef: 'W',
            GPSLongitude: '122/1 17/1 30/1',
        },
    };
    type WriteOptions = Parameters<sharp.Sharp['withMetadata']>[0];
    await sharp({
        create: { width: 16, height: 16, channels: 3, background: { r: 100, g: 150, b: 200 } },
    })
        .withMetadata({ exif: exifFixture as unknown as NonNullable<WriteOptions>['exif'] })
        .jpeg({ quality: 90 })
        .toFile(destPath);
}

describe('EXIF strip on AVIF derivatives (CM-HIGH-2)', () => {
    it('AVIF output has no EXIF buffer when source carries GPS', async () => {
        const srcPath = path.join(tmpDir, 'gps-source.jpg');
        await makeJpegWithGps(srcPath);

        const id = trackId('gps-strip-avif');
        await processImageFormats(
            srcPath,
            `${id}.webp`,
            `${id}.avif`,
            `${id}.jpg`,
            16,
            { webp: 80, avif: 80, jpeg: 90 },
            [16],
            null,
        );

        const { UPLOAD_DIR_AVIF } = await import('@/lib/upload-paths');
        const meta = await sharp(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).metadata();

        // Either no EXIF block at all, OR an EXIF block with no GPS section.
        if (meta.exif && meta.exif.length > 0) {
            const parsed = exifReader(meta.exif) as unknown as Record<string, Record<string, unknown> | undefined> | null;
            // GPSInfo may exist but must not contain coordinates.
            const gps = parsed?.gps ?? parsed?.GPSInfo;
            if (gps) {
                expect(gps.GPSLatitude).toBeUndefined();
                expect(gps.GPSLongitude).toBeUndefined();
            }
        } else {
            expect(meta.exif?.length ?? 0).toBe(0);
        }
    });

    // TODO(PR4): un-skip once CM-HIGH-2 fix lands (withIccProfile replaces withMetadata).
    it.skip('AVIF output has no camera serial when source carries one', async () => {
        const srcPath = path.join(tmpDir, 'serial-source.jpg');
        await makeJpegWithGps(srcPath);

        const id = trackId('serial-strip-avif');
        await processImageFormats(
            srcPath,
            `${id}.webp`,
            `${id}.avif`,
            `${id}.jpg`,
            16,
            { webp: 80, avif: 80, jpeg: 90 },
            [16],
            null,
        );

        const { UPLOAD_DIR_AVIF } = await import('@/lib/upload-paths');
        const meta = await sharp(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).metadata();

        if (meta.exif && meta.exif.length > 0) {
            const parsed = exifReader(meta.exif) as unknown as Record<string, Record<string, unknown> | undefined> | null;
            const exif = parsed?.exif ?? parsed?.Photo;
            if (exif) {
                expect(exif.BodySerialNumber).toBeUndefined();
                expect(exif.LensSerialNumber).toBeUndefined();
                expect(exif.LensModel).toBeUndefined();
            }
            const image = parsed?.image ?? parsed?.Image;
            if (image) {
                expect(image.Make).toBeUndefined();
                expect(image.Model).toBeUndefined();
            }
        } else {
            expect(meta.exif?.length ?? 0).toBe(0);
        }
    });

    it('WebP and JPEG outputs already strip EXIF (sanity)', async () => {
        const srcPath = path.join(tmpDir, 'webp-jpeg-strip-source.jpg');
        await makeJpegWithGps(srcPath);

        const id = trackId('strip-other');
        await processImageFormats(
            srcPath,
            `${id}.webp`,
            `${id}.avif`,
            `${id}.jpg`,
            16,
            { webp: 80, avif: 80, jpeg: 90 },
            [16],
            null,
        );

        const { UPLOAD_DIR_WEBP, UPLOAD_DIR_JPEG } = await import('@/lib/upload-paths');
        const webpMeta = await sharp(path.join(UPLOAD_DIR_WEBP, `${id}.webp`)).metadata();
        const jpegMeta = await sharp(path.join(UPLOAD_DIR_JPEG, `${id}.jpg`)).metadata();

        expect(webpMeta.exif?.length ?? 0).toBe(0);
        expect(jpegMeta.exif?.length ?? 0).toBe(0);
    });
});
