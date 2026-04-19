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
    original_format: string | null;
    original_file_size: number | null;
    blur_data_url?: string | null;
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

/** Convert null to undefined for HTML attributes that accept string | undefined. */
export function nu(val: string | null | undefined): string | undefined {
    return val ?? undefined;
}
