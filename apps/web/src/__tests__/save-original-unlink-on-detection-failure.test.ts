/**
 * BUG-R5C1-02: saveOriginalAndGetMetadata must unlink the written original
 * when detectColorSignals (or any code in the post-write window) throws.
 *
 * Prior to this fix: the original was written to disk successfully, but if
 * detectColorSignals threw, the file was left on disk — a silent orphan
 * accumulating on every upload attempt that hit the detection failure path.
 * The caller (uploadImages) only cleaned up when savedOriginalFilename was
 * set, which only happened on full success.
 *
 * This test:
 *  - Creates a real tiny JPEG fixture on disk.
 *  - Mocks detectColorSignals to throw.
 *  - Calls saveOriginalAndGetMetadata.
 *  - Asserts the original file no longer exists after the rejected promise.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be declared before vi.mock calls
// ---------------------------------------------------------------------------
const { detectColorSignalsMock } = vi.hoisted(() => ({
    detectColorSignalsMock: vi.fn(),
}));

vi.mock('@/lib/color-detection', () => ({
    detectColorSignals: detectColorSignalsMock,
    isWideGamutPrimary: vi.fn(() => false),
}));

// Override UPLOAD_DIR_ORIGINAL to use our temp dir (set in beforeAll).
let tmpDir: string;
let uploadOriginalDir: string;

vi.mock('@/lib/upload-paths', async () => {
    // Return a lazy getter so tmpDir is resolved at call-time, not import-time.
    return {
        get UPLOAD_DIR_ORIGINAL() {
            return uploadOriginalDir;
        },
        get UPLOAD_DIR_WEBP() { return uploadOriginalDir; },
        get UPLOAD_DIR_AVIF() { return uploadOriginalDir; },
        get UPLOAD_DIR_JPEG() { return uploadOriginalDir; },
        ensureUploadDirectories: vi.fn(),
        deleteOriginalUploadFile: vi.fn(),
        resolveOriginalUploadPath: vi.fn(async (n: string) => path.join(uploadOriginalDir, n)),
    };
});

// Import AFTER mocks are set up
import { saveOriginalAndGetMetadata } from '@/lib/process-image';

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gk-save-orig-test-'));
    uploadOriginalDir = tmpDir;
});

afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
});

async function makeTinyJpegFile(): Promise<File> {
    // 4×4 sRGB JPEG — minimal valid JPEG that Sharp can process.
    const buf = await sharp({
        create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 64, b: 32 } },
    }).jpeg({ quality: 50 }).toBuffer();

    return new File([buf], 'test.jpg', { type: 'image/jpeg' });
}

describe('saveOriginalAndGetMetadata — post-write cleanup (BUG-R5C1-02)', () => {
    it('unlinks the written original when detectColorSignals throws', async () => {
        detectColorSignalsMock.mockRejectedValueOnce(new Error('simulated detection failure'));

        const file = await makeTinyJpegFile();

        // Track files before the call
        const before = await fs.readdir(tmpDir);

        await expect(saveOriginalAndGetMetadata(file, 50_000_000)).rejects.toThrow('simulated detection failure');

        // After the rejected promise, no new files should remain
        const after = await fs.readdir(tmpDir);
        const newFiles = after.filter((f) => !before.includes(f));
        expect(newFiles).toHaveLength(0);
    });

    it('resolves normally and leaves the file on disk when detectColorSignals succeeds', async () => {
        detectColorSignalsMock.mockResolvedValueOnce({
            iccProfileName: null,
            colorPrimaries: 'bt709',
            transferFunction: 'srgb',
            matrixCoefficients: null,
            isHdr: false,
            hasGainMap: false,
        });

        const file = await makeTinyJpegFile();

        const result = await saveOriginalAndGetMetadata(file, 50_000_000);
        expect(result.filenameOriginal).toBeTruthy();

        // File should exist
        await expect(
            fs.access(path.join(tmpDir, result.filenameOriginal)),
        ).resolves.toBeUndefined();

        // Cleanup
        await fs.unlink(path.join(tmpDir, result.filenameOriginal)).catch(() => {});
    });
});
