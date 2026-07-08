import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * PERF-R4C15-02 / TEST-R4C15-03 (run-4 cycle 15) source-inspection lock
 * (repo convention, cf. wide-gamut-predicate-wiring.test.ts).
 *
 * The map popup thumbnail must follow the R21-M1 / R22-M1 / R23-M1
 * sized-derivative contract owned by `lib/image-url.ts`:
 *   - request the nearest configured derivative for the rendered size
 *     (128 px target) instead of the full-resolution base JPEG;
 *   - route through imageUrl()/sizedImageUrl() so IMAGE_BASE_URL
 *     (CDN-fronted deployments) is honored — the pre-fix popup was the
 *     ONLY image surface in src/ interpolating `/uploads/jpeg/${…}`
 *     raw;
 *   - fall back one-shot to the base filename on error (legacy photos
 *     mid-backfill may lack sized derivatives; the encoder
 *     atomic-rename contract guarantees the base exists).
 *
 * The real configured `image_sizes` must flow page → MapLoader →
 * MapClient: defaulting to DEFAULT_IMAGE_SIZES at the call site would
 * silently 404→fallback on every popup under a reconfigured admin
 * `image_sizes`, re-creating the full-res download this contract
 * exists to prevent.
 */

const srcRoot = path.resolve(__dirname, '..');

async function read(rel: string): Promise<string> {
    return readFile(path.resolve(srcRoot, rel), 'utf8');
}

describe('map popup thumbnail wiring (PERF-R4C15-02)', () => {
    it('map-client routes thumbnail URLs through lib/image-url helpers', async () => {
        const source = await read('components/map/map-client.tsx');
        expect(source).toMatch(/from '@\/lib\/image-url'/);
        expect(source).toMatch(/sizedImageUrl\(/);
        expect(source).toMatch(/\bimageUrl\(/);
        // No surviving raw base-JPEG interpolation in JSX src attributes.
        expect(source).not.toMatch(/src=\{`\/uploads\/jpeg\//);
        // One-shot error fallback present (R23-M1 idiom).
        expect(source).toMatch(/onError/);
    });

    it('map-client and map-loader prop surfaces carry imageSizes', async () => {
        const client = await read('components/map/map-client.tsx');
        const loader = await read('components/map/map-loader.tsx');
        expect(client).toMatch(/imageSizes:\s*number\[\]/);
        expect(loader).toMatch(/imageSizes:\s*number\[\]/);
        expect(loader).toMatch(/loadingLabel:\s*string/);
    });

    it('map page passes the configured imageSizes from getGalleryConfig', async () => {
        const page = await read('app/[locale]/(public)/map/page.tsx');
        expect(page).toMatch(/getGalleryConfig/);
        expect(page).toMatch(/imageSizes=\{config\.imageSizes\}/);
        expect(page).toMatch(/loadingLabel=\{t\('loading'\)\}/);
    });

    it('map markers use localized display titles instead of raw numeric accessible fallbacks', async () => {
        const client = await read('components/map/map-client.tsx');
        const page = await read('app/[locale]/(public)/map/page.tsx');
        expect(client).toMatch(/displayTitle:\s*string/);
        expect(client).toContain('alt={marker.displayTitle}');
        expect(client).toContain('aria-label={`${openPhotoLabel}: ${marker.displayTitle}`}');
        expect(client).not.toContain('String(marker.id)');
        expect(client).not.toContain('marker.title ?? marker.id');
        expect(page).toContain("const tPhoto = await getTranslations('photo')");
        expect(page).toMatch(/from '@\/lib\/photo-title'/);
        expect(page).toContain('getPhotoDisplayTitle(');
        expect(page).toContain("tPhoto('titleWithId', { id: img.id })");
        expect(page).not.toContain("displayTitle: img.title ?? tPhoto('titleWithId', { id: img.id })");
        expect(page).toContain('{marker.displayTitle}');
        expect(page).toContain('{marker.topic_label ?? marker.topic}');
        expect(page).not.toContain("`${t('openPhoto')} ${marker.id}`");
    });

    it('map-loader provides a localized status fallback for the dynamic chunk', async () => {
        const loader = await read('components/map/map-loader.tsx');
        expect(loader).toContain('Suspense');
        expect(loader).toContain('role="status"');
        expect(loader).toContain('{label}');
        expect(loader).toContain('animate-pulse');
    });

    it('scopes Leaflet controls and marker hit areas to the 44 px touch-target floor', async () => {
        const client = await read('components/map/map-client.tsx');
        const globals = await read('app/[locale]/globals.css');
        expect(client).toContain('className="gallery-map z-0"');
        for (const selector of [
            '.gallery-map .leaflet-control-zoom a',
            '.gallery-map .leaflet-control-attribution a',
            '.gallery-map .leaflet-popup-close-button',
            '.gallery-map .leaflet-marker-icon',
        ]) {
            expect(globals).toContain(selector);
        }
        expect(globals).toContain('min-width: 44px !important');
        expect(globals).toContain('min-height: 44px !important');
    });
});
