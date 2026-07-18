import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import { imageUrl, sizedImageCandidates, sizedImageFilename, sizedImageSrcSet, sizedImageUrl } from '@/lib/image-url';

/**
 * COR-R4C16-03 / TEST-R4C16-03: the image base resolves per-runtime —
 * server reads the IMAGE_BASE_URL env (module constant); the browser
 * reads the `data-image-base` attribute stamped on `<html>` by the
 * locale layout (client bundles cannot see non-NEXT_PUBLIC env vars —
 * the compiled chunk does a runtime `process.env` lookup against the
 * browser shim, which is always empty).
 */
describe('imageUrl base resolution (COR-R4C16-03)', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('browser: uses the data-image-base attribute stamped on <html>', () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', {
            documentElement: { dataset: { imageBase: 'https://cdn.example.com' } },
        });
        expect(imageUrl('/uploads/jpeg/a.jpg')).toBe('https://cdn.example.com/uploads/jpeg/a.jpg');
    });

    it('browser: normalizes trailing slashes on the stamped base', () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', {
            documentElement: { dataset: { imageBase: 'https://cdn.example.com/' } },
        });
        expect(imageUrl('uploads/jpeg/a.jpg')).toBe('https://cdn.example.com/uploads/jpeg/a.jpg');
    });

    it('browser: falls back to relative paths when the attribute is absent (env unset)', () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', { documentElement: { dataset: {} } });
        expect(imageUrl('/uploads/jpeg/a.jpg')).toBe('/uploads/jpeg/a.jpg');
    });

    it('browser: ignores malformed or credential-bearing stamped bases', () => {
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', {
            documentElement: { dataset: { imageBase: 'https://user:pass@cdn.example.com?token=x' } },
        });
        expect(imageUrl('/uploads/jpeg/a.jpg')).toBe('/uploads/jpeg/a.jpg');
    });

    it('browser: recomputes the cached base when the stamped raw value changes', () => {
        const dataset = { imageBase: 'https://cdn-a.example.com' };
        vi.stubGlobal('window', {});
        vi.stubGlobal('document', { documentElement: { dataset } });

        expect(imageUrl('/uploads/jpeg/a.jpg')).toBe('https://cdn-a.example.com/uploads/jpeg/a.jpg');
        dataset.imageBase = 'https://cdn-b.example.com';
        expect(imageUrl('/uploads/jpeg/a.jpg')).toBe('https://cdn-b.example.com/uploads/jpeg/a.jpg');
    });

    it('server: reads the IMAGE_BASE_URL env via the module constant', async () => {
        vi.stubEnv('IMAGE_BASE_URL', 'https://cdn.example.com');
        vi.resetModules();
        const fresh = await import('@/lib/image-url');
        expect(typeof document).toBe('undefined');
        expect(fresh.imageUrl('/uploads/jpeg/a.jpg')).toBe('https://cdn.example.com/uploads/jpeg/a.jpg');
        vi.resetModules();
    });

    it('server: falls back to relative paths for credential-bearing IMAGE_BASE_URL values', async () => {
        vi.stubEnv('IMAGE_BASE_URL', 'https://user:pass@cdn.example.com?token=x');
        vi.resetModules();
        const fresh = await import('@/lib/image-url');
        expect(fresh.imageUrl('/uploads/jpeg/a.jpg')).toBe('/uploads/jpeg/a.jpg');
        vi.resetModules();
    });

    it('wiring: the locale layout stamps data-image-base on <html> (injection lock)', () => {
        // Source-inspection lock: a layout refactor that drops the stamp
        // would sever the browser-side resolution while every unit test
        // above stays green — fail loud here instead.
        const layoutSource = fs.readFileSync(
            path.resolve(__dirname, '..', 'app', '[locale]', 'layout.tsx'),
            'utf8',
        );
        expect(layoutSource).toContain('data-image-base={IMAGE_BASE_URL || undefined}');
        expect(layoutSource).not.toContain('process.env.IMAGE_BASE_URL');
    });
});

describe('sizedImageFilename', () => {
    it('uses the nearest configured derivative size for the requested target', () => {
        expect(sizedImageFilename('sample.jpg', 48, [640, 1536, 2048])).toBe('sample_640.jpg');
        expect(sizedImageFilename('sample.webp', 1700, [640, 1536, 2048])).toBe('sample_1536.webp');
    });

    it('returns the original filename when no extension is present', () => {
        expect(sizedImageFilename('sample', 48, [640, 1536])).toBe('sample');
    });
});

describe('sizedImageUrl', () => {
    it('builds a derivative URL inside the requested directory', () => {
        expect(sizedImageUrl('/uploads/jpeg', 'sample.jpg', 128, [640, 1536, 2048])).toBe(
            imageUrl('/uploads/jpeg/sample_640.jpg')
        );
    });
});

describe('sizedImageSrcSet', () => {
    it('builds a srcSet from the configured derivative sizes', () => {
        expect(sizedImageSrcSet('/uploads/jpeg', 'sample.jpg', 3000, [640, 1536, 2048])).toBe(
            [
                `${imageUrl('/uploads/jpeg/sample_640.jpg')} 640w`,
                `${imageUrl('/uploads/jpeg/sample_1536.jpg')} 1536w`,
                `${imageUrl('/uploads/jpeg/sample_2048.jpg')} 2048w`,
            ].join(', ')
        );
    });

    it('keeps every normalized configured width in the responsive ladder', () => {
        expect(sizedImageSrcSet('/uploads/avif', 'sample.avif', 2000, [128, 256, 640, 1536])).toBe(
            [
                `${imageUrl('/uploads/avif/sample_128.avif')} 128w`,
                `${imageUrl('/uploads/avif/sample_256.avif')} 256w`,
                `${imageUrl('/uploads/avif/sample_640.avif')} 640w`,
                `${imageUrl('/uploads/avif/sample_1536.avif')} 1536w`,
            ].join(', ')
        );
        expect(sizedImageSrcSet('/uploads/webp', 'sample.webp', 2000, [640])).toBe(
            `${imageUrl('/uploads/webp/sample_640.webp')} 640w`
        );
        expect(sizedImageSrcSet('/uploads/jpeg', 'sample.jpg', 2000, [640, 1536])).toBe(
            `${imageUrl('/uploads/jpeg/sample_640.jpg')} 640w, ${imageUrl('/uploads/jpeg/sample_1536.jpg')} 1536w`
        );
    });

    it('labels and deduplicates source-limited aliases by delivered pixels', () => {
        expect(sizedImageCandidates('/uploads/jpeg', 'sample.jpg', 1200, [640, 1536, 2048, 4096])).toEqual([
            { url: imageUrl('/uploads/jpeg/sample_640.jpg'), width: 640 },
            { url: imageUrl('/uploads/jpeg/sample_1536.jpg'), width: 1200 },
        ]);
        expect(sizedImageSrcSet('/uploads/jpeg', 'sample.jpg', 1200, [640, 1536, 2048, 4096])).toBe(
            `${imageUrl('/uploads/jpeg/sample_640.jpg')} 640w, ${imageUrl('/uploads/jpeg/sample_1536.jpg')} 1200w`
        );
    });

    it('uses the first alias for sources below the smallest configured width', () => {
        expect(sizedImageSrcSet('/uploads/webp', 'sample.webp', 96, [640, 1536])).toBe(
            `${imageUrl('/uploads/webp/sample_640.webp')} 96w`
        );
    });

    it('normalizes alias order and returns no guessed ladder without a delivered maximum', () => {
        expect(sizedImageSrcSet('/uploads/avif', 'sample.avif', 1000, [1536, 640, 640])).toBe(
            `${imageUrl('/uploads/avif/sample_640.avif')} 640w, ${imageUrl('/uploads/avif/sample_1536.avif')} 1000w`
        );
        expect(sizedImageSrcSet('/uploads/avif', 'sample.avif', null, [640, 1536])).toBe('');
    });
});
