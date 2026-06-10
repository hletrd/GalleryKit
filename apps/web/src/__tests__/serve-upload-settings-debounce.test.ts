import fsp from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R4C3 PERF-R4C3-05: lock the serving-path settings-hash debounce.
 *
 * React cache() scopes getGalleryConfig() to a single request and the
 * config-arg form of getColorSettingsHash() bypasses settings-hash's
 * internal cache, so before the fix EVERY derivative GET/HEAD issued its
 * own admin_settings SELECT just to compute the ETag. serve-upload now
 * resolves config + hash behind a module-scoped 5 s TTL; this suite
 * asserts (1) no re-resolution within the TTL across requests, (2)
 * re-resolution after the TTL elapses, (3) the ETag still carries the
 * config-derived hash (R8-H1 semantics preserved).
 */

const FAKE_CONFIG = {
    imageQualityWebp: 90,
    imageQualityAvif: 85,
    imageQualityJpeg: 90,
    imageSizes: [640, 1536, 2048, 4096],
    stripGpsOnUpload: false,
    slideshowIntervalSeconds: 5,
    autoAltTextEnabled: false,
    semanticSearchMode: 'disabled' as const,
    licensePrices: { editorial: 0, commercial: 0, rm: 0 },
    forceSrgbDerivatives: false,
    allowHdrIngest: false,
    forceShowColorChips: false,
    wideGamutJpegChroma: '4:4:4' as const,
    avifEffort: 6,
    sdrJpegChroma: '4:2:0' as const,
    wideGamutMaxSourcePixels: 50_000_000,
};

describe('serve-upload settings-hash debounce (R4C3 PERF-R4C3-05)', () => {
    let uploadRoot = '';

    beforeAll(async () => {
        // Warm the module transform cache (same rationale as
        // serve-upload.test.ts R4C1 TEST-R4C1-07).
        await import('@/lib/serve-upload');
        vi.resetModules();
    }, 120_000);

    beforeEach(async () => {
        uploadRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'gallery-debounce-'));
        process.env.UPLOAD_ROOT = uploadRoot;
        await fsp.mkdir(path.join(uploadRoot, 'jpeg'), { recursive: true });
        await fsp.writeFile(path.join(uploadRoot, 'jpeg', 'a.jpg'), 'jpeg-data');
        vi.resetModules();
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.doUnmock('@/lib/gallery-config');
        delete process.env.UPLOAD_ROOT;
        await fsp.rm(uploadRoot, { recursive: true, force: true });
        vi.resetModules();
    });

    async function importWithCountedConfig() {
        const getGalleryConfig = vi.fn(async () => FAKE_CONFIG);
        vi.doMock('@/lib/gallery-config', () => ({ getGalleryConfig }));
        const mod = await import('@/lib/serve-upload');
        return { serveUploadFile: mod.serveUploadFile, getGalleryConfig };
    }

    it('resolves gallery config ONCE for a burst of requests within the TTL', async () => {
        const { serveUploadFile, getGalleryConfig } = await importWithCountedConfig();

        const responses = await Promise.all([
            serveUploadFile(['jpeg', 'a.jpg']),
            serveUploadFile(['jpeg', 'a.jpg']),
            serveUploadFile(['jpeg', 'a.jpg']),
        ]);
        for (const response of responses) {
            expect(response.status).toBe(200);
        }
        // Sequential follow-up inside the TTL window — still no refetch.
        const followUp = await serveUploadFile(['jpeg', 'a.jpg']);
        expect(followUp.status).toBe(200);

        expect(getGalleryConfig).toHaveBeenCalledTimes(1);
    });

    it('re-resolves the config after the 5 s TTL elapses', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-06-11T00:00:00Z'));
        const { serveUploadFile, getGalleryConfig } = await importWithCountedConfig();

        await serveUploadFile(['jpeg', 'a.jpg']);
        expect(getGalleryConfig).toHaveBeenCalledTimes(1);

        vi.setSystemTime(new Date('2026-06-11T00:00:06Z'));
        await serveUploadFile(['jpeg', 'a.jpg']);
        expect(getGalleryConfig).toHaveBeenCalledTimes(2);
    });

    it('ETag carries the config-derived color-settings hash (R8-H1 preserved)', async () => {
        const { serveUploadFile } = await importWithCountedConfig();
        const { _buildHashForTesting } = await import('@/lib/settings-hash');

        const expectedHash = _buildHashForTesting({
            wide_gamut_jpeg_chroma: FAKE_CONFIG.wideGamutJpegChroma,
            sdr_jpeg_chroma: FAKE_CONFIG.sdrJpegChroma,
            avif_effort: String(FAKE_CONFIG.avifEffort),
            force_srgb_derivatives: String(FAKE_CONFIG.forceSrgbDerivatives),
            wide_gamut_max_source_pixels: String(FAKE_CONFIG.wideGamutMaxSourcePixels),
            image_quality_webp: String(FAKE_CONFIG.imageQualityWebp),
            image_quality_avif: String(FAKE_CONFIG.imageQualityAvif),
            image_quality_jpeg: String(FAKE_CONFIG.imageQualityJpeg),
            image_sizes: FAKE_CONFIG.imageSizes.join(','),
        });

        const response = await serveUploadFile(['jpeg', 'a.jpg']);
        expect(response.status).toBe(200);
        const etag = response.headers.get('ETag') ?? '';
        expect(etag.endsWith(`-${expectedHash}"`)).toBe(true);
    });
});
