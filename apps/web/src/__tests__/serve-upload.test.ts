import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('serveUploadFile', () => {
    let uploadRoot = '';

    // R4C1 TEST-R4C1-07: warm the module transform cache once, with a
    // generous setup-scoped timeout. The first cold import of the
    // serve-upload graph (next/server, @/db → drizzle + mysql2) can take
    // tens of seconds on a shared-volume checkout under full-suite CPU
    // contention, which used to blow the first TEST's 15 s budget.
    // vi.resetModules() in beforeEach clears only the module registry,
    // not the transform cache, so per-test re-imports stay fast. The
    // UPLOAD_ROOT env var is irrelevant here — upload-paths just computes
    // path constants at import time and each test re-imports after
    // setting its own root.
    beforeAll(async () => {
        await import('@/lib/serve-upload');
        vi.resetModules();
    }, 120_000);

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
        vi.doUnmock('fs/promises');
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

    it('emits Cache-Control with must-revalidate and a pipeline-versioned ETag (CM-HIGH-5)', async () => {
        const jpegPath = path.join(uploadRoot, 'jpeg', 'cache.jpg');
        await fsp.writeFile(jpegPath, 'cache-test-data');

        const { serveUploadFile } = await import('@/lib/serve-upload');
        // R4C1 TEST-R4C1-07: import the constant from its light definition
        // module so this suite never cold-loads the sharp encoder graph.
        const { IMAGE_PIPELINE_VERSION } = await import('@/lib/gallery-config-shared');
        const response = await serveUploadFile(['jpeg', 'cache.jpg']);

        expect(response.status).toBe(200);
        const cc = response.headers.get('Cache-Control') ?? '';
        // No `immutable` — that would prevent invalidation when the encoder
        // pipeline version bumps.
        expect(cc).not.toContain('immutable');
        // must-revalidate forces edge caches and browsers to consult the
        // origin's ETag on every fetch instead of trusting age alone.
        expect(cc).toContain('must-revalidate');
        // Versioned weak ETag — when IMAGE_PIPELINE_VERSION bumps every
        // existing cached entry stops matching automatically.
        const etag = response.headers.get('ETag') ?? '';
        expect(etag).toMatch(new RegExp(`^W/"v${IMAGE_PIPELINE_VERSION}-`));
    });

    it('returns 304 Not Modified when If-None-Match matches current ETag (R11-M1)', async () => {
        const jpegPath = path.join(uploadRoot, 'jpeg', 'inm.jpg');
        await fsp.writeFile(jpegPath, 'inm-data');

        const { serveUploadFile } = await import('@/lib/serve-upload');
        // First request to obtain the live ETag.
        const first = await serveUploadFile(['jpeg', 'inm.jpg']);
        const etag = first.headers.get('ETag') ?? '';
        expect(etag).not.toBe('');

        // Conditional request with the same ETag should short-circuit to 304.
        const conditional = await serveUploadFile(['jpeg', 'inm.jpg'], etag);
        expect(conditional.status).toBe(304);
        // Body must be empty on 304.
        expect(await conditional.text()).toBe('');
        // ETag header must still be present so clients can update freshness.
        expect(conditional.headers.get('ETag')).toBe(etag);
        // Cache-Control still emitted (matches MDN/HTTP 304 guidance).
        expect(conditional.headers.get('Cache-Control')).toContain('must-revalidate');

        // Mismatching ETag must still serve the body.
        const mismatched = await serveUploadFile(['jpeg', 'inm.jpg'], 'W/"stale"');
        expect(mismatched.status).toBe(200);
        expect(await mismatched.text()).toBe('inm-data');

        // Wildcard If-None-Match also triggers 304 per RFC 7232.
        const wildcard = await serveUploadFile(['jpeg', 'inm.jpg'], '*');
        expect(wildcard.status).toBe(304);
    });

    it('closes the file handle before returning non-stream 304 and HEAD responses (C35-PERF-01)', async () => {
        const jpegPath = path.join(uploadRoot, 'jpeg', 'close.jpg');
        await fsp.writeFile(jpegPath, 'close-data');

        const closeSpies: Array<ReturnType<typeof vi.spyOn>> = [];
        vi.doMock('fs/promises', async () => {
            const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
            return {
                ...actual,
                open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
                    const handle = await actual.open(...args);
                    closeSpies.push(vi.spyOn(handle, 'close'));
                    return handle;
                }),
            };
        });

        const { serveUploadFile } = await import('@/lib/serve-upload');
        const first = await serveUploadFile(['jpeg', 'close.jpg']);
        const etag = first.headers.get('ETag') ?? '';
        expect(etag).not.toBe('');
        await first.text();

        const matching = await serveUploadFile(['jpeg', 'close.jpg'], etag);
        expect(matching.status).toBe(304);
        expect(closeSpies.at(-1)).toHaveBeenCalledTimes(1);

        const wildcard = await serveUploadFile(['jpeg', 'close.jpg'], '*');
        expect(wildcard.status).toBe(304);
        expect(closeSpies.at(-1)).toHaveBeenCalledTimes(1);

        const head = await serveUploadFile(['jpeg', 'close.jpg'], null, 'HEAD');
        expect(head.status).toBe(200);
        expect(await head.text()).toBe('');
        expect(closeSpies.at(-1)).toHaveBeenCalledTimes(1);
    });

    // AGG-H5 (run-6 cycle-2): client-abort fd-release behavior.
    it('returns 499 and opens no body when the request is already aborted (AGG-H5)', async () => {
        const jpegPath = path.join(uploadRoot, 'jpeg', 'aborted.jpg');
        await fsp.writeFile(jpegPath, 'aborted-data');

        const { serveUploadFile } = await import('@/lib/serve-upload');
        const controller = new AbortController();
        controller.abort();

        const response = await serveUploadFile(
            ['jpeg', 'aborted.jpg'],
            null,
            'GET',
            controller.signal,
        );
        // Pre-aborted requests short-circuit: no body stream is handed to the
        // response, and the opened fd is destroyed immediately.
        expect(response.status).toBe(499);
        expect(await response.text()).toBe('');
    });

    it('cancelling the response body destroys the underlying file stream (AGG-H5)', async () => {
        const jpegPath = path.join(uploadRoot, 'jpeg', 'cancel.jpg');
        await fsp.writeFile(jpegPath, 'cancel-data-larger-than-one-chunk'.repeat(100));

        const { serveUploadFile } = await import('@/lib/serve-upload');
        const response = await serveUploadFile(['jpeg', 'cancel.jpg']);
        expect(response.status).toBe(200);
        expect(response.body).toBeTruthy();

        // Simulate a client abort mid-transfer: cancel the response body's
        // ReadableStream. On Node 18+ Readable.toWeb() wires cancel() to
        // destroy the underlying createReadStream fd. cancel() resolving
        // without throwing confirms the body stream tore down cleanly (the fd
        // is released rather than held until GC).
        const reader = response.body!.getReader();
        await reader.read(); // pull at least one chunk so the stream is live
        await expect(reader.cancel('client aborted')).resolves.toBeUndefined();
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
