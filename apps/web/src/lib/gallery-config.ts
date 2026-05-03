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

import { GALLERY_SETTING_KEYS, getSettingDefaults, isValidSettingValue, parseImageSizes, parseSlideshowInterval } from './gallery-config-shared';
import type { GallerySettingKey } from './gallery-config-shared';

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

    // US-P31: Reactions
    reactionsEnabled: boolean;

    // US-P52: Auto alt-text (ONNX stub, opt-in)
    autoAltTextEnabled: boolean;

    // US-P51: CLIP semantic search (ONNX stub, opt-in; default off until backfill completes)
    semanticSearchEnabled: boolean;
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
            reactionsEnabled: (() => {
                const raw = getSetting(map, 'reactions_enabled');
                if (!isValidSettingValue('reactions_enabled', raw)) return DEFAULTS.reactions_enabled !== 'false';
                return raw !== 'false';
            })(),
            autoAltTextEnabled: (() => {
                const raw = getSetting(map, 'auto_alt_text_enabled');
                if (!isValidSettingValue('auto_alt_text_enabled', raw)) return DEFAULTS.auto_alt_text_enabled === 'true';
                return raw === 'true';
            })(),
            semanticSearchEnabled: (() => {
                const raw = getSetting(map, 'semantic_search_enabled');
                if (!isValidSettingValue('semantic_search_enabled', raw)) return DEFAULTS.semantic_search_enabled === 'true';
                return raw === 'true';
            })(),
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
            reactionsEnabled: DEFAULTS.reactions_enabled !== 'false',
            autoAltTextEnabled: DEFAULTS.auto_alt_text_enabled === 'true',
            semanticSearchEnabled: DEFAULTS.semantic_search_enabled === 'true',
        };
    }
}

/** Cached gallery config — deduped within a single SSR request via React cache(). */
export const getGalleryConfig = cache(_getGalleryConfig);
