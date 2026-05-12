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
import { _buildHashForTesting } from '@/lib/settings-hash';

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

    it('ignores keys outside the canonical set', () => {
        const a = _buildHashForTesting({ wide_gamut_jpeg_chroma: '4:4:4' });
        const b = _buildHashForTesting({ wide_gamut_jpeg_chroma: '4:4:4', irrelevant_key: 'x' });
        expect(a).toBe(b);
    });
});
