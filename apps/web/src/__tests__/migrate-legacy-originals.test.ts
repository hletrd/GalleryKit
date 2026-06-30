import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const migrate = require('../../scripts/migrate.js') as {
    migrateLegacyOriginalUploads: (appRoot: string) => void;
};

let tmpRoot: string;
let previousUploadOriginalRoot: string | undefined;

function appRoot() {
    return path.join(tmpRoot, 'app');
}

function legacyOriginalRoot() {
    return path.join(appRoot(), 'public', 'uploads', 'original');
}

function privateOriginalRoot() {
    return path.join(tmpRoot, 'private-originals');
}

beforeEach(async () => {
    previousUploadOriginalRoot = process.env.UPLOAD_ORIGINAL_ROOT;
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gk-migrate-originals-'));
    await fsp.mkdir(legacyOriginalRoot(), { recursive: true });
    await fsp.mkdir(privateOriginalRoot(), { recursive: true });
    process.env.UPLOAD_ORIGINAL_ROOT = privateOriginalRoot();
});

afterEach(async () => {
    vi.restoreAllMocks();
    if (previousUploadOriginalRoot === undefined) {
        delete process.env.UPLOAD_ORIGINAL_ROOT;
    } else {
        process.env.UPLOAD_ORIGINAL_ROOT = previousUploadOriginalRoot;
    }
    await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('migrateLegacyOriginalUploads', () => {
    it('deletes a legacy duplicate only when the private target has identical bytes', async () => {
        const source = path.join(legacyOriginalRoot(), 'same.jpg');
        const target = path.join(privateOriginalRoot(), 'same.jpg');
        await fsp.writeFile(source, 'same bytes');
        await fsp.writeFile(target, 'same bytes');

        migrate.migrateLegacyOriginalUploads(appRoot());

        await expect(fsp.access(source)).rejects.toThrow();
        await expect(fsp.readFile(target, 'utf8')).resolves.toBe('same bytes');
    });

    it('fails closed and preserves both files when the private target differs', async () => {
        const source = path.join(legacyOriginalRoot(), 'conflict.jpg');
        const target = path.join(privateOriginalRoot(), 'conflict.jpg');
        await fsp.writeFile(source, 'good legacy original');
        await fsp.writeFile(target, 'truncated');

        expect(() => migrate.migrateLegacyOriginalUploads(appRoot())).toThrow(/different bytes/i);

        await expect(fsp.readFile(source, 'utf8')).resolves.toBe('good legacy original');
        await expect(fsp.readFile(target, 'utf8')).resolves.toBe('truncated');
    });

    it('verifies an EXDEV copy before deleting the legacy source', async () => {
        const source = path.join(legacyOriginalRoot(), 'cross-device.jpg');
        const target = path.join(privateOriginalRoot(), 'cross-device.jpg');
        await fsp.writeFile(source, 'copied across devices');
        vi.spyOn(fs, 'renameSync').mockImplementation(() => {
            const error = new Error('cross-device link') as NodeJS.ErrnoException;
            error.code = 'EXDEV';
            throw error;
        });

        migrate.migrateLegacyOriginalUploads(appRoot());

        await expect(fsp.access(source)).rejects.toThrow();
        await expect(fsp.readFile(target, 'utf8')).resolves.toBe('copied across devices');
    });

    it('normalizes migrated private original permissions', async () => {
        const source = path.join(legacyOriginalRoot(), 'permissive.jpg');
        const target = path.join(privateOriginalRoot(), 'permissive.jpg');
        await fsp.writeFile(source, 'legacy original');
        await fsp.chmod(source, 0o644);
        await fsp.chmod(privateOriginalRoot(), 0o755);

        migrate.migrateLegacyOriginalUploads(appRoot());

        const targetMode = (await fsp.stat(target)).mode & 0o777;
        const privateRootMode = (await fsp.stat(privateOriginalRoot())).mode & 0o777;

        expect(targetMode & 0o077).toBe(0);
        expect(privateRootMode & 0o077).toBe(0);
    });
});
