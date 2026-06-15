/**
 * Gallery Configuration — Shared Constants & Types
 *
 * This module contains ONLY pure constants, types, and validators.
 * It has NO database imports and is safe for use in client components.
 */

// ── Pipeline Version ──────────────────────────────────────────────────────────

/**
 * Pipeline version bump invalidates all cached image variants on deploy.
 *
 * Increment whenever encoder output bytes change. Recent bumps:
 * - v6: WI-15 wide-gamut downscale, P3-from-Adobe RGB / ProPhoto / Rec.2020
 *   rgb16 pipeline, etc.
 * - v7 (R11-L1, 2026-05-17): cycle-1 R10-H1 (WI-15 ICC preservation),
 *   R10-M3 (target-gamut JPEG chroma), R10-L9 (sRGB blur pipeline). All
 *   three alter byte output for wide-gamut sources, so the ETag must
 *   change once backfill re-encodes affected images.
 */
export const IMAGE_PIPELINE_VERSION = 7;

// ── Setting Keys ──────────────────────────────────────────────────────────────

export const GALLERY_SETTING_KEYS = [
    // Image Processing
    'image_quality_webp',
    'image_quality_avif',
    'image_quality_jpeg',
    'image_sizes',

    // Privacy
    'strip_gps_on_upload',

    // Slideshow
    'slideshow_interval_seconds',

    // US-P52: Auto alt-text via local Florence-2 (ONNX stub, default off)
    'auto_alt_text_enabled',

    // US-P51: CLIP semantic search mode (disabled | stub | production)
    'semantic_search_mode',

    // US-P54: Stripe license tier pricing (in cents; 0 = free/not for sale)
    'license_price_editorial_cents',
    'license_price_commercial_cents',
    'license_price_rm_cents',

    // US-CM02: force sRGB derivatives for legacy embedder compatibility
    'force_srgb_derivatives',

    // P3-2: allow HDR (PQ/HLG) source ingest (default false)
    'allow_hdr_ingest',

    // P3-26: force color gamut/HDR chips visible on sRGB displays (default false)
    'force_show_color_chips',

    // P3-20: JPEG chroma subsampling for wide-gamut sources (4:4:4 / 4:2:2 / 4:2:0)
    'wide_gamut_jpeg_chroma',

    // P3-21 / R28-CP-LOW-1: AVIF encoding effort (0-9, default 6 — Sharp's native default is 4)
    'avif_effort',

    // C2-A5 / C2-COL-MED-2: JPEG chroma subsampling for sRGB / non-wide-gamut
    // sources (4:4:4 / 4:2:2 / 4:2:0). Default 4:2:0 preserves prior behavior.
    'sdr_jpeg_chroma',

    // C2-A6 / C2-INT-MED-1: pixel-count cap above which wide-gamut sources are
    // downscaled before the rgb16 pipeline (memory cap; WI-15).
    'wide_gamut_max_source_pixels',
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

const DEFAULT_IMAGE_SIZE_VALUES = [640, 1536, 2048, 4096, 5120, 7680] as const;

export const SLIDESHOW_INTERVAL_DEFAULT = 5;
export const SLIDESHOW_INTERVAL_MIN = 2;
export const SLIDESHOW_INTERVAL_MAX = 30;

const DEFAULTS: Record<GallerySettingKey, string> = {
    image_quality_webp: '90',
    image_quality_avif: '85',
    image_quality_jpeg: '90',
    image_sizes: DEFAULT_IMAGE_SIZE_VALUES.join(','),
    strip_gps_on_upload: 'false',
    slideshow_interval_seconds: String(SLIDESHOW_INTERVAL_DEFAULT),

    // US-P52: auto alt-text disabled by default (heavy ONNX model, opt-in)
    auto_alt_text_enabled: 'false',

    // US-P51: semantic search disabled by default until backfill completes
    semantic_search_mode: 'disabled',

    // US-P54: license tier prices default to 0 (not for sale)
    license_price_editorial_cents: '0',
    license_price_commercial_cents: '0',
    license_price_rm_cents: '0',

    // US-CM02: default off — P3-tagged WebP/JPEG for P3 sources
    force_srgb_derivatives: 'false',

    // P3-2: default off — reject PQ/HLG source uploads
    allow_hdr_ingest: 'false',

    // P3-26: default off — chips hidden on sRGB displays unless display supports
    force_show_color_chips: 'false',

    // P3-20: default 4:4:4 — best quality for wide-gamut sources
    wide_gamut_jpeg_chroma: '4:4:4',

    // P3-21: default 6 — balanced file size vs CPU
    avif_effort: '6',

    // C2-A5: default 4:2:0 — preserves Sharp default file size for SDR sources
    sdr_jpeg_chroma: '4:2:0',

    // C2-A6: default 50 MP — historical hardcoded WIDE_GAMUT_MAX_SOURCE_PIXELS
    wide_gamut_max_source_pixels: '50000000',
};

export const MAX_IMAGE_SIZE_COUNT = 8;

/**
 * C3-A6 / C3-INT-MED-1: shared narrow type for JPEG chroma subsampling
 * settings (wide_gamut_jpeg_chroma, sdr_jpeg_chroma). Sharp's
 * chromaSubsampling parameter accepts only these three values; the runtime
 * `as` cast at the encode site previously hid drift between validator and
 * encoder if the validator ever widened. Threading this type through
 * gallery-config.ts → image-queue.ts → process-image.ts removes the cast.
 */
export type JpegChromaSubsampling = '4:4:4' | '4:2:2' | '4:2:0';

/** Runtime guard for narrowing a string to JpegChromaSubsampling. */
export function isJpegChromaSubsampling(v: string): v is JpegChromaSubsampling {
    return v === '4:4:4' || v === '4:2:2' || v === '4:2:0';
}

// ── Validators ────────────────────────────────────────────────────────────────

const VALIDATORS: Record<GallerySettingKey, (value: string) => boolean> = {
    image_quality_webp: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_quality_avif: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_quality_jpeg: (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1 && n <= 100; },
    image_sizes: (v) => normalizeConfiguredImageSizes(v) !== null,
    strip_gps_on_upload: (v) => v === 'true' || v === 'false',
    slideshow_interval_seconds: (v) => { const n = Number(v); return Number.isInteger(n) && n >= SLIDESHOW_INTERVAL_MIN && n <= SLIDESHOW_INTERVAL_MAX; },

    // US-P52
    auto_alt_text_enabled: (v) => v === 'true' || v === 'false',

    // US-P51: real ONNX encoder shipped — 'production' is now storable.
    // The route + hook gate reads/writes on the active model_version so stub rows
    // are never served as production.
    semantic_search_mode: (v) => v === 'disabled' || v === 'stub' || v === 'production',

    // US-P54: license tier prices must be non-negative integers (cents)
    license_price_editorial_cents: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0; },
    license_price_commercial_cents: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0; },
    license_price_rm_cents: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0; },

    // US-CM02: boolean toggle
    force_srgb_derivatives: (v) => v === 'true' || v === 'false',

    // P3-2: boolean toggle
    allow_hdr_ingest: (v) => v === 'true' || v === 'false',

    // P3-26: boolean toggle
    force_show_color_chips: (v) => v === 'true' || v === 'false',

    // P3-20: must be a valid chroma subsampling string
    wide_gamut_jpeg_chroma: (v) => v === '4:4:4' || v === '4:2:2' || v === '4:2:0',

    // P3-21 / R28-CP-LOW-1: must be an integer between 0 and 9. Sharp's
    // native default is 4 (fastest reasonable). The product DEFAULT here
    // stays at 6 (~10% smaller files at ~30% extra CPU vs. 4); admins who
    // need faster ingest on high-volume galleries can drop to 3 or below.
    avif_effort: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 9; },

    // C2-A5: must be a valid chroma subsampling string
    sdr_jpeg_chroma: (v) => v === '4:4:4' || v === '4:2:2' || v === '4:2:0',

    // C2-A6: integer in [10_000_000, 200_000_000]; clamps memory headroom
    wide_gamut_max_source_pixels: (v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 10_000_000 && n <= 200_000_000;
    },
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
export const DEFAULT_IMAGE_SIZES = [...DEFAULT_IMAGE_SIZE_VALUES];

/** Default OG image target size — used for social media previews. */
export const DEFAULT_OG_TARGET_SIZE = 1536;
export const DEFAULT_GRID_CARD_TARGET_SIZE = DEFAULT_IMAGE_SIZES[0];
export const PHOTO_VIEWER_SIDEBAR_WIDTH_PX = 350;
export const PHOTO_VIEWER_INFO_GAP_PX = 32;
export const PHOTO_VIEWER_LAYOUT_CHROME_PX = 32;

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
    if (parsed.some((value) => !Number.isInteger(value) || value <= 0 || value > 10000)) {
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
 * Responsive sizes hint for the photo viewer.
 * When the desktop info panel is open, subtract the sidebar, grid gap,
 * and a small layout-chrome allowance so browsers pick a closer derivative.
 */
export function getPhotoViewerImageSizes(showDesktopInfoPanel: boolean): string {
    if (!showDesktopInfoPanel) {
        return '100vw';
    }

    const reservedWidth = PHOTO_VIEWER_SIDEBAR_WIDTH_PX + PHOTO_VIEWER_INFO_GAP_PX + PHOTO_VIEWER_LAYOUT_CHROME_PX;
    return `(min-width: 1024px) calc(100vw - ${reservedWidth}px), 100vw`;
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

/**
 * Parse slideshow_interval_seconds setting string into a number.
 * Returns SLIDESHOW_INTERVAL_DEFAULT if the input is empty or invalid.
 */
export function parseSlideshowInterval(value: string | undefined): number {
    if (!value) return SLIDESHOW_INTERVAL_DEFAULT;
    const n = Number(value);
    if (Number.isInteger(n) && n >= SLIDESHOW_INTERVAL_MIN && n <= SLIDESHOW_INTERVAL_MAX) return n;
    return SLIDESHOW_INTERVAL_DEFAULT;
}
