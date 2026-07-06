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

import { GALLERY_SETTING_KEYS, getSettingDefaults, isJpegChromaSubsampling, isValidSettingValue, parseImageSizes, parseSlideshowInterval, resolveSemanticSearchMode } from './gallery-config-shared';
import type { GallerySettingKey, JpegChromaSubsampling, SemanticSearchMode } from './gallery-config-shared';

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
    return map.get(key) ?? DEFAULTS[key];
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
    semanticSearchMode: SemanticSearchMode;

    // US-CM02: force sRGB derivatives for legacy embedder compatibility
    forceSrgbDerivatives: boolean;

    // P3-2: allow HDR (PQ/HLG) source ingest
    allowHdrIngest: boolean;

    // P3-26: force color gamut/HDR chips visible even on sRGB displays
    forceShowColorChips: boolean;

    // P3-20: JPEG chroma subsampling for wide-gamut sources
    wideGamutJpegChroma: JpegChromaSubsampling;

    // P3-21: AVIF encoding effort (0-9)
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

function buildGalleryConfig(map: Map<string, string>): GalleryConfig {
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
        semanticSearchMode: resolveSemanticSearchMode(
            getSetting(map, 'semantic_search_mode'),
            process.env['SEMANTIC_SEARCH_ALLOW_PRODUCTION'] === 'true',
        ),
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
}

function getDefaultGalleryConfig(): GalleryConfig {
    return buildGalleryConfig(new Map());
}

async function _getGalleryConfig(): Promise<GalleryConfig> {
    try {
        return buildGalleryConfig(await getSettingsMap());
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[gallery-config] Falling back to defaults because admin_settings could not be read: ${message}`);
        return getDefaultGalleryConfig();
    }
}

/**
 * Strict gallery config for ingest/write paths. Upload privacy and processing
 * settings must fail closed if admin_settings cannot be read.
 */
export async function getGalleryConfigStrict(): Promise<GalleryConfig> {
    return buildGalleryConfig(await getSettingsMap());
}

/**
 * Uncached gallery config accessor for detached background contexts (WP19,
 * C2-10, run-10 cycle-2).
 *
 * React's `cache()` (used by `getGalleryConfig` below) de-dupes lookups
 * within the AsyncLocalStorage store React maintains for the lifetime of a
 * single request. Code that runs OUTSIDE a request — PQueue job closures,
 * `setInterval`/`setTimeout` callbacks, restore-maintenance resume — has no
 * such store, so a `cache()`-wrapped call there can memoize far longer than
 * intended, silently pinning stale settings (e.g. a `semantic_search_mode`
 * flip an already-running background task never observes). Detached
 * background call sites — the three in `image-queue.ts` plus the admin
 * backfill runner's detached `runBackfill` (C3-04) — MUST use this uncached
 * accessor instead of `getGalleryConfig()` so every invocation re-reads
 * current admin settings. Request-path server components/actions should keep
 * using the cached `getGalleryConfig()` below.
 *
 * PERF3-01 / C3-16 (run-10 c3): the queue's per-image side-effect gate calls
 * this once per processed image (a 17-row `admin_settings` SELECT each, all
 * discarded after one field check in the default deployment). A tiny
 * module-level TTL micro-cache (2 s) with in-flight dedupe collapses
 * bootstrap-storm reads to ~one query per interval while keeping the
 * detached-context freshness contract: a settings flip is observed within a
 * 2 s skew, far below any human flip-setting-then-act workflow latency.
 */
const UNCACHED_CONFIG_TTL_MS = 2_000;
let uncachedConfigCache: { value: GalleryConfig; expiresAt: number } | null = null;
let uncachedConfigInFlight: Promise<GalleryConfig> | null = null;

export const getGalleryConfigUncached: typeof _getGalleryConfig = async () => {
    const now = Date.now();
    if (uncachedConfigCache && uncachedConfigCache.expiresAt > now) {
        return uncachedConfigCache.value;
    }
    if (uncachedConfigInFlight) {
        return uncachedConfigInFlight;
    }
    uncachedConfigInFlight = (async () => {
        try {
            const value = await _getGalleryConfig();
            uncachedConfigCache = { value, expiresAt: Date.now() + UNCACHED_CONFIG_TTL_MS };
            return value;
        } finally {
            uncachedConfigInFlight = null;
        }
    })();
    return uncachedConfigInFlight;
};

/** Test hook (C3-16): reset the uncached-accessor micro-cache between tests. */
export function _uncachedConfigCacheReset(): void {
    uncachedConfigCache = null;
    uncachedConfigInFlight = null;
}

/** Cached gallery config — deduped within a single SSR request via React cache(). */
export const getGalleryConfig = cache(_getGalleryConfig);
