/** Shared image type definitions for client components */

export interface ImageDetail {
    id: number;
    filename_avif: string;
    filename_webp: string;
    filename_jpeg: string;
    width: number;
    height: number;
    original_width?: number | null;
    original_height?: number | null;
    title: string | null;
    description: string | null;
    topic: string;
    topic_label?: string | null;
    capture_date: string | null;
    camera_model: string | null;
    lens_model: string | null;
    iso: number | null;
    f_number: number | null;
    exposure_time: string | null;
    focal_length: number | null;
    color_space: string | null;
    white_balance: string | null;
    metering_mode: string | null;
    exposure_compensation: string | null;
    exposure_program: string | null;
    flash: string | null;
    bit_depth: number | null;
    original_format?: string | null;
    original_file_size?: number | null;
    blur_data_url?: string | null;
    // US-P54: license tier drives the Buy/Download button on the photo viewer
    license_tier?: string | null;
    share_key?: string | null;
    user_filename?: string | null;
    tag_names?: string | null;
    tags?: TagInfo[];
    latitude?: number | null;
    longitude?: number | null;
    prevId?: number | null;
    nextId?: number | null;
    created_at?: string | Date | null;
}

export interface TagInfo {
    name: string;
    slug: string;
}

/** Check if an EXIF value is present and meaningful. */
export function hasExifData(val: string | number | null | undefined): boolean {
    if (val === undefined || val === null) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (typeof val === 'number') return Number.isFinite(val);
    return false;
}

/** Check if an image has any camera-related EXIF metadata. */
export function hasAnyCameraExifData(image: ImageDetail): boolean {
    return hasExifData(image.camera_model) ||
        hasExifData(image.lens_model) ||
        hasExifData(image.focal_length) ||
        hasExifData(image.f_number) ||
        hasExifData(image.exposure_time) ||
        hasExifData(image.iso) ||
        hasExifData(image.color_space) ||
        hasExifData(image.original_format) ||
        hasExifData(image.white_balance) ||
        hasExifData(image.metering_mode) ||
        hasExifData(image.exposure_compensation) ||
        hasExifData(image.exposure_program) ||
        hasExifData(image.flash) ||
        hasExifData(image.bit_depth);
}

/** Convert null to undefined for HTML attributes that accept string | undefined. */
export function nu(val: string | null | undefined): string | undefined {
    return val ?? undefined;
}

/**
 * Format a shutter speed value for display.
 * Converts decimal values like 0.002 to "1/500" when the conversion is exact.
 * Returns the original string representation otherwise.
 *
 * Standard photography notation:
 *   - Fractions like "1/125" are displayed without suffix (the slash implies seconds)
 *   - Whole-second values like "1" or "30" receive an "s" suffix ("1s", "30s")
 *   - Decimal seconds like "1.5" receive an "s" suffix ("1.5s")
 */
export function formatShutterSpeed(exposureTime: string | null): string | null {
    if (!hasExifData(exposureTime)) return null;
    const val = Number(exposureTime);
    if (!Number.isFinite(val)) return String(exposureTime);
    if (val < 1 && val > 0) {
        const denominator = Math.round(1 / val);
        if (Math.abs(1 / denominator - val) < 0.00001) {
            // Fractional shutter speeds use standard photography notation
            // without 's' suffix — the fraction inherently represents seconds.
            return `1/${denominator}`;
        }
    }
    // Whole-second and decimal-second values get the 's' suffix for clarity.
    return `${exposureTime}s`;
}
