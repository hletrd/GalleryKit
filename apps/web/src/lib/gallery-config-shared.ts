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

    // Privacy
    'strip_gps_on_upload',
] as const;

export type GallerySettingKey = typeof GALLERY_SETTING_KEYS[number];

// ── SEO Setting Keys ──────────────────────────────────────────────────────────

export const SEO_SETTING_KEYS = [
    'seo_title',
    'seo_description',
    'seo_nav_title',
    'seo_author',
    'seo_locale',
    'seo_og_image_url',
] as const;

export type SeoSettingKey = typeof SEO_SETTING_KEYS[number];

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: Record<GallerySettingKey, string> = {
    image_quality_webp: '90',
    image_quality_avif: '85',
    image_quality_jpeg: '90',
    image_sizes: '640,1536,2048,4096',
    strip_gps_on_upload: 'false',
};

export const MAX_IMAGE_SIZE_COUNT = 8;

// ── Validators ────────────────────────────────────────────────────────────────

const VALIDATORS: Record<GallerySettingKey, (value: string) => boolean> = {
    image_quality_webp: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_quality_avif: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_quality_jpeg: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_sizes: (v) => normalizeConfiguredImageSizes(v) !== null,
    strip_gps_on_upload: (v) => v === 'true' || v === 'false',
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

// ── Image Size Helpers ────────────────────────────────────────────────────────

/** Default image output sizes — used when no admin-configured sizes are provided. */
export const DEFAULT_IMAGE_SIZES = [640, 1536, 2048, 4096];

/** Default OG image target size — used for social media previews. */
export const DEFAULT_OG_TARGET_SIZE = 1536;
export const DEFAULT_GRID_CARD_TARGET_SIZE = DEFAULT_IMAGE_SIZES[0];

/**
 * Canonicalize an admin-provided image_sizes string into a sorted, deduped list.
 * Returns null when the input is malformed or exceeds the supported list size.
 */
export function normalizeConfiguredImageSizes(sizesStr: string): string | null {
    if (!sizesStr || !sizesStr.trim()) return null;

    const rawParts = sizesStr.split(',').map((segment) => segment.trim());
    if (rawParts.some((segment) => segment.length === 0)) {
        return null;
    }

    const parsed = rawParts.map((segment) => Number(segment));
    if (parsed.some((value) => !Number.isFinite(value) || value <= 0 || value > 10000)) {
        return null;
    }

    const uniqueSorted = Array.from(new Set(parsed)).sort((a, b) => a - b);
    if (uniqueSorted.length === 0 || uniqueSorted.length > MAX_IMAGE_SIZE_COUNT) {
        return null;
    }

    return uniqueSorted.join(',');
}

/**
 * Find the nearest configured image size to a target size.
 * Used for OG images and thumbnails where a specific size is expected.
 * Falls back to the largest size if no close match exists.
 */
export function findNearestImageSize(sizes: number[], targetSize: number): number {
    if (sizes.length === 0) return DEFAULT_IMAGE_SIZES[DEFAULT_IMAGE_SIZES.length - 1]; // fallback — no sizes configured
    let nearest = sizes[0];
    let minDiff = Math.abs(sizes[0] - targetSize);
    for (let i = 1; i < sizes.length; i++) {
        const diff = Math.abs(sizes[i] - targetSize);
        if (diff < minDiff) {
            minDiff = diff;
            nearest = sizes[i];
        }
    }
    return nearest;
}

/** Pick a thumbnail/grid derivative from the configured size list. */
export function findGridCardImageSize(sizes: number[]): number {
    return findNearestImageSize(sizes, DEFAULT_GRID_CARD_TARGET_SIZE);
}

/**
 * Parse image_sizes string into sorted number array.
 * Returns DEFAULT_IMAGE_SIZES if the input is empty or invalid.
 */
export function parseImageSizes(sizesStr: string): number[] {
    const normalized = normalizeConfiguredImageSizes(sizesStr);
    if (!normalized) return DEFAULT_IMAGE_SIZES;
    return normalized.split(',').map((value) => Number(value));
}
