/**
 * Gallery Configuration Module
 *
 * Centralized source of truth for all configurable gallery parameters.
 * Reads from the admin_settings table with environment variable fallbacks.
 * Uses React cache() for SSR deduplication within a single request.
 *
 * IMPORTANT: This module imports from @/db and is SERVER-ONLY.
 * For client-safe constants/types/validators, use gallery-config-shared.ts.
 */

import { db, adminSettings } from '@/db';
import { inArray } from 'drizzle-orm';
import { cache } from 'react';

// Re-export shared constants, types, and validators for server-side consumers
export {
    GALLERY_SETTING_KEYS,
    type GallerySettingKey,
    isValidSettingValue,
    getSettingDefaults,
    parseImageSizes,
    parseSlideshowInterval,
} from './gallery-config-shared';

import { GALLERY_SETTING_KEYS, getSettingDefaults, isJpegChromaSubsampling, isValidSettingValue, parseImageSizes, parseSlideshowInterval } from './gallery-config-shared';
import type { GallerySettingKey, JpegChromaSubsampling } from './gallery-config-shared';

// ── Defaults (imported from shared module to avoid duplication) ────────────────
const DEFAULTS = getSettingDefaults();

// ── Typed Getters ─────────────────────────────────────────────────────────────

async function getSettingsMap(): Promise<Map<string, string>> {
    const rows = await db.select({ key: adminSettings.key, value: adminSettings.value })
        .from(adminSettings)
        .where(inArray(adminSettings.key, [...GALLERY_SETTING_KEYS]));

    return new Map(rows.map(r => [r.key, r.value]));
}

function getSetting(map: Map<string, string>, key: GallerySettingKey): string {
    return map.get(key) || DEFAULTS[key];
}

// ── Cached Config Interface ───────────────────────────────────────────────────

export interface GalleryConfig {
    // Image Processing
    imageQualityWebp: number;
    imageQualityAvif: number;
    imageQualityJpeg: number;
    imageSizes: number[];

    // Privacy
    stripGpsOnUpload: boolean;

    // Slideshow
    slideshowIntervalSeconds: number;

    // US-P52: Auto alt-text (ONNX stub, opt-in)
    autoAltTextEnabled: boolean;

    // US-P51: CLIP semantic search mode. 'production' is a real served mode in the
    // code, but AGG-C10-02: a stored 'production' HEALS to 'disabled' in the resolver
    // unless SEMANTIC_SEARCH_ALLOW_PRODUCTION=true is set (operator-only, off by
    // default). The admin Settings UI offers only Disabled/Stub by design, so the
    // resolved value an unprivileged deploy ever sees is 'disabled' | 'stub'.
    semanticSearchMode: 'disabled' | 'stub' | 'production';

    // US-CM02: force sRGB derivatives for legacy embedder compatibility
    forceSrgbDerivatives: boolean;

    // P3-2: allow HDR (PQ/HLG) source ingest
    allowHdrIngest: boolean;

    // P3-26: force color gamut/HDR chips visible even on sRGB displays
    forceShowColorChips: boolean;

    // P3-20: JPEG chroma subsampling for wide-gamut sources
    wideGamutJpegChroma: JpegChromaSubsampling;

    // P3-21: AVIF encoding effort (4-9)
    avifEffort: number;

    // C2-A5 / C2-COL-MED-2: JPEG chroma subsampling for sRGB / non-wide-gamut sources
    sdrJpegChroma: JpegChromaSubsampling;

    // C2-A6 / C2-INT-MED-1: max source pixel count before WI-15 downscale
    wideGamutMaxSourcePixels: number;
}

/**
 * Parse a numeric setting with validation and fallback.
 * If the DB value is corrupted or invalid, falls back to the default.
 */
function validatedNumber(map: Map<string, string>, key: GallerySettingKey): number {
    const raw = getSetting(map, key);
    if (!isValidSettingValue(key, raw)) return Number(DEFAULTS[key]);
    return Number(raw);
}

async function _getGalleryConfig(): Promise<GalleryConfig> {
    try {
        const map = await getSettingsMap();

        // Use parseImageSizes for sorted output and invalid-input fallback (C13-01)
        const imageSizes = parseImageSizes(getSetting(map, 'image_sizes'));

        return {
            imageQualityWebp: validatedNumber(map, 'image_quality_webp'),
            imageQualityAvif: validatedNumber(map, 'image_quality_avif'),
            imageQualityJpeg: validatedNumber(map, 'image_quality_jpeg'),
            imageSizes,
            stripGpsOnUpload: (() => {
                const raw = getSetting(map, 'strip_gps_on_upload');
                if (!isValidSettingValue('strip_gps_on_upload', raw)) return DEFAULTS.strip_gps_on_upload === 'true';
                return raw === 'true';
            })(),
            slideshowIntervalSeconds: parseSlideshowInterval(getSetting(map, 'slideshow_interval_seconds')),
            autoAltTextEnabled: (() => {
                const raw = getSetting(map, 'auto_alt_text_enabled');
                if (!isValidSettingValue('auto_alt_text_enabled', raw)) return DEFAULTS.auto_alt_text_enabled === 'true';
                return raw === 'true';
            })(),
            semanticSearchMode: (() => {
                const raw = getSetting(map, 'semantic_search_mode');
                // An invalid/unknown raw value falls back to the default ('disabled').
                if (!isValidSettingValue('semantic_search_mode', raw)) return DEFAULTS.semantic_search_mode as 'disabled' | 'stub' | 'production';
                const value = raw as 'disabled' | 'stub' | 'production';
                // AGG-C10-02 (run-6 cycle-1) / AGG-C9-05 (run-6 cycle-9): the CLIP
                // 'production' mode is OPERATOR-GATED — it is a real, served mode (LIVE
                // in the demo deployment) but it must NOT be activatable through the
                // ordinary admin Settings UI (which intentionally offers only
                // Disabled/Stub). So a stored 'production' value HEALS to 'disabled'
                // unless an operator has set the explicit env opt-in
                // SEMANTIC_SEARCH_ALLOW_PRODUCTION=true. This keeps the admin UI's
                // documented invariant ("production is treated as Disabled") TRUE for
                // every deploy that has not opted in, while preserving the deliberate,
                // non-UI operator activation path (env flag + DB row + weights + backfill).
                if (value === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') {
                    return 'disabled';
                }
                return value;
            })(),
            forceSrgbDerivatives: (() => {
                const raw = getSetting(map, 'force_srgb_derivatives');
                if (!isValidSettingValue('force_srgb_derivatives', raw)) return DEFAULTS.force_srgb_derivatives === 'true';
                return raw === 'true';
            })(),
            allowHdrIngest: (() => {
                const raw = getSetting(map, 'allow_hdr_ingest');
                if (!isValidSettingValue('allow_hdr_ingest', raw)) return DEFAULTS.allow_hdr_ingest === 'true';
                return raw === 'true';
            })(),
            forceShowColorChips: (() => {
                const raw = getSetting(map, 'force_show_color_chips');
                if (!isValidSettingValue('force_show_color_chips', raw)) return DEFAULTS.force_show_color_chips === 'true';
                return raw === 'true';
            })(),
            wideGamutJpegChroma: (() => {
                const raw = getSetting(map, 'wide_gamut_jpeg_chroma');
                // C3-A6: validator already enforces the union; the runtime
                // guard re-narrows the type so consumers see
                // JpegChromaSubsampling instead of `string`.
                if (isJpegChromaSubsampling(raw)) return raw;
                const fallback = DEFAULTS.wide_gamut_jpeg_chroma;
                return isJpegChromaSubsampling(fallback) ? fallback : '4:4:4';
            })(),
            avifEffort: validatedNumber(map, 'avif_effort'),
            // C2-A5: SDR JPEG chroma — defaults to 4:2:0 for backward-compat file size
            sdrJpegChroma: (() => {
                const raw = getSetting(map, 'sdr_jpeg_chroma');
                if (isJpegChromaSubsampling(raw)) return raw;
                const fallback = DEFAULTS.sdr_jpeg_chroma;
                return isJpegChromaSubsampling(fallback) ? fallback : '4:2:0';
            })(),
            // C2-A6: wide-gamut max source pixels — defaults to 50 MP
            wideGamutMaxSourcePixels: validatedNumber(map, 'wide_gamut_max_source_pixels'),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[gallery-config] Falling back to defaults because admin_settings could not be read: ${message}`);

        return {
            imageQualityWebp: Number(DEFAULTS.image_quality_webp),
            imageQualityAvif: Number(DEFAULTS.image_quality_avif),
            imageQualityJpeg: Number(DEFAULTS.image_quality_jpeg),
            imageSizes: parseImageSizes(DEFAULTS.image_sizes),
            stripGpsOnUpload: DEFAULTS.strip_gps_on_upload === 'true',
            slideshowIntervalSeconds: parseSlideshowInterval(DEFAULTS.slideshow_interval_seconds),
            autoAltTextEnabled: DEFAULTS.auto_alt_text_enabled === 'true',
            semanticSearchMode: (() => {
                const raw = DEFAULTS.semantic_search_mode as 'disabled' | 'stub' | 'production';
                // Apply the same operator-gate check as the happy path (line 141).
                if (raw === 'production' && process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] !== 'true') {
                    return 'disabled';
                }
                return raw;
            })(),
            forceSrgbDerivatives: DEFAULTS.force_srgb_derivatives === 'true',
            allowHdrIngest: DEFAULTS.allow_hdr_ingest === 'true',
            forceShowColorChips: DEFAULTS.force_show_color_chips === 'true',
            wideGamutJpegChroma: isJpegChromaSubsampling(DEFAULTS.wide_gamut_jpeg_chroma)
                ? DEFAULTS.wide_gamut_jpeg_chroma
                : '4:4:4',
            avifEffort: Number(DEFAULTS.avif_effort),
            sdrJpegChroma: isJpegChromaSubsampling(DEFAULTS.sdr_jpeg_chroma)
                ? DEFAULTS.sdr_jpeg_chroma
                : '4:2:0',
            wideGamutMaxSourcePixels: Number(DEFAULTS.wide_gamut_max_source_pixels),
        };
    }
}

/** Cached gallery config — deduped within a single SSR request via React cache(). */
export const getGalleryConfig = cache(_getGalleryConfig);
