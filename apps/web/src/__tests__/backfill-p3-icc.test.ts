/**
 * Smoke test for the backfill-p3-icc script (CM-HIGH-6).
 *
 * The pre-fix script referenced a non-existent `icc_profile_name` column,
 * so first invocation against production threw ER_BAD_FIELD_ERROR. This
 * test exercises the row-level reprocessor against an in-memory fixture
 * to lock in the new contract: read filename_original, run the full
 * encoder, return 'processed' on success or 'skipped' when the original
 * is missing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { reprocessRow, type ImageRow } from '../../scripts/backfill-p3-icc';
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

describe('backfill-p3-icc reprocessRow (CM-HIGH-6)', () => {
    it('returns "skipped" when filename_original is missing on disk', async () => {
        const row: ImageRow = {
            id: 9001,
            filename_original: 'does-not-exist.jpg',
            filename_avif: 'does-not-exist.avif',
            filename_webp: 'does-not-exist.webp',
            filename_jpeg: 'does-not-exist.jpg',
            color_space: 'sRGB',
            width: 8,
        };
        const outcome = await reprocessRow(row);
        expect(outcome).toBe('skipped');
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
            color_space: 'sRGB',
            width: 8,
        };
        const outcome = await reprocessRow(row);
        expect(outcome).toBe('processed');

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
});
