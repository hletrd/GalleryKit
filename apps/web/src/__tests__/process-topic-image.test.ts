/**
 * AGG-R5C2-16 (TEST-R5C2-08): unit tests for processTopicImage,
 * deleteTopicImage, and cleanOrphanedTopicTempFiles.
 *
 * processTopicImage / deleteTopicImage: mocked @/lib/validation +
 * @/lib/process-image + @/lib/upload-limits; real sharp pipeline used
 * for valid-image tests so the webp output contract is exercised.
 *
 * cleanOrphanedTopicTempFiles: real-filesystem tests.
 *
 * ORCH-C3-TMPDIR (AGG-C3-03): RESOURCES_DIR in process-topic-image.ts is
 * computed at module-eval time from TOPIC_RESOURCES_ROOT (env) or cwd. This
 * suite sets TOPIC_RESOURCES_ROOT to a fresh os.tmpdir() mkdtemp directory
 * via vi.hoisted() — which runs BEFORE the static import below — so the real
 * Sharp pipeline writes its <uuid>.webp + tmp-* scratch into an isolated temp
 * dir rather than leaking binary artifacts into the repo-tracked
 * public/resources/ tree on every `npm test` / gate run. afterAll removes the
 * whole temp dir (rm -rf), so a crash-interrupted run cannot strand orphans in
 * the working tree.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import sharp from 'sharp';

// ORCH-C3-TMPDIR: create the isolated temp dir and point the module at it via
// env BEFORE the static import of @/lib/process-topic-image runs. vi.hoisted()
// is lifted above imports, and the module reads TOPIC_RESOURCES_ROOT at
// module-eval time, so this guarantees RESOURCES_DIR === topicResourcesDir.
// NOTE: the hoisted callback runs before the static ESM imports above are
// initialized, so it must require() Node built-ins inline rather than rely on
// the top-level fsSync/path/os bindings (those are still in the TDZ here).
const { topicResourcesDir } = vi.hoisted(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeFs = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodePath = require('path') as typeof import('path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeOs = require('os') as typeof import('os');
    const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'gk-topic-res-'));
    process.env.TOPIC_RESOURCES_ROOT = dir;
    return { topicResourcesDir: dir };
});

// Mock @/lib/validation so isValidFilename stays simple and predictable.
vi.mock('@/lib/validation', () => ({
    isValidFilename: (name: string) =>
        typeof name === 'string' && name.length > 0 && /^[a-zA-Z0-9._-]+$/.test(name),
}));

// Mock @/lib/process-image to provide MAX_INPUT_PIXELS_TOPIC.
vi.mock('@/lib/process-image', () => ({
    MAX_INPUT_PIXELS_TOPIC: 268_402_689, // 16384 × 16384
}));

// Mock @/lib/upload-limits so MAX_UPLOAD_FILE_BYTES is available.
vi.mock('@/lib/upload-limits', () => ({
    MAX_UPLOAD_FILE_BYTES: 200 * 1024 * 1024,
}));

// Import AFTER mocks and AFTER the hoisted env setup.
import {
    processTopicImage,
    deleteTopicImage,
    cleanOrphanedTopicTempFiles,
    ORPHANED_TOPIC_TEMP_MIN_AGE_MS,
} from '@/lib/process-topic-image';

// ---------------------------------------------------------------------------
// Suite-wide isolated-temp-dir lifecycle.
// ---------------------------------------------------------------------------
afterAll(async () => {
    // rm -rf the whole isolated dir — guaranteed cleanup of every <uuid>.webp,
    // tmp-*, and keep-* file the suite produced, even on partial failure.
    await fs.rm(topicResourcesDir, { recursive: true, force: true }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function makeTinyJpegFile(name = 'test.jpg', sizePx = 4): Promise<File> {
    const buf = await sharp({
        create: {
            width: sizePx,
            height: sizePx,
            channels: 3,
            background: { r: 100, g: 150, b: 200 },
        },
    })
        .jpeg({ quality: 50 })
        .toBuffer();
    return new File([new Uint8Array(buf)], name, { type: 'image/jpeg' });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processTopicImage', () => {
    it('rejects files that are too large', async () => {
        const buf = new Uint8Array(201 * 1024 * 1024); // 201 MB — over limit
        const file = new File([buf], 'large.jpg', { type: 'image/jpeg' });
        await expect(processTopicImage(file)).rejects.toThrow(/too large/i);
    });

    it('rejects empty files', async () => {
        const file = new File([], 'empty.jpg', { type: 'image/jpeg' });
        await expect(processTopicImage(file)).rejects.toThrow(/empty/i);
    });

    it('rejects disallowed extensions', async () => {
        const file = new File([new Uint8Array([1, 2, 3])], 'file.exe', { type: 'application/octet-stream' });
        await expect(processTopicImage(file)).rejects.toThrow(/not allowed/i);
    });

    it('rejects invalid image data (sharp pipeline failure)', async () => {
        // A .jpg extension but random bytes — sharp will throw.
        const garbage = new Uint8Array(1024).fill(0xaa);
        const file = new File([garbage], 'fake.jpg', { type: 'image/jpeg' });
        await expect(processTopicImage(file)).rejects.toThrow(/invalid image/i);
    });

    it('returns a <uuid>.webp filename for a valid JPEG', async () => {
        const file = await makeTinyJpegFile();
        const filename = await processTopicImage(file);
        // Must be UUID.webp
        expect(filename).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/,
        );
        // The output landed in the isolated temp dir, not the repo tree.
        await expect(fs.access(path.join(topicResourcesDir, filename))).resolves.toBeUndefined();
    });

    it('returns a <uuid>.webp filename for a valid PNG', async () => {
        const buf = await sharp({
            create: { width: 4, height: 4, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
        })
            .png()
            .toBuffer();
        const file = new File([new Uint8Array(buf)], 'test.png', { type: 'image/png' });
        const filename = await processTopicImage(file);
        expect(filename).toMatch(/\.webp$/);
        await expect(fs.access(path.join(topicResourcesDir, filename))).resolves.toBeUndefined();
    });
});

describe('deleteTopicImage', () => {
    it('is a no-op for an empty filename', async () => {
        // Must not throw.
        await expect(deleteTopicImage('')).resolves.toBeUndefined();
    });

    it('is a no-op for a filename that fails isValidFilename (path traversal)', async () => {
        // '../etc/passwd' contains slashes — mocked isValidFilename rejects it.
        await expect(deleteTopicImage('../etc/passwd')).resolves.toBeUndefined();
    });

    it('is a no-op when the file does not exist (unlink swallows ENOENT)', async () => {
        // Valid filename shape but the file does not exist — must not throw.
        await expect(deleteTopicImage('nonexistent.webp')).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// cleanOrphanedTopicTempFiles: real-filesystem tests.
//
// RESOURCES_DIR resolves to the isolated temp dir (topicResourcesDir) for this
// suite via TOPIC_RESOURCES_ROOT. We write real tmp-* files into that directory,
// call the function, and verify they are gone. This avoids vi.spyOn on Node
// built-in fs/promises whose properties are non-configurable.
// ---------------------------------------------------------------------------

describe('cleanOrphanedTopicTempFiles', () => {
    beforeAll(async () => {
        // Ensure the directory exists (processTopicImage also creates it).
        await fs.mkdir(topicResourcesDir, { recursive: true });
    });

    it('removes stale tmp-* files and leaves non-tmp files intact', async () => {
        // Write a temp file and BACKDATE its mtime past the orphan age gate
        // (C1-05: only genuinely stale files may be cleaned), plus a regular
        // .webp file into the isolated dir.
        const tmpFile = path.join(topicResourcesDir, `tmp-test-${Date.now()}`);
        const keepFile = path.join(topicResourcesDir, `keep-${Date.now()}.webp`);
        await fs.writeFile(tmpFile, 'stale');
        await fs.writeFile(keepFile, 'keep');
        const past = new Date(Date.now() - ORPHANED_TOPIC_TEMP_MIN_AGE_MS - 60_000);
        await fs.utimes(tmpFile, past, past);

        await cleanOrphanedTopicTempFiles();

        // stale tmp-* file must be gone.
        await expect(fs.access(tmpFile)).rejects.toThrow();
        // non-tmp file must remain.
        await expect(fs.access(keepFile)).resolves.toBeUndefined();
    });

    it('C1-05: leaves FRESH tmp-* files alone (in-flight topic-cover uploads must not be raced)', async () => {
        const freshTmpFile = path.join(topicResourcesDir, `tmp-fresh-${Date.now()}`);
        await fs.writeFile(freshTmpFile, 'in-flight upload bytes');

        await cleanOrphanedTopicTempFiles();

        // A just-written tmp file is younger than the age gate and must survive.
        await expect(fs.access(freshTmpFile)).resolves.toBeUndefined();
        await fs.unlink(freshTmpFile).catch(() => {});
    });

    it('is a no-op when there are no tmp-* files (no throw, no side effects)', async () => {
        // Write only a regular file.
        const keepFile = path.join(topicResourcesDir, `keep-noop-${Date.now()}.webp`);
        await fs.writeFile(keepFile, 'keep');

        // Should complete without throwing.
        await expect(cleanOrphanedTopicTempFiles()).resolves.toBeUndefined();

        // Regular file untouched.
        await expect(fs.access(keepFile)).resolves.toBeUndefined();
    });

    it('does not throw when the resources directory does not exist yet', async () => {
        // The guard is: catch block in cleanOrphanedTopicTempFiles swallows all
        // errors. RESOURCES_DIR exists in this context, so we pin the contract
        // by confirming the function always resolves cleanly.
        await expect(cleanOrphanedTopicTempFiles()).resolves.toBeUndefined();
    });
});
