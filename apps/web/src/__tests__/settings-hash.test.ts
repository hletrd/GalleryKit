/**
 * Color settings hash tests (P4-E2 / R4-L3 / FA-L1).
 *
 * The hash is folded into the ETag so a change to any color-impacting
 * setting forces a 304 → 200 revalidation cycle on every cached
 * client. The contract here:
 *
 *   - 8-character hex prefix (no extra chars to keep ETag width
 *     bounded).
 *   - Stable for identical inputs across calls.
 *   - Different for different inputs.
 *   - Same when input keys are reordered (we control the iteration
 *     order in `buildHash`).
 */

import { describe, it, expect } from 'vitest';
import { _buildHashForTesting, getColorSettingsHash, COLOR_IMPACTING_KEYS } from '@/lib/settings-hash';
import type { GalleryConfig } from '@/lib/gallery-config';

describe('COLOR_IMPACTING_KEYS exhaustiveness (R16C16 TE-16-04)', () => {
    it('contains exactly the 9 documented byte-impacting keys', () => {
        // CLAUDE.md ETag section: 9 COLOR_IMPACTING_KEYS (5 color + 3 quality +
        // image_sizes). The compile-time guard only checks each entry is a valid
        // setting key, not completeness; this pins the exact set so a forgotten
        // new byte-impacting key (which would silently fail serve-upload ETag
        // invalidation) is caught at npm test.
        const expected = [
            'avif_effort',
            'force_srgb_derivatives',
            'image_quality_avif',
            'image_quality_jpeg',
            'image_quality_webp',
            'image_sizes',
            'sdr_jpeg_chroma',
            'wide_gamut_jpeg_chroma',
            'wide_gamut_max_source_pixels',
        ];
        expect([...COLOR_IMPACTING_KEYS].sort()).toEqual(expected);
    });
});

describe('color settings hash (P4-E2)', () => {
    it('returns 8 lowercase hex characters', () => {
        const hash = _buildHashForTesting({});
        expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('is stable for identical inputs', () => {
        const a = _buildHashForTesting({ avif_effort: '4', wide_gamut_jpeg_chroma: '4:4:4' });
        const b = _buildHashForTesting({ avif_effort: '4', wide_gamut_jpeg_chroma: '4:4:4' });
        expect(a).toBe(b);
    });

    it('is the same regardless of input map ordering', () => {
        // Object property iteration order is insertion order in V8 for
        // string keys, but we want the hash to depend on the canonical
        // key list — never on caller-side ordering.
        const a = _buildHashForTesting({
            wide_gamut_jpeg_chroma: '4:4:4',
            avif_effort: '4',
            force_srgb_derivatives: 'false',
        });
        const b = _buildHashForTesting({
            force_srgb_derivatives: 'false',
            avif_effort: '4',
            wide_gamut_jpeg_chroma: '4:4:4',
        });
        expect(a).toBe(b);
    });

    it('differs when wide_gamut_jpeg_chroma flips', () => {
        const a = _buildHashForTesting({ wide_gamut_jpeg_chroma: '4:4:4' });
        const b = _buildHashForTesting({ wide_gamut_jpeg_chroma: '4:2:0' });
        expect(a).not.toBe(b);
    });

    it('differs when avif_effort changes', () => {
        const a = _buildHashForTesting({ avif_effort: '4' });
        const b = _buildHashForTesting({ avif_effort: '6' });
        expect(a).not.toBe(b);
    });

    it('differs when force_srgb_derivatives flips', () => {
        const a = _buildHashForTesting({ force_srgb_derivatives: 'false' });
        const b = _buildHashForTesting({ force_srgb_derivatives: 'true' });
        expect(a).not.toBe(b);
    });

    it('differs when sdr_jpeg_chroma flips', () => {
        const a = _buildHashForTesting({ sdr_jpeg_chroma: '4:2:0' });
        const b = _buildHashForTesting({ sdr_jpeg_chroma: '4:4:4' });
        expect(a).not.toBe(b);
    });

    it('differs when wide_gamut_max_source_pixels changes', () => {
        const a = _buildHashForTesting({ wide_gamut_max_source_pixels: '50000000' });
        const b = _buildHashForTesting({ wide_gamut_max_source_pixels: '25000000' });
        expect(a).not.toBe(b);
    });

    it('differs when image_quality_webp changes', () => {
        const a = _buildHashForTesting({ image_quality_webp: '85' });
        const b = _buildHashForTesting({ image_quality_webp: '90' });
        expect(a).not.toBe(b);
    });

    it('differs when image_quality_avif changes', () => {
        const a = _buildHashForTesting({ image_quality_avif: '80' });
        const b = _buildHashForTesting({ image_quality_avif: '85' });
        expect(a).not.toBe(b);
    });

    it('differs when image_quality_jpeg changes', () => {
        const a = _buildHashForTesting({ image_quality_jpeg: '90' });
        const b = _buildHashForTesting({ image_quality_jpeg: '95' });
        expect(a).not.toBe(b);
    });

    it('differs when image_sizes changes', () => {
        const a = _buildHashForTesting({ image_sizes: '640,1536,2048,4096' });
        const b = _buildHashForTesting({ image_sizes: '640,1024,2048' });
        expect(a).not.toBe(b);
    });

    // C7-17 (run-10 cycle 7b): AGG-R7C3-02 documents that image_sizes is
    // normalized (sorted ascending) before hashing so display-order changes
    // in the admin UI cannot spuriously invalidate cached variants — this
    // invariant previously had no test on the raw-DB-string path.
    it('image_sizes hash is order-independent (AGG-R7C3-02)', () => {
        const ascending = _buildHashForTesting({ image_sizes: '640,1536' });
        const descending = _buildHashForTesting({ image_sizes: '1536,640' });
        expect(ascending).toBe(descending);
    });

    it('ignores keys outside the canonical set', () => {
        const a = _buildHashForTesting({ wide_gamut_jpeg_chroma: '4:4:4' });
        const b = _buildHashForTesting({ wide_gamut_jpeg_chroma: '4:4:4', irrelevant_key: 'x' });
        expect(a).toBe(b);
    });

    it('R8-H1: hash from GalleryConfig matches hash from raw DB strings for same values', async () => {
        const rawHash = _buildHashForTesting({
            wide_gamut_jpeg_chroma: '4:4:4',
            sdr_jpeg_chroma: '4:2:0',
            avif_effort: '6',
            force_srgb_derivatives: 'false',
            wide_gamut_max_source_pixels: '50000000',
            image_quality_webp: '90',
            image_quality_avif: '85',
            image_quality_jpeg: '90',
            image_sizes: '640,1536,2048,4096',
        });
        const configHash = await getColorSettingsHash({
            wideGamutJpegChroma: '4:4:4',
            sdrJpegChroma: '4:2:0',
            avifEffort: 6,
            forceSrgbDerivatives: false,
            wideGamutMaxSourcePixels: 50_000_000,
            imageQualityWebp: 90,
            imageQualityAvif: 85,
            imageQualityJpeg: 90,
            imageSizes: [640, 1536, 2048, 4096],
            stripGpsOnUpload: false,
            slideshowIntervalSeconds: 5,
            autoAltTextEnabled: false,
            semanticSearchMode: 'disabled',
            allowHdrIngest: false,
            forceShowColorChips: false,
        });
        expect(configHash).toBe(rawHash);
    });

    it('R8-H1: invalid DB value (e.g. avif=150) produces same hash as validated default (85)', async () => {
        // Raw DB says 150 (invalid), but GalleryConfig validator falls back to 85.
        // Without the config path, ETag would include 150 and misalign with encoder.
        const rawInvalidHash = _buildHashForTesting({
            wide_gamut_jpeg_chroma: '4:4:4',
            sdr_jpeg_chroma: '4:2:0',
            avif_effort: '6',
            force_srgb_derivatives: 'false',
            wide_gamut_max_source_pixels: '50000000',
            image_quality_webp: '90',
            image_quality_avif: '150', // invalid raw value
            image_quality_jpeg: '90',
            image_sizes: '640,1536,2048,4096',
        });
        const configHash = await getColorSettingsHash({
            wideGamutJpegChroma: '4:4:4',
            sdrJpegChroma: '4:2:0',
            avifEffort: 6,
            forceSrgbDerivatives: false,
            wideGamutMaxSourcePixels: 50_000_000,
            imageQualityWebp: 90,
            imageQualityAvif: 85, // validated fallback
            imageQualityJpeg: 90,
            imageSizes: [640, 1536, 2048, 4096],
            stripGpsOnUpload: false,
            slideshowIntervalSeconds: 5,
            autoAltTextEnabled: false,
            semanticSearchMode: 'disabled',
            allowHdrIngest: false,
            forceShowColorChips: false,
        });
        expect(configHash).not.toBe(rawInvalidHash);
        // The config hash should match what the raw hash would be with the validated value.
        const rawValidHash = _buildHashForTesting({
            wide_gamut_jpeg_chroma: '4:4:4',
            sdr_jpeg_chroma: '4:2:0',
            avif_effort: '6',
            force_srgb_derivatives: 'false',
            wide_gamut_max_source_pixels: '50000000',
            image_quality_webp: '90',
            image_quality_avif: '85',
            image_quality_jpeg: '90',
            image_sizes: '640,1536,2048,4096',
        });
        expect(configHash).toBe(rawValidHash);
    });

    it('C6-02: flipping each byte-impacting config field changes the config-path hash', async () => {
        // Closes the architect F1 gap: buildHashFromConfig used to hand-maintain a
        // 9-key object literal decoupled from COLOR_IMPACTING_KEYS. If a future
        // byte-impacting setting is added to COLOR_IMPACTING_KEYS but its config
        // mapper is forgotten, the serve-upload (config-arg) ETag would go
        // INVARIANT to that setting — a silent stale-derivative bug. This test
        // asserts every key's config field actually moves the hash; the mapper is
        // now also `Record<ColorImpactingKey, …>` so a missing mapper is a tsc
        // error, and the `flips` map below is likewise keyed exhaustively.
        const base: GalleryConfig = {
            wideGamutJpegChroma: '4:4:4',
            sdrJpegChroma: '4:2:0',
            avifEffort: 6,
            forceSrgbDerivatives: false,
            wideGamutMaxSourcePixels: 50_000_000,
            imageQualityWebp: 90,
            imageQualityAvif: 85,
            imageQualityJpeg: 90,
            imageSizes: [640, 1536, 2048, 4096],
            stripGpsOnUpload: false,
            slideshowIntervalSeconds: 5,
            autoAltTextEnabled: false,
            semanticSearchMode: 'disabled',
            allowHdrIngest: false,
            forceShowColorChips: false,
        };
        const baseHash = await getColorSettingsHash(base);

        const flips: Record<(typeof COLOR_IMPACTING_KEYS)[number], GalleryConfig> = {
            wide_gamut_jpeg_chroma: { ...base, wideGamutJpegChroma: '4:2:0' },
            sdr_jpeg_chroma: { ...base, sdrJpegChroma: '4:4:4' },
            avif_effort: { ...base, avifEffort: 3 },
            force_srgb_derivatives: { ...base, forceSrgbDerivatives: true },
            wide_gamut_max_source_pixels: { ...base, wideGamutMaxSourcePixels: 25_000_000 },
            image_quality_webp: { ...base, imageQualityWebp: 80 },
            image_quality_avif: { ...base, imageQualityAvif: 70 },
            image_quality_jpeg: { ...base, imageQualityJpeg: 95 },
            image_sizes: { ...base, imageSizes: [640, 1024] },
        };

        for (const key of COLOR_IMPACTING_KEYS) {
            const flippedHash = await getColorSettingsHash(flips[key]);
            expect(flippedHash, `flipping ${key} must change the config-path hash`).not.toBe(baseHash);
        }
    });
});
