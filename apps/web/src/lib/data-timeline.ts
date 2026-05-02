/**
 * Timeline data access module — US-P22 Phase 2.2.
 *
 * Composes queries using the same tagNamesAgg + publicSelectFields shape
 * as the masonry listing in data.ts. Does NOT modify data.ts.
 *
 * All queries target the existing composite index:
 *   (processed, capture_date, created_at) — idx_images_processed_capture_date
 */

import { db, images, imageTags, tags } from '@/db';
import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Field sets (mirrors publicSelectFields from data.ts — privacy-safe subset)
// ---------------------------------------------------------------------------

// PRIVACY: These fields match publicSelectFields. They intentionally omit
// latitude, longitude, filename_original, user_filename, processed,
// original_format, original_file_size. Do NOT add PII fields here.
const timelineSelectFields = {
    id: images.id,
    filename_avif: images.filename_avif,
    filename_webp: images.filename_webp,
    filename_jpeg: images.filename_jpeg,
    width: images.width,
    height: images.height,
    original_width: images.original_width,
    original_height: images.original_height,
    title: images.title,
    description: images.description,
    topic: images.topic,
    capture_date: images.capture_date,
    created_at: images.created_at,
    camera_model: images.camera_model,
    lens_model: images.lens_model,
    iso: images.iso,
    f_number: images.f_number,
    exposure_time: images.exposure_time,
    focal_length: images.focal_length,
    color_space: images.color_space,
    white_balance: images.white_balance,
    metering_mode: images.metering_mode,
    exposure_compensation: images.exposure_compensation,
    exposure_program: images.exposure_program,
    flash: images.flash,
    bit_depth: images.bit_depth,
} as const;

/**
 * Shared GROUP_CONCAT expression — matches tagNamesAgg in data.ts exactly.
 * Must stay in sync with `tagNamesAgg` constant in data.ts.
 */
const tagNamesAgg = sql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`;

// ---------------------------------------------------------------------------
// On-This-Day
// ---------------------------------------------------------------------------

/** Max photos returned by the On This Day widget. */
const ON_THIS_DAY_LIMIT = 6;

/**
 * Return up to 6 processed photos whose capture_date matches today's
 * MM-DD across any year. Photos with NULL capture_date are excluded.
 *
 * Uses MONTH() + DAY() so the query stays within the composite index
 * prefix (processed, capture_date) — no full table scan.
 */
export async function getOnThisDayImages(month: number, day: number) {
    const rows = await db
        .select({
            ...timelineSelectFields,
            tag_names: tagNamesAgg,
        })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .where(
            and(
                eq(images.processed, true),
                isNotNull(images.capture_date),
                sql`MONTH(${images.capture_date}) = ${month}`,
                sql`DAY(${images.capture_date}) = ${day}`,
            ),
        )
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id))
        .limit(ON_THIS_DAY_LIMIT);

    return rows;
}

// ---------------------------------------------------------------------------
// Timeline — year index
// ---------------------------------------------------------------------------

/**
 * Return the distinct years that appear in capture_date, descending.
 * Used by the year scrubber on /timeline.
 */
export async function getTimelineYears(): Promise<number[]> {
    const rows = await db
        .selectDistinct({
            year: sql<number>`YEAR(${images.capture_date})`,
        })
        .from(images)
        .where(
            and(
                eq(images.processed, true),
                isNotNull(images.capture_date),
            ),
        )
        .orderBy(desc(sql`YEAR(${images.capture_date})`));

    return rows
        .map((r) => Number(r.year))
        .filter((y) => Number.isFinite(y) && y > 0);
}

// ---------------------------------------------------------------------------
// Timeline — photos for a specific year (optional month filter)
// ---------------------------------------------------------------------------

const TIMELINE_PAGE_LIMIT = 100;

/**
 * Return processed photos captured in `year`, optionally filtered by
 * `month` (1–12). Results are ordered by capture_date DESC.
 *
 * The query is covered by idx_images_processed_capture_date:
 *   (processed=true, capture_date LIKE '<year>-%', ...)
 */
export async function getTimelineImages(year: number, month?: number) {
    const conditions = [
        eq(images.processed, true),
        isNotNull(images.capture_date),
        sql`YEAR(${images.capture_date}) = ${year}`,
    ];
    if (month !== undefined) {
        conditions.push(sql`MONTH(${images.capture_date}) = ${month}`);
    }

    const rows = await db
        .select({
            ...timelineSelectFields,
            tag_names: tagNamesAgg,
        })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .where(and(...conditions))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id))
        .limit(TIMELINE_PAGE_LIMIT);

    return rows;
}

// ---------------------------------------------------------------------------
// Year-in-review — photos grouped by month
// ---------------------------------------------------------------------------

export type MonthSection = {
    month: number; // 1–12
    images: Awaited<ReturnType<typeof getTimelineImages>>;
};

/**
 * Return photos for `year` grouped by calendar month (1–12), in
 * descending month order. Months with zero processed photos are omitted.
 */
export async function getYearInReviewImages(year: number): Promise<MonthSection[]> {
    const all = await getTimelineImages(year);
    if (all.length === 0) return [];

    const byMonth = new Map<number, typeof all>();
    for (const img of all) {
        if (!img.capture_date) continue;
        // capture_date is stored as 'YYYY-MM-DD HH:mm:ss'
        const monthNum = new Date(img.capture_date).getMonth() + 1;
        if (!Number.isFinite(monthNum) || monthNum < 1 || monthNum > 12) continue;
        const bucket = byMonth.get(monthNum) ?? [];
        bucket.push(img);
        byMonth.set(monthNum, bucket);
    }

    // Sort months descending (December → January)
    const sortedMonths = [...byMonth.keys()].sort((a, b) => b - a);
    return sortedMonths.map((month) => ({
        month,
        images: byMonth.get(month) ?? [],
    }));
}

// ---------------------------------------------------------------------------
// Re-export type helpers
// ---------------------------------------------------------------------------

export type TimelineImage = Awaited<ReturnType<typeof getTimelineImages>>[number];
