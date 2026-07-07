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
import { eq, and, desc, gte, isNotNull, lt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { PrivacySensitiveKeys } from '@/lib/data';

// ---------------------------------------------------------------------------
// Field sets (mirrors publicSelectFields from data.ts — privacy-safe subset)
// ---------------------------------------------------------------------------

// PRIVACY: These fields match publicSelectFields. They intentionally omit
// every member of the PrivacySensitiveKeys contract in data.ts (PII like
// latitude/longitude/filename_original/user_filename AND the admin-only
// color-audit columns: color_space, icc_profile_name, bit_depth,
// pipeline_version, transfer_function, …). Do NOT add sensitive fields
// here — the compile-time guard + the privacy-fields fixture test below
// will fail the build/tests if you do.
//
// R4C9 TEST-R4C9-04 (upgraded to a live finding during implementation):
// color_space and bit_depth USED to be selected here —
// they were moved to admin-only in data.ts (R27-CP-HIGH-1 / earlier
// bit_depth lockdown) and this hand-maintained mirror silently drifted.
// No timeline/OnThisDay/year-review consumer ever rendered them, so the
// removal is zero-behavior-change; the guards exist so the NEXT drift is
// impossible.
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
    white_balance: images.white_balance,
    metering_mode: images.metering_mode,
    exposure_compensation: images.exposure_compensation,
    exposure_program: images.exposure_program,
    flash: images.flash,
} as const;

// Compile-time privacy guard (R4C9 TEST-R4C9-04) — same pattern as
// data.ts: if any PrivacySensitiveKeys member is ever added to
// timelineSelectFields, the offending key name(s) appear in a type error.
type _TimelineSensitive = Extract<keyof typeof timelineSelectFields, PrivacySensitiveKeys>;
const _timelinePrivacyGuard: _TimelineSensitive extends never ? true : [_TimelineSensitive, 'ERROR: privacy-sensitive field found in timelineSelectFields — see PRIVACY comment above'] = true;
void _timelinePrivacyGuard;

// Runtime fixture pin for __tests__/privacy-fields.test.ts (keeps the
// SENSITIVE_KEYS list and the type guard from drifting apart).
export const timelineSelectFieldKeys = Object.freeze(
    Object.keys(timelineSelectFields).sort(),
) as readonly (keyof typeof timelineSelectFields)[];

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

function padDatePart(value: number): string {
    return String(value).padStart(2, '0');
}

function archiveRange(year: number, month?: number): { start: string; end: string } {
    const startMonth = month ?? 1;
    const endYear = month === undefined || month === 12 ? year + 1 : year;
    const endMonth = month === undefined ? 1 : month + 1;
    return {
        start: `${year}-${padDatePart(startMonth)}-01 00:00:00`,
        end: `${endYear}-${padDatePart(endMonth)}-01 00:00:00`,
    };
}

/**
 * Return up to 6 processed photos whose capture_date matches today's
 * MM-DD across any year. Photos with NULL capture_date are excluded.
 *
 * Uses MONTH() + DAY() for straightforward MM-DD matching. Those predicates
 * are not sargable on capture_date; this is acceptable at the current
 * personal-gallery scale, but large installs should add generated month/day
 * columns or a range/index strategy before relying on this widget heavily.
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

/**
 * R4C6 COR-R4C6-02: raised from 100 — a 100-photo cap silently dropped
 * everything beyond the most recent 100 of a year (DESC order ⇒ EARLY
 * months vanished from the month sections entirely). 500 covers a
 * personal-gallery year comfortably; the limit+1 lookahead below makes
 * any remaining truncation VISIBLE instead of silent.
 */
export const TIMELINE_PAGE_LIMIT = 500;

export type TimelinePage = {
    images: TimelineImage[];
    /**
     * True when the year holds MORE processed photos than
     * TIMELINE_PAGE_LIMIT — the pages render a localized
     * "showing the N most recent photos" notice so the surface can
     * never silently misrepresent the archive's shape.
     */
    truncated: boolean;
};

/**
 * Return processed photos captured in `year`, optionally filtered by
 * `month` (1–12). Results are ordered by capture_date DESC and capped
 * at TIMELINE_PAGE_LIMIT, with a limit+1 lookahead driving the
 * `truncated` flag.
 *
 * Index note (C10): archive pages use an inclusive/exclusive capture_date
 * range so idx_images_processed_capture_date can use the date key parts.
 */
export async function getTimelineImages(year: number, month?: number): Promise<TimelinePage> {
    const { start, end } = archiveRange(year, month);
    const conditions = [
        eq(images.processed, true),
        isNotNull(images.capture_date),
        gte(images.capture_date, start),
        lt(images.capture_date, end),
    ];

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
        .limit(TIMELINE_PAGE_LIMIT + 1);

    const truncated = rows.length > TIMELINE_PAGE_LIMIT;
    return {
        images: truncated ? rows.slice(0, TIMELINE_PAGE_LIMIT) : rows,
        truncated,
    };
}

// ---------------------------------------------------------------------------
// Year-in-review — photos grouped by month
// ---------------------------------------------------------------------------

export type MonthSection = {
    month: number; // 1–12
    images: TimelineImage[];
};

export type YearInReview = {
    sections: MonthSection[];
    /** R4C6 COR-R4C6-02: propagated from getTimelineImages — see TimelinePage. */
    truncated: boolean;
};

/**
 * Return photos for `year` grouped by calendar month (1–12), in
 * descending month order. Months with zero processed photos are omitted.
 */
export async function getYearInReviewImages(year: number): Promise<YearInReview> {
    const { images: all, truncated } = await getTimelineImages(year);
    if (all.length === 0) return { sections: [], truncated };

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
    return {
        sections: sortedMonths.map((month) => ({
            month,
            images: byMonth.get(month) ?? [],
        })),
        truncated,
    };
}

// ---------------------------------------------------------------------------
// Re-export type helpers
// ---------------------------------------------------------------------------

// Derived from the on-this-day query, which selects the identical
// timelineSelectFields + tag_names shape (type aliases hoist, so the
// TimelinePage reference above is fine).
export type TimelineImage = Awaited<ReturnType<typeof getOnThisDayImages>>[number];
