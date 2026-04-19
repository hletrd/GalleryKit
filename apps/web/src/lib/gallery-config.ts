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
} from './gallery-config-shared';

import { GALLERY_SETTING_KEYS, getSettingDefaults } from './gallery-config-shared';
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

async function _getGalleryConfig(): Promise<GalleryConfig> {
    const map = await getSettingsMap();

    return {
        imageQualityWebp: Number(getSetting(map, 'image_quality_webp')),
        imageQualityAvif: Number(getSetting(map, 'image_quality_avif')),
        imageQualityJpeg: Number(getSetting(map, 'image_quality_jpeg')),
        imageSizes: getSetting(map, 'image_sizes').split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0),
        queueConcurrency: Number(getSetting(map, 'queue_concurrency')),
        gridColumnsDesktop: Number(getSetting(map, 'grid_columns_desktop')),
        gridColumnsTablet: Number(getSetting(map, 'grid_columns_tablet')),
        gridColumnsMobile: Number(getSetting(map, 'grid_columns_mobile')),
        stripGpsOnUpload: getSetting(map, 'strip_gps_on_upload') === 'true',
        maxFileSizeMb: Number(getSetting(map, 'max_file_size_mb')),
        maxFilesPerBatch: Number(getSetting(map, 'max_files_per_batch')),
        storageBackend: getSetting(map, 'storage_backend') as 'local' | 'minio' | 's3',
    };
}

/** Cached gallery config — deduped within a single SSR request via React cache(). */
export const getGalleryConfig = cache(_getGalleryConfig);
