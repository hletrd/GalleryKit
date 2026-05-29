/**
 * Detection-failure column-set contract (Run-2 Cycle 2 AGG2-01 / AGG2-02 / TST2-01).
 *
 * Locks the sidecar backfill script's behavior when the re-encode SUCCEEDS but
 * `detectColorSignals` THROWS. Before this contract, the script returned
 * `{ outcome: 'processed' }` with no payload on that branch, so the queue
 * handler issued NO UPDATE — leaving the PUBLIC `avif_10bit` (delivered
 * bit-depth chip) and admin-only `was_downscaled` stale after a sidecar
 * backfill. The in-app runner (admin-backfill-runner.ts:268-273) DID persist
 * those two columns on the same branch, so identical input produced divergent
 * DB state across the two backfill paths.
 *
 * This test mocks `detectColorSignals` to reject after a successful encode and
 * asserts `reprocessRow` returns `derivativeOnly` (the two derivative columns,
 * no color `signals`) so `flushBatch` persists them WITHOUT advancing
 * pipeline_version. It is the MED-enabling test that would have caught AGG2-01.
 *
 * The mock is module-wide, so this lives in a DEDICATED file (the success-path
 * contract tests in backfill-color-pipeline.test.ts rely on REAL detection).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// Mock ONLY detectColorSignals so the re-encode still succeeds (process-image
// imports other helpers from this module — e.g. normalizeName — so we must
// preserve the real exports via importActual and override just the one symbol).
vi.mock('../lib/color-detection', async (importActual) => {
    const actual = await importActual<typeof import('../lib/color-detection')>();
    return {
        ...actual,
        detectColorSignals: vi.fn(async () => {
            throw new Error('simulated detection failure (truncated ICC tag table)');
        }),
    };
});

import { reprocessRow, type ImageRow } from '../../scripts/backfill-color-pipeline';
import {
    ensureUploadDirectories,
    UPLOAD_DIR_AVIF,
    UPLOAD_DIR_WEBP,
    UPLOAD_DIR_JPEG,
    UPLOAD_DIR_ORIGINAL,
} from '@/lib/upload-paths';

let tmpDir: string;
const generatedIds: string[] = [];

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gk-backfill-detfail-'));
    await ensureUploadDirectories();
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await Promise.all(generatedIds.flatMap((id) => [
        fs.unlink(path.join(UPLOAD_DIR_AVIF, `${id}.avif`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_WEBP, `${id}.webp`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_JPEG, `${id}.jpg`)).catch(() => {}),
        fs.unlink(path.join(UPLOAD_DIR_ORIGINAL, `${id}.jpg`)).catch(() => {}),
    ]));
});

describe('backfill detection-failure contract (AGG2-01)', () => {
    it('returns derivativeOnly (was_downscaled + avif_10bit) and NO color signals when detection throws after a successful encode', async () => {
        const id = 'backfill-detfail-fixture';
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
            id: 9101,
            filename_original: `${id}.jpg`,
            filename_avif: `${id}.avif`,
            filename_webp: `${id}.webp`,
            filename_jpeg: `${id}.jpg`,
            icc_profile_name: 'sRGB',
            color_primaries: 'bt709',
            width: 8,
        };

        const result = await reprocessRow(row);

        // Encode succeeded → outcome is 'processed'.
        expect(result.outcome).toBe('processed');
        // Detection threw → NO color signals (so pipeline_version stays behind
        // and the row remains a candidate for a later detection retry).
        expect(result.signals).toBeUndefined();
        // But the derivative columns MUST be present so the script persists
        // them — mirroring admin-backfill-runner.ts. This is the column set
        // that diverged before AGG2-01.
        expect(result.derivativeOnly).toBeDefined();
        const derivativeColumns = Object.keys(result.derivativeOnly!).sort();
        expect(derivativeColumns).toEqual(['avif_10bit', 'was_downscaled']);
        expect(typeof result.derivativeOnly!.avif_10bit).toBe('boolean');
        expect(typeof result.derivativeOnly!.was_downscaled).toBe('boolean');
        // sRGB 8-bit source → 8-bit AVIF.
        expect(result.derivativeOnly!.avif_10bit).toBe(false);

        // The derivatives themselves were still written to disk.
        const avifStat = await fs.stat(path.join(UPLOAD_DIR_AVIF, `${id}.avif`));
        expect(avifStat.size).toBeGreaterThan(0);
    });
});
