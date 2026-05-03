/**
 * EXIF Orientation tests (CM-HIGH-4).
 *
 * The pre-fix pipeline never calls .rotate() or .autoOrient(). For an iPhone
 * landscape JPEG with Orientation=6 (90° CW), the encoder strips the
 * orientation tag from WebP/JPEG (because keepIccProfile only keeps ICC) but
 * leaves the source pixel orientation untouched. The browser sees pixel
 * dimensions that don't match the photographer's intent, and aspect-ratio
 * CSS in the masonry breaks.
 *
 * This test asserts that a 4×8 (taller-than-wide) JPEG with Orientation=6
 * produces an UPRIGHT output: width < height after autoOrient applies the
 * tag's rotation pre-resize. After PR 2 lands the autoOrient call is in
 * the pipeline and these tests go GREEN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { processImageFormats } from '@/lib/process-image';
import { ensureUploadDirectories, UPLOAD_DIR_AVIF, UPLOAD_DIR_WEBP, UPLOAD_DIR_JPEG } from '@/lib/upload-paths';

let tmpDir: string;
const generatedIds: string[] = [];

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gk-orientation-'));
    await ensureUploadDirectories();
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await Promise.all(generatedIds.flatMap((id) => [
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}.jpg`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}_4.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}_4.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}_4.jpg`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}_8.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}_8.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}_8.jpg`)).catch(() => {}),
    ]));
});

function trackId(id: string): string {
    generatedIds.push(id);
    return id;
}

/**
 * Build a synthetic JPEG with the given EXIF orientation. The pixel data
 * is intentionally non-square (4×8) so post-rotation we can detect whether
 * the pipeline applied the orientation: pre-rotation the image is taller
 * than wide; post-rotation under Orientation=6 (rotate 90° CW), it should
 * become wider than tall — but the photographer's original intent for an
 * Orientation=6 file is that the IMAGE is upright when rotated, so the
 * pre-fix pipeline that ignores the tag will serve a sideways image.
 *
 * The fix (autoOrient) reads the tag, rotates pixels to upright, and
 * clears the tag. So for an Orientation=6 source whose pixels are 4 wide
 * × 8 tall, the upright output is 8 wide × 4 tall. We assert that.
 */
async function makeOrientedJpeg(orientation: number, destPath: string): Promise<void> {
    await sharp({
        create: { width: 4, height: 8, channels: 3, background: { r: 50, g: 100, b: 150 } },
    })
        .withMetadata({ orientation })
        .jpeg({ quality: 90 })
        .toFile(destPath);
}

describe('EXIF Orientation handling (CM-HIGH-4)', () => {
    it('Orientation=6 source produces upright AVIF/WebP/JPEG (pixels rotated, tag cleared)', async () => {
        const srcPath = path.join(tmpDir, 'oriented-source.jpg');
        await makeOrientedJpeg(6, srcPath);

        const id = trackId('orient-rot90');
        // Use a single output size of 8 (matches max input width post-rotate).
        await processImageFormats(
            srcPath,
            `${id}.webp`,
            `${id}.avif`,
            `${id}.jpg`,
            8,
            { webp: 80, avif: 80, jpeg: 90 },
            [8],
            null,
        );

        const { UPLOAD_DIR_AVIF, UPLOAD_DIR_WEBP, UPLOAD_DIR_JPEG } = await import('@/lib/upload-paths');
        for (const [ext, dir] of [
            ['avif', UPLOAD_DIR_AVIF],
            ['webp', UPLOAD_DIR_WEBP],
            ['jpg', UPLOAD_DIR_JPEG],
        ] as const) {
            const meta = await sharp(path.join(dir, `${id}.${ext}`)).metadata();
            const w = meta.width ?? 0;
            const h = meta.height ?? 0;
            // After autoOrient + rotate 90° CW, source 4w×8h becomes 8w×4h.
            expect(w).toBeGreaterThan(h);
            // Orientation tag must be cleared (or be 1) so browsers don't double-rotate.
            expect(meta.orientation === undefined || meta.orientation === 1).toBe(true);
        }
    });

    it('Orientation=1 source is unchanged (no double-rotation regression)', async () => {
        const srcPath = path.join(tmpDir, 'oriented-1-source.jpg');
        await makeOrientedJpeg(1, srcPath);

        const id = trackId('orient-rot0');
        await processImageFormats(
            srcPath,
            `${id}.webp`,
            `${id}.avif`,
            `${id}.jpg`,
            4,
            { webp: 80, avif: 80, jpeg: 90 },
            [4],
            null,
        );

        const { UPLOAD_DIR_AVIF } = await import('@/lib/upload-paths');
        const meta = await sharp(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        // Orientation=1 = no rotation; 4w×8h source should stay portrait.
        expect(h).toBeGreaterThan(w);
    });
});
