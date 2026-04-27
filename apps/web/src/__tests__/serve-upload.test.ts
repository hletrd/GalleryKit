import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('serveUploadFile', () => {
    let uploadRoot = '';

    beforeEach(async () => {
        uploadRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-upload-root-'));
        process.env.UPLOAD_ROOT = uploadRoot;
        await fsp.mkdir(path.join(uploadRoot, 'jpeg'), { recursive: true });
        await fsp.mkdir(path.join(uploadRoot, 'webp'), { recursive: true });
        await fsp.mkdir(path.join(uploadRoot, 'avif'), { recursive: true });
        vi.resetModules();
    });

    afterEach(async () => {
        delete process.env.UPLOAD_ROOT;
        await fsp.rm(uploadRoot, { recursive: true, force: true });
        vi.resetModules();
    });

    it('serves files from allowed upload directories', async () => {
        const jpegPath = path.join(uploadRoot, 'jpeg', 'photo.jpg');
        await fsp.writeFile(jpegPath, 'jpeg-data');

        const { serveUploadFile } = await import('@/lib/serve-upload');
        const response = await serveUploadFile(['jpeg', 'photo.jpg']);

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('image/jpeg');
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(await response.text()).toBe('jpeg-data');
    });

    it('rejects extension/directory mismatches', async () => {
        const { serveUploadFile } = await import('@/lib/serve-upload');

        // .webp file in /uploads/jpeg/ — wrong directory for this format
        const responseJpegDir = await serveUploadFile(['jpeg', 'photo.webp']);
        expect(responseJpegDir.status).toBe(400);

        // .jpg file in /uploads/webp/ — wrong directory for this format
        const responseWebpDir = await serveUploadFile(['webp', 'photo.jpg']);
        expect(responseWebpDir.status).toBe(400);

        // .avif file in /uploads/jpeg/ — wrong directory for this format
        const responseAvifInJpegDir = await serveUploadFile(['jpeg', 'photo.avif']);
        expect(responseAvifInJpegDir.status).toBe(400);

        // .jpg file in /uploads/avif/ — wrong directory for this format
        const responseJpegInAvifDir = await serveUploadFile(['avif', 'photo.jpg']);
        expect(responseJpegInAvifDir.status).toBe(400);
    });

    it('denies requests that traverse through a symlinked parent directory', async () => {
        const outsideDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-upload-outside-'));
        const outsideFile = path.join(outsideDir, 'escape.jpg');
        const linkedDir = path.join(uploadRoot, 'jpeg', 'linked');

        try {
            await fsp.writeFile(outsideFile, 'outside-data');
            await fsp.symlink(outsideDir, linkedDir);

            const { serveUploadFile } = await import('@/lib/serve-upload');
            const response = await serveUploadFile(['jpeg', 'linked', 'escape.jpg']);

            expect(response.status).toBe(403);
        } finally {
            await fsp.rm(outsideDir, { recursive: true, force: true });
        }
    });
});
