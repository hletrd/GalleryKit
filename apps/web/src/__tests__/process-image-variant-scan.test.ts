import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { deleteImageVariants } from '@/lib/process-image';

/**
 * C3-TG01: Test for deleteImageVariants with sizes=[] (directory scan fallback).
 * Verifies the opendir scan correctly identifies and deletes all matching
 * variant files when sizes are unknown (empty array), including leftovers
 * from prior image-size configs.
 */
describe('deleteImageVariants with sizes=[] (directory scan)', () => {
    let tempDir: string;

    beforeAll(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gallerykit-variant-scan-test-'));
    });

    afterAll(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('deletes all size variants when sizes=[] triggers directory scan', async () => {
        // Create a base filename and multiple size variants
        const baseFilename = 'abc123.jpg';
        const ext = '.jpg';
        const name = 'abc123';

        // Create the base file
        await fs.writeFile(path.join(tempDir, baseFilename), 'base');

        // Create size variants matching the {name}_{size}{ext} pattern
        const variantSizes = [640, 1536, 2048, 4096];
        for (const size of variantSizes) {
            await fs.writeFile(path.join(tempDir, `${name}_${size}${ext}`), `variant-${size}`);
        }

        // Create a variant from a "prior config" with a non-standard size
        await fs.writeFile(path.join(tempDir, `${name}_3200${ext}`), 'legacy-variant');

        // Call deleteImageVariants with sizes=[] to trigger directory scan
        await deleteImageVariants(tempDir, baseFilename, []);

        // Verify all variant files (base + size variants + legacy) are deleted
        const remaining = await fs.readdir(tempDir);
        expect(remaining).toEqual([]);
    });

    it('does not delete non-matching files in the directory', async () => {
        // Create files that should NOT be deleted
        const unrelatedFile = 'other-image.jpg';
        const differentBaseSameExt = 'xyz789_640.jpg';
        const differentExt = 'abc123.webp';

        await fs.writeFile(path.join(tempDir, unrelatedFile), 'unrelated');
        await fs.writeFile(path.join(tempDir, differentBaseSameExt), 'different-base');
        await fs.writeFile(path.join(tempDir, differentExt), 'different-ext');

        // Create a base file and its variant
        const baseFilename = 'target.jpg';
        await fs.writeFile(path.join(tempDir, baseFilename), 'base');
        await fs.writeFile(path.join(tempDir, 'target_2048.jpg'), 'variant');

        await deleteImageVariants(tempDir, baseFilename, []);

        const remaining = await fs.readdir(tempDir);
        // Unrelated files should remain; target and its variant should be deleted
        expect(remaining).toContain(unrelatedFile);
        expect(remaining).toContain(differentBaseSameExt);
        expect(remaining).toContain(differentExt);
        expect(remaining).not.toContain(baseFilename);
        expect(remaining).not.toContain('target_2048.jpg');
    });

    it('handles empty directory gracefully', async () => {
        const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gallerykit-empty-scan-'));
        try {
            // Should not throw on empty directory
            await expect(deleteImageVariants(emptyDir, 'nonexistent.jpg', [])).resolves.toBeUndefined();
        } finally {
            await fs.rm(emptyDir, { recursive: true, force: true });
        }
    });
});
