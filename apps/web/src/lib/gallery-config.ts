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
} from './gallery-config-shared';

import { GALLERY_SETTING_KEYS, getSettingDefaults, isValidSettingValue, parseImageSizes } from './gallery-config-shared';
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
    queueConcurrency: number;

    // Gallery Display
    gridColumnsDesktop: number;
    gridColumnsTablet: number;
    gridColumnsMobile: number;

    // Privacy
    stripGpsOnUpload: boolean;

    // Upload Limits
    maxFileSizeMb: number;
    maxFilesPerBatch: number;

    // Storage
    storageBackend: 'local' | 'minio' | 's3';
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

const VALID_STORAGE_BACKENDS = ['local', 'minio', 's3'] as const;

async function _getGalleryConfig(): Promise<GalleryConfig> {
    const map = await getSettingsMap();

    // Use parseImageSizes for sorted output and invalid-input fallback (C13-01)
    const imageSizes = parseImageSizes(getSetting(map, 'image_sizes'));

    // Validate storageBackend against allowed values (C13-02)
    const rawBackend = getSetting(map, 'storage_backend');
    const storageBackend: 'local' | 'minio' | 's3' = VALID_STORAGE_BACKENDS.includes(rawBackend as typeof VALID_STORAGE_BACKENDS[number])
        ? (rawBackend as 'local' | 'minio' | 's3')
        : 'local';

    return {
        imageQualityWebp: validatedNumber(map, 'image_quality_webp'),
        imageQualityAvif: validatedNumber(map, 'image_quality_avif'),
        imageQualityJpeg: validatedNumber(map, 'image_quality_jpeg'),
        imageSizes,
        queueConcurrency: validatedNumber(map, 'queue_concurrency'),
        gridColumnsDesktop: validatedNumber(map, 'grid_columns_desktop'),
        gridColumnsTablet: validatedNumber(map, 'grid_columns_tablet'),
        gridColumnsMobile: validatedNumber(map, 'grid_columns_mobile'),
        stripGpsOnUpload: (() => {
            const raw = getSetting(map, 'strip_gps_on_upload');
            if (!isValidSettingValue('strip_gps_on_upload', raw)) return DEFAULTS.strip_gps_on_upload === 'true';
            return raw === 'true';
        })(),
        maxFileSizeMb: validatedNumber(map, 'max_file_size_mb'),
        maxFilesPerBatch: validatedNumber(map, 'max_files_per_batch'),
        storageBackend,
    };
}

/** Cached gallery config — deduped within a single SSR request via React cache(). */
export const getGalleryConfig = cache(_getGalleryConfig);
