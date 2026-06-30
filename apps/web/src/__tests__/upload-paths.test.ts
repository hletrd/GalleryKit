/**
 * plan-315 item 17 / TEST-R5C1-07 (pulled forward this cycle as AGG-R5C3
 * escalation TEST-R5C3-04): behavioral tests for upload-paths.ts.
 *
 * Every consumer of resolveOriginalUploadPath / assertNoLegacyPublicOriginalUploads
 * mocks the module, so its real branch behavior — primary vs legacy resolution,
 * the legacy-leak warn-vs-throw policy — had ZERO direct coverage. These tmpdir
 * tests exercise the real filesystem branches.
 *
 * upload-paths.ts computes UPLOAD_DIR_ORIGINAL / LEGACY_UPLOAD_DIR_ORIGINAL from
 * env vars at MODULE LOAD, so we set UPLOAD_ROOT + UPLOAD_ORIGINAL_ROOT to fresh
 * tmpdirs BEFORE a dynamic import, then exercise the resolver against real files.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

let tmpRoot: string;
let primaryDir: string; // UPLOAD_ORIGINAL_ROOT (private originals)
let legacyDir: string; // <UPLOAD_ROOT>/original (legacy public originals)

// Loaded after env is set so the module captures our tmpdirs.
type UploadPathsModule = typeof import('@/lib/upload-paths');
let mod: UploadPathsModule;

beforeAll(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gk-upload-paths-'));
    const uploadRoot = path.join(tmpRoot, 'public-uploads');
    primaryDir = path.join(tmpRoot, 'data-original');
    legacyDir = path.join(uploadRoot, 'original');
    await fs.mkdir(primaryDir, { recursive: true });
    await fs.mkdir(legacyDir, { recursive: true });

    process.env.UPLOAD_ROOT = uploadRoot;
    process.env.UPLOAD_ORIGINAL_ROOT = primaryDir;

    mod = await import('@/lib/upload-paths');
    // Sanity: the module captured our tmpdirs.
    expect(mod.UPLOAD_DIR_ORIGINAL).toBe(primaryDir);
    expect(mod.LEGACY_UPLOAD_DIR_ORIGINAL).toBe(legacyDir);
});

afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
});

afterEach(async () => {
    // Clear both dirs between tests so file presence is deterministic.
    for (const dir of [primaryDir, legacyDir]) {
        for (const e of await fs.readdir(dir)) {
            await fs.rm(path.join(dir, e), { force: true });
        }
    }
});

describe('resolveOriginalUploadPath', () => {
    it('creates the private original directory with owner-only permissions', async () => {
        await fs.rm(primaryDir, { recursive: true, force: true });

        await mod.ensurePrivateOriginalUploadDirectory();

        const stat = await fs.stat(primaryDir);
        expect(stat.mode & 0o777).toBe(0o700);
    });

    it('returns the PRIMARY path when the file exists there', async () => {
        await fs.writeFile(path.join(primaryDir, 'photo.jpg'), 'x');
        const resolved = await mod.resolveOriginalUploadPath('photo.jpg');
        await expect(fs.realpath(resolved ?? '')).resolves.toBe(await fs.realpath(path.join(primaryDir, 'photo.jpg')));
    });

    it('falls back to the LEGACY path when the file exists only there', async () => {
        await fs.writeFile(path.join(legacyDir, 'old.jpg'), 'x');
        const resolved = await mod.resolveOriginalUploadPath('old.jpg');
        await expect(fs.realpath(resolved ?? '')).resolves.toBe(await fs.realpath(path.join(legacyDir, 'old.jpg')));
    });

    it('prefers PRIMARY over legacy when the file exists in both', async () => {
        await fs.writeFile(path.join(primaryDir, 'dup.jpg'), 'new');
        await fs.writeFile(path.join(legacyDir, 'dup.jpg'), 'old');
        const resolved = await mod.resolveOriginalUploadPath('dup.jpg');
        await expect(fs.realpath(resolved ?? '')).resolves.toBe(await fs.realpath(path.join(primaryDir, 'dup.jpg')));
    });

    it('returns null when the file exists in NEITHER', async () => {
        const resolved = await mod.resolveOriginalUploadPath('missing.jpg');
        expect(resolved).toBeNull();
    });

    it('rejects traversal and absolute filenames before filesystem resolution', async () => {
        await fs.writeFile(path.join(tmpRoot, 'secret.jpg'), 'secret');

        await expect(mod.resolveOriginalUploadPath('../secret.jpg')).resolves.toBeNull();
        await expect(mod.resolveOriginalUploadPath(path.join(primaryDir, 'photo.jpg'))).resolves.toBeNull();
    });

    it('rejects symlinked originals even when the link exists inside the upload root', async () => {
        const outside = path.join(tmpRoot, 'outside.jpg');
        const link = path.join(primaryDir, 'linked.jpg');
        await fs.writeFile(outside, 'secret');
        await fs.symlink(outside, link);

        await expect(mod.resolveOriginalUploadPath('linked.jpg')).resolves.toBeNull();
    });
});

describe('deleteOriginalUploadFileStrict', () => {
    it('throws on unsafe filenames instead of joining them to upload roots', async () => {
        await expect(mod.deleteOriginalUploadFileStrict('../secret.jpg')).rejects.toThrow(/unsafe original upload filename/i);
    });

    it('deletes safe primary and legacy original candidates', async () => {
        await fs.writeFile(path.join(primaryDir, 'delete-me.jpg'), 'primary');
        await fs.writeFile(path.join(legacyDir, 'delete-me.jpg'), 'legacy');

        await expect(mod.deleteOriginalUploadFileStrict('delete-me.jpg')).resolves.toBeUndefined();

        await expect(fs.access(path.join(primaryDir, 'delete-me.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.access(path.join(legacyDir, 'delete-me.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('throws rather than unlinking a symlink candidate', async () => {
        const outside = path.join(tmpRoot, 'outside-delete.jpg');
        const link = path.join(primaryDir, 'linked-delete.jpg');
        await fs.writeFile(outside, 'secret');
        await fs.symlink(outside, link);

        await expect(mod.deleteOriginalUploadFileStrict('linked-delete.jpg')).rejects.toMatchObject({
            errors: [expect.objectContaining({ message: expect.stringMatching(/symlink/i) })],
        });
        await expect(fs.readFile(outside, 'utf8')).resolves.toBe('secret');
    });
});

describe('assertNoLegacyPublicOriginalUploads', () => {
    it('passes silently when the legacy dir is empty', async () => {
        await expect(mod.assertNoLegacyPublicOriginalUploads()).resolves.toBeUndefined();
    });

    it('warns (does not throw) when legacy files exist and failInProduction is unset', async () => {
        await fs.writeFile(path.join(legacyDir, 'leaked.jpg'), 'x');
        await expect(mod.assertNoLegacyPublicOriginalUploads()).resolves.toBeUndefined();
    });

    it('throws when legacy files exist, failInProduction is true, and NODE_ENV is production', async () => {
        await fs.writeFile(path.join(legacyDir, 'leaked.jpg'), 'x');
        const prevEnv = process.env.NODE_ENV;
        try {
            // NODE_ENV is read-only typed; assign via the record cast.
            (process.env as Record<string, string>).NODE_ENV = 'production';
            await expect(
                mod.assertNoLegacyPublicOriginalUploads({ failInProduction: true }),
            ).rejects.toThrow(/legacy original upload/i);
        } finally {
            (process.env as Record<string, string>).NODE_ENV = prevEnv ?? 'test';
        }
    });

    it('only warns (no throw) when legacy files exist, failInProduction is true, but NODE_ENV is NOT production', async () => {
        await fs.writeFile(path.join(legacyDir, 'leaked.jpg'), 'x');
        // NODE_ENV is 'test' under vitest.
        await expect(
            mod.assertNoLegacyPublicOriginalUploads({ failInProduction: true }),
        ).resolves.toBeUndefined();
    });
});
