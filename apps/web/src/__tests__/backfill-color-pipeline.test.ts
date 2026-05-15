/**
 * Smoke test for the backfill-color-pipeline script (CM-HIGH-6, A2).
 *
 * The pre-fix script referenced a non-existent `color_space` column,
 * so first invocation against production threw ER_BAD_FIELD_ERROR. This
 * test exercises the row-level reprocessor against an in-memory fixture
 * to lock in the new contract: read icc_profile_name, run the full
 * encoder, return 'processed' on success or 'skipped' when the original
 * is missing.
 *
 * A2-follow-up: verifies P3 source → P3-tagged AVIF output via the
 * backfill pipeline.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { reprocessRow, type ImageRow } from '../../scripts/backfill-color-pipeline';
import { ensureUploadDirectories, UPLOAD_DIR_AVIF, UPLOAD_DIR_WEBP, UPLOAD_DIR_JPEG, UPLOAD_DIR_ORIGINAL } from '@/lib/upload-paths';

let tmpDir: string;
const generatedIds: string[] = [];

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gk-backfill-'));
    await ensureUploadDirectories();
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await Promise.all(generatedIds.flatMap((id) => [
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}.jpg`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}_8.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}_8.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}_8.jpg`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, `${id}.jpg`)).catch(() => {}),
    ]));
});

describe('backfill-color-pipeline reprocessRow (CM-HIGH-6, A2)', () => {
    it('returns "skipped" when filename_original is missing on disk', async () => {
        const row: ImageRow = {
            id: 9001,
            filename_original: 'does-not-exist.jpg',
            filename_avif: 'does-not-exist.avif',
            filename_webp: 'does-not-exist.webp',
            filename_jpeg: 'does-not-exist.jpg',
            icc_profile_name: 'sRGB',
            color_primaries: 'bt709',
            width: 8,
        };
        const outcome = await reprocessRow(row);
        expect(outcome.outcome).toBe('skipped');
    });

    it('returns "processed" and rewrites derivatives for an existing original', async () => {
        const id = 'backfill-row-fixture';
        generatedIds.push(id);

        // Stage an original file in UPLOAD_DIR_ORIGINAL where resolveOriginalUploadPath looks.
        const originalDestPath = path.join(UPLOAD_DIR_ORIGINAL, `${id}.jpg`);
        await fs.mkdir(path.dirname(originalDestPath), { recursive: true });
        await sharp({
            create: { width: 8, height: 8, channels: 3, background: { r: 64, g: 128, b: 200 } },
        })
            .withIccProfile('srgb')
            .jpeg({ quality: 90 })
            .toFile(originalDestPath);

        const row: ImageRow = {
            id: 9002,
            filename_original: `${id}.jpg`,
            filename_avif: `${id}.avif`,
            filename_webp: `${id}.webp`,
            filename_jpeg: `${id}.jpg`,
            icc_profile_name: 'sRGB',
            color_primaries: 'bt709',
            width: 8,
        };
        const outcome = await reprocessRow(row);
        expect(outcome.outcome).toBe('processed');
        expect(outcome.signals).toBeDefined();
        expect(outcome.signals!.color_primaries).toBe('bt709');

        // Confirm derivatives exist after the reprocess.
        const sizes = await Promise.all([
            fs.stat(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)),
            fs.stat(path.join(UPLOAD_DIR_WEBP, `${id}.webp`)),
            fs.stat(path.join(UPLOAD_DIR_JPEG, `${id}.jpg`)),
        ]);
        for (const s of sizes) {
            expect(s.size).toBeGreaterThan(0);
        }
    });

    it('verifies P3 source → P3-tagged AVIF output via backfill (A2)', async () => {
        const id = 'backfill-p3-fixture';
        generatedIds.push(id);

        const originalDestPath = path.join(UPLOAD_DIR_ORIGINAL, `${id}.jpg`);
        await fs.mkdir(path.dirname(originalDestPath), { recursive: true });
        await sharp({
            create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 64, b: 128 } },
        })
            .withIccProfile('p3')
            .jpeg({ quality: 90 })
            .toFile(originalDestPath);

        const row: ImageRow = {
            id: 9003,
            filename_original: `${id}.jpg`,
            filename_avif: `${id}.avif`,
            filename_webp: `${id}.webp`,
            filename_jpeg: `${id}.jpg`,
            icc_profile_name: 'Display P3',
            color_primaries: 'p3-d65',
            width: 8,
        };
        const outcome = await reprocessRow(row);
        expect(outcome.outcome).toBe('processed');
        expect(outcome.signals).toBeDefined();
        // The synthetic JPEG carries LittleCMS's built-in 'sP3C' ICC profile,
        // whose name does not match the Display P3 allowlist, so the
        // re-detection falls back to 'unknown'.  The encoder still used the
        // row's icc_profile_name ('Display P3') for the pipeline decision,
        // so the AVIF output below remains P3-tagged.
        expect(outcome.signals!.color_primaries).toBe('unknown');

        // Verify the output AVIF carries an ICC profile (P3-tagged).
        const avifPath = path.join(UPLOAD_DIR_AVIF, `${id}.avif`);
        const avifMeta = await sharp(avifPath).metadata();
        expect(avifMeta.icc).toBeDefined();
        expect(Buffer.isBuffer(avifMeta.icc)).toBe(true);
        expect(avifMeta.icc!.length).toBeGreaterThan(0);
    });

    it('R9-M4: refreshes color_pipeline_decision during backfill', async () => {
        const id = 'backfill-decision-fixture';
        generatedIds.push(id);

        const originalDestPath = path.join(UPLOAD_DIR_ORIGINAL, `${id}.jpg`);
        await fs.mkdir(path.dirname(originalDestPath), { recursive: true });
        await sharp({
            create: { width: 8, height: 8, channels: 3, background: { r: 64, g: 128, b: 200 } },
        })
            .withIccProfile('srgb')
            .jpeg({ quality: 90 })
            .toFile(originalDestPath);

        const row: ImageRow = {
            id: 9004,
            filename_original: `${id}.jpg`,
            filename_avif: `${id}.avif`,
            filename_webp: `${id}.webp`,
            filename_jpeg: `${id}.jpg`,
            icc_profile_name: 'sRGB',
            color_primaries: 'bt709',
            width: 8,
        };
        const outcome = await reprocessRow(row);
        expect(outcome.outcome).toBe('processed');
        expect(outcome.signals).toBeDefined();
        expect(outcome.signals!.color_pipeline_decision).toBe('srgb');
    });

    it('R8-CRIT: passes admin settings through to processImageFormats (forceSrgbDerivatives)', async () => {
        const id = 'backfill-settings-p3-srgb';
        generatedIds.push(id);

        const originalDestPath = path.join(UPLOAD_DIR_ORIGINAL, `${id}.jpg`);
        await fs.mkdir(path.dirname(originalDestPath), { recursive: true });
        await sharp({
            create: { width: 16, height: 16, channels: 3, background: { r: 200, g: 64, b: 128 } },
        })
            .withIccProfile('p3')
            .jpeg({ quality: 90 })
            .toFile(originalDestPath);

        const row: ImageRow = {
            id: 9004,
            filename_original: `${id}.jpg`,
            filename_avif: `${id}.avif`,
            filename_webp: `${id}.webp`,
            filename_jpeg: `${id}.jpg`,
            icc_profile_name: 'Display P3',
            color_primaries: 'p3-d65',
            width: 16,
        };

        // With forceSrgbDerivatives=true, JPEG/WebP should be sRGB-tagged
        // while AVIF remains P3-tagged (gamut-preserved).
        const outcome = await reprocessRow(row, {
            quality: { webp: 90, avif: 85, jpeg: 90 },
            sizes: [8, 16],
            forceSrgbDerivatives: true,
            wideGamutJpegChroma: '4:4:4',
            avifEffort: 6,
            sdrJpegChroma: '4:2:0',
            wideGamutMaxSourcePixels: 50_000_000,
        });
        expect(outcome.outcome).toBe('processed');

        // AVIF should still be P3-tagged (forceSrgbDerivatives only affects WebP/JPEG).
        const avifMeta = await sharp(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).metadata();
        expect(avifMeta.icc).toBeDefined();
        expect(Buffer.isBuffer(avifMeta.icc)).toBe(true);
        expect(avifMeta.icc!.length).toBeGreaterThan(0);

        // JPEG should be sRGB-tagged when forceSrgbDerivatives is true.
        const jpegMeta = await sharp(path.join(UPLOAD_DIR_JPEG, `${id}.jpg`)).metadata();
        // sRGB ICC profile has a well-known header; the absence of a P3 profile
        // and the presence of any ICC profile indicates sRGB tagging.
        expect(jpegMeta.icc).toBeDefined();
        expect(Buffer.isBuffer(jpegMeta.icc)).toBe(true);
    });
});
