/**
 * Gallery Configuration — Shared Constants & Types
 *
 * This module contains ONLY pure constants, types, and validators.
 * It has NO database imports and is safe for use in client components.
 */

// ── Setting Keys ──────────────────────────────────────────────────────────────

export const GALLERY_SETTING_KEYS = [
    // Image Processing
    'image_quality_webp',
    'image_quality_avif',
    'image_quality_jpeg',
    'image_sizes',
    'queue_concurrency',

    // Gallery Display
    'grid_columns_desktop',
    'grid_columns_tablet',
    'grid_columns_mobile',

    // Privacy
    'strip_gps_on_upload',

    // Upload Limits
    'max_file_size_mb',
    'max_files_per_batch',

    // Storage
    'storage_backend',
] as const;

export type GallerySettingKey = typeof GALLERY_SETTING_KEYS[number];

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: Record<GallerySettingKey, string> = {
    image_quality_webp: '90',
    image_quality_avif: '85',
    image_quality_jpeg: '90',
    image_sizes: '640,1536,2048,4096',
    queue_concurrency: '2',
    grid_columns_desktop: '4',
    grid_columns_tablet: '3',
    grid_columns_mobile: '2',
    strip_gps_on_upload: 'false',
    max_file_size_mb: '200',
    max_files_per_batch: '100',
    storage_backend: 'local',
};

// ── Validators ────────────────────────────────────────────────────────────────

const VALIDATORS: Record<GallerySettingKey, (value: string) => boolean> = {
    image_quality_webp: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_quality_avif: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_quality_jpeg: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_sizes: (v) => { const parts = v.split(',').map(s => Number(s.trim())); return parts.length > 0 && parts.every(n => Number.isFinite(n) && n > 0 && n <= 10000); },
    queue_concurrency: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 16; },
    grid_columns_desktop: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 8; },
    grid_columns_tablet: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 6; },
    grid_columns_mobile: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 3; },
    strip_gps_on_upload: (v) => v === 'true' || v === 'false',
    max_file_size_mb: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 1000; },
    max_files_per_batch: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 500; },
    storage_backend: (v) => ['local', 'minio', 's3'].includes(v),
};

/** Validate a setting value. Returns true if valid. */
export function isValidSettingValue(key: GallerySettingKey, value: string): boolean {
    const validator = VALIDATORS[key];
    return validator ? validator(value) : false;
}

/** Get all defaults (for UI display). */
export function getSettingDefaults(): Record<GallerySettingKey, string> {
    return { ...DEFAULTS };
}
