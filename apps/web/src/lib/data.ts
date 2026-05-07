import { cache } from 'react';
import { db, images, topics, topicAliases, tags, imageTags, sharedGroups, sharedGroupImages, adminSettings, smartCollections } from '@/db';
import { eq, desc, asc, and, gt, lt, or, inArray, notInArray, like, isNull, isNotNull } from 'drizzle-orm';
import { sql, type SQL } from 'drizzle-orm';
import { isBase56 } from './base56';
import { SEO_SETTING_KEYS } from './gallery-config-shared';
import { isRestoreMaintenanceActive } from './restore-maintenance';
import { isValidTagSlug, isValidSlug } from './validation';
import { countCodePoints } from './utils';
import siteConfig from '@/site-config.json';

// Module-level buffer for debounced shared-group view count increments.
// `let` (not `const`) so `flushGroupViewCounts` can atomically swap the Map
// reference before draining it — new increments during a flush go to the
// fresh Map while the old one is drained chunk-by-chunk. This prevents
// losing buffered increments if the process crashes mid-flush (C2-F01).
let viewCountBuffer = new Map<number, number>();
// C30-03: track how many times each group's increment has been re-buffered
// after a failed flush. If the retry count exceeds the cap, the increment
// is dropped and a warning is logged instead of re-buffering indefinitely.
const viewCountRetryCount = new Map<number, number>();
const VIEW_COUNT_MAX_RETRIES = 3;
// C5-AGG-02: explicit size cap for viewCountRetryCount. Entries are bounded
// by the number of shared groups (admin-controlled, typically < 100). The cap
// prevents unbounded growth during sustained DB outages where the buffer
// never empties and the pruning-at-empty-buffer path (line ~128) never fires.
const MAX_VIEW_COUNT_RETRY_SIZE = 500;
let viewCountFlushTimer: ReturnType<typeof setTimeout> | null = null;
const MAX_VIEW_COUNT_BUFFER_SIZE = 1000;

// Backoff for flush during DB outages: after N consecutive fully-failed flushes,
// the timer interval increases exponentially to avoid hammering an unreachable DB.
const BASE_FLUSH_INTERVAL_MS = 5000;
const MAX_FLUSH_INTERVAL_MS = 300000; // 5 minutes
let consecutiveFlushFailures = 0;

function getNextFlushInterval(): number {
    if (consecutiveFlushFailures < 3) return BASE_FLUSH_INTERVAL_MS;
    const backoff = BASE_FLUSH_INTERVAL_MS * Math.pow(2, Math.min(consecutiveFlushFailures - 3, 5));
    return Math.min(backoff, MAX_FLUSH_INTERVAL_MS);
}

function bufferGroupViewCount(groupId: number) {
    if (isRestoreMaintenanceActive()) {
        return;
    }
    if (viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE && !viewCountBuffer.has(groupId)) {
        // Drop increment to prevent unbounded growth during DB outage
        console.warn(`[viewCount] Buffer at capacity (${MAX_VIEW_COUNT_BUFFER_SIZE}), dropping increment for group ${groupId}`);
        return;
    }
    viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + 1);
    if (!viewCountFlushTimer) {
        viewCountFlushTimer = setTimeout(flushGroupViewCounts, getNextFlushInterval());
        viewCountFlushTimer.unref?.();
    }
}

let isFlushing = false;

const FLUSH_CHUNK_SIZE = 20; // Process view-count updates in chunks to limit concurrent DB promises

async function flushGroupViewCounts() {
    if (isFlushing) return; // Prevent concurrent flush
    isFlushing = true;
    viewCountFlushTimer = null;
    // C2-F01: swap the Map reference atomically so new increments during the
    // flush go to a fresh Map. The old Map is drained chunk-by-chunk below.
    // This prevents losing buffered increments if the process crashes between
    // the old "new Map(viewCountBuffer) + clear()" pattern where the buffer
    // was emptied before DB writes completed.
    const batch = viewCountBuffer;
    viewCountBuffer = new Map();
    let succeeded = 0;
    try {
        // Process in chunks to avoid creating 1000+ concurrent promises when the
        // buffer is at capacity. The connection pool (10) serializes execution
        // anyway, so chunking reduces memory overhead without hurting throughput.
        const entries = [...batch];
        for (let i = 0; i < entries.length; i += FLUSH_CHUNK_SIZE) {
            const chunk = entries.slice(i, i + FLUSH_CHUNK_SIZE);
            await Promise.all(
                chunk.map(([groupId, count]) =>
                    db.update(sharedGroups)
                        .set({ view_count: sql`${sharedGroups.view_count} + ${count}` })
                        .where(eq(sharedGroups.id, groupId))
                        .then((result) => { succeeded++; viewCountRetryCount.delete(groupId); return result; })
                        .catch(() => {
                            // C30-03: check retry count before re-buffering. If an
                            // increment has been re-buffered more than
                            // VIEW_COUNT_MAX_RETRIES times, drop it and log a
                            // warning instead of buffering indefinitely.
                            const retries = viewCountRetryCount.get(groupId) ?? 0;
                            if (retries >= VIEW_COUNT_MAX_RETRIES) {
                                console.warn(`[viewCount] Dropping increment for group ${groupId} after ${VIEW_COUNT_MAX_RETRIES} failed flush attempts`);
                                viewCountRetryCount.delete(groupId);
                                return;
                            }
                            // Re-buffer failed increment in one operation with capacity check.
                            // Using a single Map.set instead of per-increment calls avoids O(n)
                            // overhead when count is large (e.g., accumulated during DB outage).
                            if (viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE && !viewCountBuffer.has(groupId)) {
                                console.warn(`[viewCount] Buffer at capacity, dropping re-buffered increment for group ${groupId}`);
                                return;
                            }
                            viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count);
                            viewCountRetryCount.set(groupId, retries + 1);
                        })
                )
            );
        }
    } finally {
        isFlushing = false;
        // C1F-DB-01: enforce buffer cap after re-buffering. Re-buffered entries
        // whose group IDs already exist in the new buffer bypass the capacity
        // check in the re-buffer path (line 101). This post-flush enforcement
        // evicts the oldest entries (FIFO, matching viewCountRetryCount eviction)
        // to keep the buffer within cap. The overflow is bounded by the chunk
        // size (FLUSH_CHUNK_SIZE = 20).
        while (viewCountBuffer.size > MAX_VIEW_COUNT_BUFFER_SIZE) {
            const oldestKey = viewCountBuffer.keys().next().value;
            if (oldestKey !== undefined) {
                viewCountBuffer.delete(oldestKey);
            } else {
                break;
            }
        }
        // Update backoff counter: reset on any success, increment on total failure
        if (succeeded > 0) {
            consecutiveFlushFailures = 0;
        } else if (batch.size > 0) {
            consecutiveFlushFailures++;
            console.warn(`[viewCount] Flush fully failed (${consecutiveFlushFailures} consecutive), next flush in ${getNextFlushInterval() / 1000}s`);
        }

        if (viewCountBuffer.size > 0 && !viewCountFlushTimer) {
            viewCountFlushTimer = setTimeout(flushGroupViewCounts, getNextFlushInterval());
            viewCountFlushTimer.unref?.();
        }

        // C3-AGG-04: When the buffer is empty, all retry entries are stale —
        // clear the entire Map. This happens after a successful flush where
        // every group either succeeded or was dropped after max retries.
        if (viewCountRetryCount.size > 0 && viewCountBuffer.size === 0) {
            viewCountRetryCount.clear();
        } else if (viewCountRetryCount.size > MAX_VIEW_COUNT_RETRY_SIZE) {
            // C5-AGG-02: enforce hard cap on viewCountRetryCount. During a
            // sustained DB outage where the buffer never empties, the
            // pruning-at-empty-buffer path above never fires. Evict oldest
            // entries (FIFO) to keep the Map bounded.
            // C9-MED-01: collect-then-delete pattern (matching BoundedMap.prune()
            // and C8-MED-01) for consistency with the project convention. ES6
            // guarantees Map deletion during for-of iteration is safe, but the
            // explicit collect-then-delete pattern is clearer for reviewers.
            const excess = viewCountRetryCount.size - MAX_VIEW_COUNT_RETRY_SIZE;
            const evictKeys: number[] = [];
            for (const key of viewCountRetryCount.keys()) {
                if (evictKeys.length >= excess) break;
                evictKeys.push(key);
            }
            for (const key of evictKeys) {
                viewCountRetryCount.delete(key);
            }
        }
    }
}

export async function flushBufferedSharedGroupViewCounts() {
    if (viewCountFlushTimer) {
        clearTimeout(viewCountFlushTimer);
        viewCountFlushTimer = null;
    }

    if (viewCountBuffer.size === 0) {
        return;
    }

    await flushGroupViewCounts();
}

// PRIVACY: adminSelectFields is the FULL field set for authenticated admin queries.
// It includes latitude, longitude, filename_original, and user_filename which are
// PII and MUST NEVER be exposed to unauthenticated visitors.
// For public-facing queries, use `publicSelectFields` below instead.
const adminSelectFields = {
    id: images.id,
    filename_original: images.filename_original,
    filename_avif: images.filename_avif,
    filename_webp: images.filename_webp,
    filename_jpeg: images.filename_jpeg,
    processed: images.processed,
    width: images.width,
    height: images.height,
    original_width: images.original_width,
    original_height: images.original_height,
    title: images.title,
    description: images.description,
    user_filename: images.user_filename,
    topic: images.topic,
    capture_date: images.capture_date,
    created_at: images.created_at,
    // EXIF
    camera_model: images.camera_model,
    lens_model: images.lens_model,
    iso: images.iso,
    f_number: images.f_number,
    exposure_time: images.exposure_time,
    focal_length: images.focal_length,
    latitude: images.latitude,
    longitude: images.longitude,
    color_space: images.color_space,
    icc_profile_name: images.icc_profile_name,
    color_pipeline_decision: images.color_pipeline_decision,
    color_primaries: images.color_primaries,
    transfer_function: images.transfer_function,
    matrix_coefficients: images.matrix_coefficients,
    is_hdr: images.is_hdr,
    white_balance: images.white_balance,
    metering_mode: images.metering_mode,
    exposure_compensation: images.exposure_compensation,
    exposure_program: images.exposure_program,
    flash: images.flash,
    bit_depth: images.bit_depth,
    original_format: images.original_format,
    original_file_size: images.original_file_size,
    // blur_data_url excluded — fetched only in individual image queries
    // to avoid bloating InnoDB buffer pool and SSR payload on listing pages.
    // US-P52: alt_text_suggested is PUBLIC (SEO + a11y fallback, not PII).
    alt_text_suggested: images.alt_text_suggested,
    // US-P54: license_tier is PUBLIC (drives Buy/Download button on photo viewer).
    license_tier: images.license_tier,
} as const;

// ADMIN LISTING: lightweight field set for the admin dashboard grid.
// Omits EXIF columns (camera_model, lens_model, iso, f_number, exposure_time,
// focal_length, latitude, longitude, color_space, white_balance, metering_mode,
// exposure_compensation, exposure_program, flash, bit_depth, original_format,
// original_file_size) and original_width/original_height which are not needed
// for the grid display. Uses the same destructuring pattern as publicSelectFields
// to maintain the derivation relationship with adminSelectFields.
const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    camera_model: _omitCameraModel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    lens_model: _omitLensModel,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    iso: _omitIso,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    f_number: _omitFNumber,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    exposure_time: _omitExposureTime,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    focal_length: _omitFocalLength,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    latitude: _omitLatitudeAdmin,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    longitude: _omitLongitudeAdmin,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    color_space: _omitColorSpace,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    white_balance: _omitWhiteBalance,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    metering_mode: _omitMeteringMode,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    exposure_compensation: _omitExposureCompensation,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    exposure_program: _omitExposureProgram,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    flash: _omitFlash,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    bit_depth: _omitBitDepth,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    original_format: _omitOriginalFormatAdmin,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    original_file_size: _omitOriginalFileSizeAdmin,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    original_width: _omitOriginalWidth,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for listing performance
    original_height: _omitOriginalHeight,
    ...adminListSelectFieldCore
} = adminSelectFields;

const adminListSelectFields = {
    ...adminListSelectFieldCore,
} as const;

// PRIVACY: publicSelectFields is the canonical field set for ALL unauthenticated routes.
// It is derived from adminSelectFields by explicitly OMITTING PII/internal fields (latitude,
// longitude, filename_original, user_filename, original_format, original_file_size, processed). Because it is a separate object (not
// the same reference), adding a field to adminSelectFields does NOT automatically leak
// it to public queries — the field must be explicitly included here too.
// This is the primary privacy enforcement mechanism: any developer adding a sensitive
// field to adminSelectFields must consciously decide whether to also include it here.
const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for privacy
    latitude: _omitLatitude,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for privacy
    longitude: _omitLongitude,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for privacy
    filename_original: _omitFilenameOriginal,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for privacy
    user_filename: _omitUserFilename,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally from public payloads
    original_format: _omitOriginalFormat,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally from public payloads
    original_file_size: _omitOriginalFileSize,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally from public payloads
    processed: _omitProcessed,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally: color pipeline is admin-only
    color_pipeline_decision: _omitColorPipelineDecision,
    ...publicSelectFieldCore
} = adminSelectFields;

const publicSelectFields = {
    ...publicSelectFieldCore,
} as const;

// PRIVACY: publicMapSelectFields is the ONLY select that exposes latitude/longitude
// to unauthenticated visitors. It is used exclusively by getMapImages() which
// enforces topics.map_visible = true at the query level (inner JOIN). It omits
// the same internal/PII fields as publicSelectFields, but retains latitude and
// longitude so map markers can be placed.
//
// DO NOT use this field set without the map_visible topic filter.
const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for privacy (same as publicSelectFields)
    filename_original: _omitFilenameOriginalMap,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally for privacy
    user_filename: _omitUserFilenameMap,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally from public payloads
    original_format: _omitOriginalFormatMap,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally from public payloads
    original_file_size: _omitOriginalFileSizeMap,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally from public payloads
    processed: _omitProcessedMap,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted intentionally: color pipeline is admin-only
    color_pipeline_decision: _omitColorPipelineDecisionMap,
    ...publicMapSelectFieldCore
} = adminSelectFields;

const publicMapSelectFields = {
    ...publicMapSelectFieldCore,
} as const;

export const adminSelectFieldKeys = Object.freeze(
    Object.keys(adminSelectFields).sort(),
) as readonly (keyof typeof adminSelectFields)[];

export const publicSelectFieldKeys = Object.freeze(
    Object.keys(publicSelectFields).sort(),
) as readonly (keyof typeof publicSelectFields)[];

export const publicMapSelectFieldKeys = Object.freeze(
    Object.keys(publicMapSelectFields).sort(),
) as readonly (keyof typeof publicMapSelectFields)[];

// Compile-time privacy guard: if latitude, longitude, filename_original, or user_filename
// are ever added to publicSelectFields, this assertion will produce a TypeScript error.
// This prevents accidental PII leakage in public-facing API responses.
// The guard uses Extract to find any sensitive keys that exist in publicSelectFields.
// If the result is `never` (no sensitive keys), the guard passes. Otherwise, the
// offending key name(s) appear in the type error.
type _PrivacySensitiveKeys = 'latitude' | 'longitude' | 'filename_original' | 'user_filename' | 'processed' | 'original_format' | 'original_file_size' | 'color_pipeline_decision';
type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>;
const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [_SensitiveKeysInPublic, 'ERROR: privacy-sensitive field found in publicSelectFields — see PRIVACY comment above'] = true;
void _privacyGuard;

// Compile-time guard for publicMapSelectFields: it must NOT contain any admin-only
// field beyond latitude and longitude. The allowed set is exactly publicSelectFields
// UNION {latitude, longitude}. If any OTHER sensitive key leaks in, this guard fires.
type _MapSensitiveKeys = 'filename_original' | 'user_filename' | 'processed' | 'original_format' | 'original_file_size' | 'color_pipeline_decision';
type _MapSensitiveKeysInPublicMap = Extract<keyof typeof publicMapSelectFields, _MapSensitiveKeys>;
const _mapPrivacyGuard: _MapSensitiveKeysInPublicMap extends never ? true : [_MapSensitiveKeysInPublicMap, 'ERROR: privacy-sensitive field found in publicMapSelectFields — must only add latitude/longitude vs publicSelectFields'] = true;
void _mapPrivacyGuard;

// Cycle 1 RPF loop AGG1-L07 / A1-LOW-01: compile-time guard against
// adding large/perf-sensitive payload fields to the public listing
// select shape. The fixture-style test at
// `__tests__/data-tag-names-sql.test.ts` checks the literal string
// `blur_data_url`, but a future contributor who renames the SELECT
// alias (e.g. `blurDataUrl: images.blur_data_url`) would sidestep the
// regex. This type guard catches the underlying schema-key add at
// compile time regardless of the alias used.
//
// The masonry listing payload should stay lean — `blur_data_url`
// values run 200-500 bytes each and would inflate SSR HTML by a
// noticeable factor on a 30-image page. Individual photo queries
// fetch the field directly via `images.blur_data_url`.
type _LargePayloadKeys = 'blur_data_url';
type _LargePayloadKeysInPublic = Extract<keyof typeof publicSelectFields, _LargePayloadKeys>;
const _largePayloadGuard: _LargePayloadKeysInPublic extends never ? true : [_LargePayloadKeysInPublic, 'ERROR: large-payload field found in publicSelectFields — fetch in individual queries instead, see CLAUDE.md "Image Processing Pipeline" / "Performance Optimizations"'] = true;
void _largePayloadGuard;

export async function getTopics() {
    return db.select().from(topics).orderBy(asc(topics.order));
}

export async function getTopicsWithAliases() {
    const [allTopics, allAliases] = await Promise.all([
        db.select().from(topics).orderBy(asc(topics.order)),
        db.select().from(topicAliases),
    ]);

    // Use Map for O(1) alias lookup instead of O(N*M) nested filter
    const aliasMap = new Map<string, string[]>();
    for (const a of allAliases) {
        const existing = aliasMap.get(a.topicSlug);
        if (existing) {
            existing.push(a.alias);
        } else {
            aliasMap.set(a.topicSlug, [a.alias]);
        }
    }

    return allTopics.map(topic => ({
        ...topic,
        aliases: aliasMap.get(topic.slug) ?? []
    }));
}

async function _getTags(topic?: string) {
    const conditions = [eq(images.processed, true)];
    if (topic) {
        conditions.push(eq(images.topic, topic));
    }

    return db.select({
        id: tags.id,
        name: tags.name,
        slug: tags.slug,
        count: sql<number>`count(${imageTags.imageId})`
    })
    .from(tags)
    .leftJoin(imageTags, eq(tags.id, imageTags.tagId))
    .leftJoin(images, eq(imageTags.imageId, images.id))
    .where(and(...conditions))
    .groupBy(tags.id)
    .orderBy(desc(sql`count(${imageTags.imageId})`), asc(tags.name));
}

export async function getTags(topic?: string) {
    return _getTags(topic);
}

export async function getImageCount(
    topic?: string,
    tagSlugs?: string[],
    options?: { includeUnprocessed?: boolean },
): Promise<number> {
    const conditions = [];

    if (topic !== undefined) {
        if (!isValidSlug(topic)) return 0;
        conditions.push(eq(images.topic, topic));
    }

    if (!options?.includeUnprocessed) {
        conditions.push(eq(images.processed, true));
    }

    const tagFilter = buildTagFilterCondition(tagSlugs);
    if (tagFilter) conditions.push(tagFilter);

    const result = await db.select({ count: sql<number>`count(*)` })
        .from(images)
        .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
}

/** Build tag-filter conditions (shared between getImages and getImagesLite). */
function buildTagFilterCondition(tagSlugs?: string[]) {
    const validTagSlugs = [...new Set((tagSlugs || [])
        .map(s => s.trim())
        .filter(isValidTagSlug))];
    if (validTagSlugs.length === 0) return null;
    const tagConditions = validTagSlugs.map(slug => eq(tags.slug, slug));
    return inArray(images.id, db
        .select({ imageId: imageTags.imageId })
        .from(imageTags)
        .innerJoin(tags, eq(imageTags.tagId, tags.id))
        .where(or(...tagConditions))
        .groupBy(imageTags.imageId)
        .having(sql`COUNT(DISTINCT ${tags.slug}) = ${validTagSlugs.length}`));
}

function buildImageConditions(topic?: string, tagSlugs?: string[], includeUnprocessed = false) {
    const conditions = [];
    if (topic !== undefined) {
        if (!isValidSlug(topic)) return null;
        conditions.push(eq(images.topic, topic));
    }
    if (!includeUnprocessed) {
        conditions.push(eq(images.processed, true));
    }
    const tagFilter = buildTagFilterCondition(tagSlugs);
    if (tagFilter) conditions.push(tagFilter);
    return conditions;
}

/**
 * Shared `tag_names` aggregation expression for the lite/listing
 * queries. Returns a comma-separated list of distinct tag names
 * ordered alphabetically — the consumer (`humanizeTagLabel` in
 * `photo-title.ts`) splits on `,`.
 *
 * Cycle 2 RPF loop AGG2-M06 / A2-MED-01: factored out so the three
 * call sites (`getImagesLite`, `getImagesLitePage`,
 * `getAdminImagesLite`) cannot drift independently. The
 * fixture-style test at
 * `__tests__/data-tag-names-sql.test.ts` locks the LEFT JOIN +
 * GROUP BY shape; this constant locks the column expression.
 */
const tagNamesAgg = sql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`;

/**
 * Maximum number of image rows a listing query may return.
 * Used as a safety cap to prevent unbounded result sets.
 */
const LISTING_QUERY_LIMIT = 100;
/** Limit + 1 for has-more detection (fetch N+1, return first N). */
const LISTING_QUERY_LIMIT_PLUS_ONE = LISTING_QUERY_LIMIT + 1;

export type ImageListCursor = {
    capture_date: string | null;
    created_at: Date;
    id: number;
};

export type ImageListCursorInput = {
    capture_date: string | null;
    created_at: string | Date;
    id: number;
};

const MYSQL_DATETIME_CURSOR_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;
const ISO_DATETIME_CURSOR_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_CURSOR_DATETIME_LENGTH = 32;

export function getImageListCursor(image: Pick<ImageListCursorInput, 'capture_date' | 'created_at' | 'id'> | null | undefined): ImageListCursorInput | null {
    if (!image) return null;
    return {
        capture_date: image.capture_date ?? null,
        created_at: image.created_at,
        id: image.id,
    };
}

function normalizeCaptureDateString(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CURSOR_DATETIME_LENGTH) return null;
    if (MYSQL_DATETIME_CURSOR_RE.test(trimmed)) return trimmed;
    return null;
}

function normalizeCreatedAt(value: string | Date): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CURSOR_DATETIME_LENGTH) return null;
    if (ISO_DATETIME_CURSOR_RE.test(trimmed) || MYSQL_DATETIME_CURSOR_RE.test(trimmed)) {
        const date = new Date(trimmed);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

export function normalizeImageListCursor(value: unknown): ImageListCursor | null {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<ImageListCursorInput>;
    if (
        typeof candidate.id !== 'number'
        || !Number.isInteger(candidate.id)
        || candidate.id <= 0
    ) {
        return null;
    }
    const captureDate = candidate.capture_date === null
        ? null
        : (typeof candidate.capture_date === 'string' ? normalizeCaptureDateString(candidate.capture_date) : null);
    if (candidate.capture_date !== null && captureDate === null) return null;

    const createdAt = typeof candidate.created_at === 'string' || candidate.created_at instanceof Date
        ? normalizeCreatedAt(candidate.created_at)
        : null;
    if (!createdAt) return null;

    return {
        id: candidate.id,
        capture_date: captureDate,
        created_at: createdAt,
    };
}

function buildCursorCondition(cursor: ImageListCursor) {
    const createdAt = cursor.created_at;
    if (cursor.capture_date === null) {
        return and(
            isNull(images.capture_date),
            or(
                lt(images.created_at, createdAt),
                and(eq(images.created_at, createdAt), lt(images.id, cursor.id)),
            ),
        );
    }

    // C10-LOW-01: isNotNull(capture_date) guards on dated branches match the
    // getImage adjacency pattern (C6F-02). MySQL NULL comparisons already
    // exclude NULL rows, but the explicit guard makes the intent clear and
    // prevents a future developer from misinterpreting the missing guard as
    // an oversight.
    return or(
        isNull(images.capture_date),
        and(isNotNull(images.capture_date), lt(images.capture_date, cursor.capture_date)),
        and(isNotNull(images.capture_date), eq(images.capture_date, cursor.capture_date), lt(images.created_at, createdAt)),
        and(isNotNull(images.capture_date), eq(images.capture_date, cursor.capture_date), eq(images.created_at, createdAt), lt(images.id, cursor.id)),
    );
}

/**
 * Lightweight image listing — uses LEFT JOIN + GROUP BY on images.id with
 * Drizzle column references inside GROUP_CONCAT so tag_names reliably
 * aggregates per row. The earlier scalar-subquery shape (with raw `it` /
 * `t` SQL aliases) returned NULL for every row in production, defeating
 * the gallery aria-labels that depend on tag_names.
 *
 * Perf: groupBy(images.id) re-introduces a sort/group step. On
 * personal-gallery scale (a few thousand images, paginated 30 at a time)
 * this matches the working pattern in getImages() below and the cost is
 * acceptable. See CLAUDE.md "Performance Optimizations" for the
 * `tag_names` SQL shape rationale.
 */
// PRIVACY: `selectFields` intentionally omits latitude, longitude,
// filename_original, and user_filename for public-facing queries.
// Do NOT add those fields. See CLAUDE.md "Privacy" section.
export async function getImagesLite(topic?: string, tagSlugs?: string[], limit: number = 0, offsetOrCursor: number | ImageListCursorInput = 0, includeUnprocessed: boolean = false) {
    const conditions = buildImageConditions(topic, tagSlugs, includeUnprocessed);
    if (conditions === null) return [];

    const baseQuery = db.select({
        ...publicSelectFields,
        tag_names: tagNamesAgg,
    })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const normalizedCursor = normalizeImageListCursor(offsetOrCursor);
    const cursorCondition = normalizedCursor ? buildCursorCondition(normalizedCursor) : null;
    const allConditions = cursorCondition ? [...conditions, cursorCondition] : conditions;
    const query = allConditions.length > 0
        ? baseQuery.where(and(...allConditions))
        : baseQuery;

    const effectiveLimit = limit > 0 ? Math.min(limit, LISTING_QUERY_LIMIT_PLUS_ONE) : LISTING_QUERY_LIMIT_PLUS_ONE;
    if (normalizedCursor) {
        return query.limit(effectiveLimit);
    }
    const offset = Math.max(Math.floor(Number(offsetOrCursor)) || 0, 0);
    return query.limit(effectiveLimit).offset(offset);
}

export function normalizePaginatedRows<T extends { total_count: number | null }>(
    rows: T[],
    pageSize: number,
): {
    rows: Omit<T, 'total_count'>[];
    totalCount: number;
    hasMore: boolean;
} {
    const normalizedPageSize = Math.max(0, pageSize);
    const visibleRows = rows.slice(0, normalizedPageSize).map((row) => {
        const { total_count, ...visibleRow } = row;
        void total_count;
        return visibleRow as Omit<T, 'total_count'>;
    });

    return {
        rows: visibleRows,
        totalCount: Number(rows[0]?.total_count ?? 0),
        hasMore: rows.length > normalizedPageSize,
    };
}

export async function getImagesLitePage(
    topic?: string,
    tagSlugs?: string[],
    pageSize: number = 30,
    offset: number = 0,
    includeUnprocessed: boolean = false,
) {
    const conditions = buildImageConditions(topic, tagSlugs, includeUnprocessed);
    if (conditions === null) {
        return { images: [], totalCount: 0, hasMore: false };
    }

    const normalizedPageSize = Math.min(Math.max(pageSize, 1), LISTING_QUERY_LIMIT_PLUS_ONE);
    const baseQuery = db.select({
        ...publicSelectFields,
        tag_names: tagNamesAgg,
        total_count: sql<number>`COUNT(*) OVER()`,
    })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    const rows = await query.limit(normalizedPageSize + 1).offset(offset);
    const { rows: pageRows, totalCount, hasMore } = normalizePaginatedRows(rows, normalizedPageSize);

    return {
        images: pageRows,
        totalCount,
        hasMore,
    };
}

/**
 * Full image listing with tag names via GROUP_CONCAT.
 * Use when tag_names need to be displayed (e.g., admin dashboard).
 */
export async function getImages(topic?: string, tagSlugs?: string[], limit: number = 0, offset: number = 0, includeUnprocessed: boolean = false) {
    const conditions = buildImageConditions(topic, tagSlugs, includeUnprocessed);
    if (conditions === null) return [];

    const baseQuery = db.select({
        ...publicSelectFields,
        tag_names: tagNamesAgg,
    })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    const effectiveLimit = limit > 0 ? Math.min(limit, LISTING_QUERY_LIMIT) : LISTING_QUERY_LIMIT;
    return query.limit(effectiveLimit).offset(offset);
}

export async function getAdminImagesLite(limit: number = 0, offset: number = 0, includeUnprocessed: boolean = false) {
    const conditions = [];
    if (!includeUnprocessed) {
        conditions.push(eq(images.processed, true));
    }

    const baseQuery = db.select({
        ...adminListSelectFields,
        tag_names: tagNamesAgg,
    })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    const effectiveLimit = limit > 0 ? Math.min(limit, LISTING_QUERY_LIMIT) : LISTING_QUERY_LIMIT;
    return query.limit(effectiveLimit).offset(offset);
}

export async function getImage(id: number) {
    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    // Only return explicitly processed images.
    // C5F-03: .limit(1) is defense-in-depth on a primary-key lookup.
    const [image] = await db.select({
        ...publicSelectFields,
        blur_data_url: images.blur_data_url,
        topic_label: topics.label
    })
        .from(images)
        .leftJoin(topics, eq(images.topic, topics.slug))
        .where(
            and(
                eq(images.id, id),
                eq(images.processed, true)
            )
        )
        .limit(1);

    if (!image) {
        return null;
    }

    // C6-AGG6R-01: Build prev/next navigation conditions dynamically
    // to eliminate dead sql`FALSE` branches that polluted the generated
    // SQL. Each branch now only includes conditions relevant to the
    // image's date status (dated vs undated).
    //
    // Sort order: capture_date DESC NULLS LAST, created_at DESC, id DESC
    // Prev: rows that sort BEFORE this image (ASC order → closest predecessor)
    // Next: rows that sort AFTER this image (DESC order → closest successor)

    const prevConditions: (SQL | undefined)[] = [];
    const nextConditions: (SQL | undefined)[] = [];

    if (image.capture_date) {
        // C5F-01: Dated image in sort order capture_date DESC NULLS LAST.
        // C6F-02: isNotNull(capture_date) guards on dated-only branches make the
        // intent explicit — MySQL NULL comparisons are already falsy, but without
        // the guard the code depends on implicit NULL semantics and is fragile.
        // Prev (ASC direction): rows that sort BEFORE this image.
        //   - Dated rows with later capture_date, same-date with later created_at/id.
        //   - Undated rows (NULL) sort LAST in ASC, so they are NOT predecessors
        //     of dated rows.
        prevConditions.push(
            and(isNotNull(images.capture_date), gt(images.capture_date, image.capture_date)),
            and(isNotNull(images.capture_date), eq(images.capture_date, image.capture_date), gt(images.created_at, image.created_at)),
            and(isNotNull(images.capture_date), eq(images.capture_date, image.capture_date), eq(images.created_at, image.created_at), gt(images.id, image.id)),
        );
        // Next (DESC direction): rows that sort AFTER this image.
        //   - Undated rows (NULL sorts last in DESC → first in "after" direction),
        //     so they ARE successors of dated rows. The closest undated successor
        //     has the latest created_at among undated rows.
        //   - Dated rows with earlier capture_date, same-date with earlier created_at/id.
        //   - Parity with buildCursorCondition (lines 553-558) which correctly
        //     includes isNull(capture_date) in the "after" direction for dated cursors.
        nextConditions.push(
            isNull(images.capture_date),
            and(isNotNull(images.capture_date), lt(images.capture_date, image.capture_date)),
            and(isNotNull(images.capture_date), eq(images.capture_date, image.capture_date), lt(images.created_at, image.created_at)),
            and(isNotNull(images.capture_date), eq(images.capture_date, image.capture_date), eq(images.created_at, image.created_at), lt(images.id, image.id)),
        );
    } else {
        // C5F-01: Undated image in sort order capture_date DESC NULLS LAST.
        // All dated rows sort BEFORE all undated rows, so:
        // Prev (ASC direction): any dated row is a valid predecessor (they all
        //   sort before undated rows). Also undated rows with later created_at/id.
        //   The closest dated predecessor has the latest capture_date (or same
        //   capture_date with latest created_at/id) — the prev query's
        //   ORDER BY asc(capture_date) will naturally pick the last dated row
        //   before the undated block.
        // C10-LOW-02: use isNull() from drizzle-orm instead of raw sql
        // template for consistency with the isNotNull() usage in the dated
        // branches (C6F-02) and to benefit from Drizzle's identifier
        // quoting/safety.
        prevConditions.push(
            isNotNull(images.capture_date),
            and(isNull(images.capture_date), gt(images.created_at, image.created_at)),
            and(isNull(images.capture_date), eq(images.created_at, image.created_at), gt(images.id, image.id)),
        );
        // Next (DESC direction): only undated rows with earlier created_at/id.
        // No dated row can be a successor because all dated rows sort before
        // undated rows in DESC order.
        nextConditions.push(
            and(isNull(images.capture_date), lt(images.created_at, image.created_at)),
            and(isNull(images.capture_date), eq(images.created_at, image.created_at), lt(images.id, image.id)),
        );
    }

    const [imageTagsResult, prevResult, nextResult] = await Promise.all([
        db.select({
            name: tags.name,
            slug: tags.slug
        })
            .from(imageTags)
            .innerJoin(tags, eq(imageTags.tagId, tags.id))
            .where(eq(imageTags.imageId, id)),

        // Prev: the nearest row before this image in gallery grid order
        db.select({
            id: images.id,
            filename_avif: images.filename_avif,
            filename_webp: images.filename_webp,
            filename_jpeg: images.filename_jpeg,
            width: images.width,
            height: images.height,
        })
            .from(images)
            .where(
                and(
                    or(...prevConditions.filter(Boolean)),
                    eq(images.processed, true)
                )
            )
            .orderBy(asc(images.capture_date), asc(images.created_at), asc(images.id))
            .limit(1),

        // Next: the nearest row after this image in the same grid order
        db.select({
            id: images.id,
            filename_avif: images.filename_avif,
            filename_webp: images.filename_webp,
            filename_jpeg: images.filename_jpeg,
            width: images.width,
            height: images.height,
        })
            .from(images)
            .where(
                and(
                    or(...nextConditions.filter(Boolean)),
                    eq(images.processed, true)
                )
            )
            .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id))
            .limit(1),
    ]);

    const [prevImage] = prevResult;
    const [nextImage] = nextResult;

    return {
        ...image,
        tags: imageTagsResult,
        prevId: prevImage?.id ?? null,
        nextId: nextImage?.id ?? null,
        prevImage: prevImage ?? null,
        nextImage: nextImage ?? null,
    };
}

// PRIVACY: This query serves the public /s/[key] route (unauthenticated).
// `selectFields` intentionally omits latitude, longitude, filename_original,
// and user_filename. Do NOT add those fields — they would leak PII to
// unauthenticated visitors. See CLAUDE.md "Privacy" section.
// C14-MED-01: collapsed image + tags into a single query using LEFT JOIN +
// GROUP_CONCAT (matching getImagesLite pattern). Previously this function
// issued 2 sequential DB queries (image row, then tags), adding one round-
// trip per shared-photo page load.
export async function getImageByShareKey(key: string) {
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, 10)) {
        return null;
    }

    // C4F-08 / C4F-09: include blur_data_url and topic_label for
    // consistency with getSharedGroup (blur placeholder) and getImage
    // (topic display label). Without blur_data_url the shared photo
    // page (/s/[key]) falls back to a shimmer skeleton during decode.
    const [result] = await db.select({
        ...publicSelectFields,
        blur_data_url: images.blur_data_url,
        topic_label: topics.label,
        // C16-MED-02: combined GROUP_CONCAT with null-byte inner delimiter and
        // explicit \x01 outer separator eliminates index-based zip alignment issues
        // and removes the assumption that the default comma separator is safe.
        // C20-LOW-02: use explicit SEPARATOR '\x01' instead of MySQL's default
        // comma so the parsing is robust against any future change to MySQL's
        // default separator or tag slug format.
        tag_concat: sql<string | null>`GROUP_CONCAT(DISTINCT CONCAT(${tags.slug}, CHAR(0), ${tags.name}) ORDER BY ${tags.slug} SEPARATOR CHAR(1))`,
    })
        .from(images)
        .leftJoin(topics, eq(images.topic, topics.slug))
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .where(
            and(
                eq(images.share_key, trimmedKey),
                eq(images.processed, true)
            )
        )
        .groupBy(images.id)
        .limit(1);

    if (!result) return null;

    // C16-MED-02: Parse combined GROUP_CONCAT by splitting on the record
    // delimiter (CHAR(1) / \x01, set via SEPARATOR clause above), then
    // splitting each entry on the null byte to extract slug and name.
    // GROUP_CONCAT returns null when no tags exist (LEFT JOIN produced no rows).
    // C20-LOW-02: split on \x01 instead of comma to match the explicit SEPARATOR.
    const imageTagsList: { slug: string; name: string }[] = [];
    if (result.tag_concat) {
        for (const entry of result.tag_concat.split('\x01')) {
            const nullIdx = entry.indexOf('\0');
            if (nullIdx === -1) continue; // skip malformed entries
            imageTagsList.push({ slug: entry.slice(0, nullIdx), name: entry.slice(nullIdx + 1) });
        }
    }

    // Destructure to strip tag_concat from the return value
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- intentionally stripped from return value
    const { tag_concat: _tagConcat, ...imageFields } = result;

    return {
        ...imageFields,
        tags: imageTagsList,
        prevId: null,
        nextId: null
    };
}

// PRIVACY: This query serves the public /g/[key] route (unauthenticated).
// `selectFields` intentionally omits latitude, longitude, filename_original,
// and user_filename. Do NOT add those fields — they would leak PII to
// unauthenticated visitors. See CLAUDE.md "Privacy" section.
export async function getSharedGroup(
    key: string,
    options?: { incrementViewCount?: boolean; selectedPhotoId?: number | null },
) {
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, 10)) {
        return null;
    }

    // Single query: fetch group and check expiry atomically
    const [group] = await db.select().from(sharedGroups)
        .where(
            and(
                eq(sharedGroups.key, trimmedKey),
                or(
                    sql`${sharedGroups.expires_at} > NOW()`,
                    sql`${sharedGroups.expires_at} IS NULL`
                )
            )
        )
        .limit(1);
    if (!group) return null;

    const groupImages = await db.select({
        ...publicSelectFields,
        blur_data_url: images.blur_data_url,
    })
    .from(sharedGroupImages)
    .innerJoin(images, eq(sharedGroupImages.imageId, images.id))
    .where(
        and(
            eq(sharedGroupImages.groupId, group.id),
            eq(images.processed, true)
        )
    )
    .orderBy(asc(sharedGroupImages.position), asc(sharedGroupImages.imageId))
    // C6F-05: limit(100) matches the SHARE_MAX_IMAGES cap enforced at group
    // creation time in sharing.ts (uniqueImageIds.length > 100 check). The
    // read-path limit is a safety cap — if a group somehow exceeds 100 images
    // (e.g. via a direct DB edit), extras are silently dropped.
    .limit(100);

    // Fetch tags for all images in a single batched query (avoids N+1)
    let imagesWithTags: (typeof groupImages[number] & { tags: { slug: string; name: string }[] })[];
    if (groupImages.length > 0) {
        const imageIds = groupImages.map(img => img.id);
        const allTagRows = await db.select({
            imageId: imageTags.imageId,
            slug: tags.slug,
            name: tags.name,
        })
        .from(imageTags)
        .innerJoin(tags, eq(imageTags.tagId, tags.id))
        .where(inArray(imageTags.imageId, imageIds));

        const tagsByImage = new Map<number, { slug: string; name: string }[]>();
        for (const t of allTagRows) {
            const arr = tagsByImage.get(t.imageId) || [];
            arr.push({ slug: t.slug, name: t.name });
            tagsByImage.set(t.imageId, arr);
        }

        imagesWithTags = groupImages.map(img => ({
            ...img,
            tags: tagsByImage.get(img.id) || [],
        }));
    } else {
        imagesWithTags = [];
    }

    // C6F-01: return the group even when images are empty (still processing
    // or all unprocessed) so the page can show a meaningful state instead of
    // a 404. Previously returned null, which made valid shared links appear
    // broken while images were being processed.
    // Increment view count only after the image fetch succeeds — avoids
    // overcounting on DB errors during the image JOIN query. Skip the
    // increment when there are no processed images to avoid inflating
    // the counter for groups with no visible content yet. A valid selected
    // photo is a within-group navigation state, not a fresh group view; invalid
    // or missing photoId values still count as a group-view lookup.
    const selectedPhotoId = options?.selectedPhotoId;
    const hasSelectedPhoto = typeof selectedPhotoId === 'number'
        && imagesWithTags.some((image) => image.id === selectedPhotoId);
    if (imagesWithTags.length > 0 && options?.incrementViewCount !== false && !hasSelectedPhoto) {
        bufferGroupViewCount(group.id);
    }

    return {
        ...group,
        images: imagesWithTags
    };
}

export async function getTopicBySlug(slug: string) {
    // Direct topic slugs are always ASCII-safe; aliases may contain CJK/emoji
    // C20-AGG-02: use isValidSlug() instead of inline regex for consistency
    // with getImageCount and buildImageConditions (C19-AGG-02 fix).
    if (isValidSlug(slug)) {
        const [directMatch] = await db
            .select({
                slug: topics.slug,
                label: topics.label,
                order: topics.order,
                image_filename: topics.image_filename,
            })
            .from(topics)
            .where(eq(topics.slug, slug))
            .limit(1);

        if (directMatch) {
            return directMatch;
        }
    }

    // Always check aliases regardless of format — CJK/emoji aliases are valid
    const [aliasMatch] = await db
        .select({
            slug: topics.slug,
            label: topics.label,
            order: topics.order,
            image_filename: topics.image_filename,
        })
        .from(topicAliases)
        .innerJoin(topics, eq(topicAliases.topicSlug, topics.slug))
        .where(eq(topicAliases.alias, slug))
        .limit(1);

    return aliasMatch || null;
}

// ── Smart Collections ─────────────────────────────────────────────────────────

export async function getSmartCollectionBySlug(slug: string) {
    if (!isValidSlug(slug)) return null;
    const [row] = await db
        .select({
            id: smartCollections.id,
            slug: smartCollections.slug,
            name: smartCollections.name,
            query_json: smartCollections.query_json,
            is_public: smartCollections.is_public,
            created_at: smartCollections.created_at,
        })
        .from(smartCollections)
        .where(eq(smartCollections.slug, slug))
        .limit(1);
    return row || null;
}

export const getSmartCollectionBySlugCached = cache(getSmartCollectionBySlug);

/**
 * Execute a compiled smart-collection SQL condition against the images table,
 * returning paginated public-facing results with tag names.
 */
export async function getImagesForSmartCollection(
    compiledCondition: SQL,
    pageSize: number = 30,
    offset: number = 0,
) {
    const normalizedPageSize = Math.min(Math.max(pageSize, 1), LISTING_QUERY_LIMIT_PLUS_ONE);

    const baseQuery = db.select({
        ...publicSelectFields,
        tag_names: tagNamesAgg,
        total_count: sql<number>`COUNT(*) OVER()`,
    })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = baseQuery.where(and(compiledCondition, eq(images.processed, true)));
    const rows = await query.limit(normalizedPageSize + 1).offset(offset);
    const { rows: pageRows, totalCount, hasMore } = normalizePaginatedRows(rows, normalizedPageSize);

    return {
        images: pageRows,
        totalCount,
        hasMore,
    };
}

// PRIVACY: SearchResult omits filename_webp and filename_avif to minimize
// internal filename exposure to unauthenticated users. filename_jpeg is
// retained because the search UI needs it for thumbnail rendering.
interface SearchResult {
    id: number;
    title: string | null;
    description: string | null;
    filename_jpeg: string;
    width: number;
    height: number;
    topic: string;
    topic_label: string | null;
    camera_model: string | null;
    lens_model: string | null;
    capture_date: string | null;
    created_at: Date;
}

export type { SearchResult };

export async function searchImages(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    // C21-AGG-01: use countCodePoints for query length validation so
    // supplementary characters (emoji, rare CJK) count as one character
    // each, matching the countCodePoints pattern in searchImagesAction
    // (public.ts) and the password/title/description/label/SEO fields.
    if (countCodePoints(query) > 200) return [];
    if (limit <= 0) return [];
    const effectiveLimit = Math.min(Math.max(limit, 1), 100);

    // R2C11-LOW-06: LIKE escaping assumes backslash escape semantics
    // (standard MySQL default). If the server runs with
    // NO_BACKSLASH_ESCAPES SQL mode, the escaping below would be weakened
    // because backslash would no longer be treated as an escape character.
    // At personal-gallery scale this is an acceptable risk; for
    // multi-tenant or hardened deployments, consider using parameterized
    // full-text search or a dedicated search engine instead.
    const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
    const searchTerm = `%${escaped}%`;

    // PRIVACY: Omit filename_webp and filename_avif from public search results
    // to minimize internal filename exposure. filename_jpeg is needed for thumbnails.
    // C6F-03: created_at included in SELECT and GROUP BY for strict SQL mode
    // compatibility (ORDER BY references it).
    // C8-MED-02 / C7-MED-04: MAINTENANCE NOTE — any new column added to
    // searchFields MUST also be added to searchGroupByColumns below.
    // MySQL ONLY_FULL_GROUP_BY mode will reject queries where a selected
    // column is not in the GROUP BY or an aggregate function.
    // C14-MED-02: extracted the GROUP BY column list into a shared array so
    // the tag and alias queries cannot drift independently. Adding a field to
    // searchFields requires adding it here too (single place to update).
    // C19F-MED-01: derive searchGroupByColumns from searchFields so adding
    // a column to searchFields without updating GROUP BY is a compile-time
    // error rather than a runtime ONLY_FULL_GROUP_BY failure.
    const searchFields = {
        id: images.id, title: images.title, description: images.description,
        filename_jpeg: images.filename_jpeg, width: images.width, height: images.height,
        topic: images.topic, topic_label: topics.label, camera_model: images.camera_model,
        lens_model: images.lens_model,
        capture_date: images.capture_date, created_at: images.created_at,
    };

    // Derive GROUP BY columns from searchFields values so they cannot drift.
    // Object.values preserves insertion order in ES6+ for string keys.
    const searchGroupByColumns = Object.values(searchFields);

    // Run main query first; only query tags if we need more results (saves a connection)
    // C16-LOW-02: GROUP BY is intentionally omitted here because this branch
    // does not JOIN imageTags or tags. The tag/alias branches below DO use
    // GROUP BY because they JOIN those tables. If a future refactor adds a
    // tag JOIN here, GROUP BY must be added to match those branches.
    const results = await db.select(searchFields).from(images)
        .leftJoin(topics, eq(images.topic, topics.slug))
        .where(and(
            eq(images.processed, true),
            or(
                like(images.title, searchTerm),
                like(images.description, searchTerm),
                like(images.camera_model, searchTerm),
                like(images.lens_model, searchTerm),
                like(images.topic, searchTerm),
                like(topics.label, searchTerm),
            )
        ))
        // C4F-12: ORDER BY matches gallery sort order (capture_date DESC,
        // created_at DESC, id DESC) so search results are consistent with
        // browsing. MySQL sorts NULL capture_date last in DESC, matching
        // the gallery grid behavior for undated photos.
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id))
        .limit(effectiveLimit);

    // Short-circuit: if the main query already filled the limit, skip
    // the expensive tag and alias queries. This avoids 2 unnecessary DB
    // round-trips on popular search terms that match in title/description/etc.
    if (results.length >= effectiveLimit) {
        return results;
    }

    // C3-AGG-03: run tag and alias queries in parallel when the main
    // query is insufficient. The alias query only needs mainIds for
    // dedup (not tag results), so both can start simultaneously,
    // reducing the sequential 3-query worst case to 2 sequential rounds.
    //
    // C3-PR-01: The alias-query limit is capped at `remainingLimit` rather
    // than `effectiveLimit - mainIds.length` to avoid over-fetching when
    // both tag and alias queries return results. Since both queries run in
    // parallel, neither can account for the other's results. The worst-case
    // total DB rows fetched is `results + remainingLimit + remainingLimit`,
    // bounded by `2 * effectiveLimit`. The final `.slice(0, effectiveLimit)`
    // and dedup Set ensure the returned result is correct. Serializing the
    // alias query after the tag query would eliminate the over-fetch but
    // adds latency (3 sequential rounds instead of 2). At personal-gallery
    // scale the over-fetch is acceptable.
    const remainingLimit = effectiveLimit - results.length;
    const mainIds = results.map(r => r.id);

    const tagConditions = [eq(images.processed, true), like(tags.name, searchTerm)];
    if (mainIds.length > 0) {
        tagConditions.push(notInArray(images.id, mainIds));
    }

    const aliasConditions = [eq(images.processed, true), like(topicAliases.alias, searchTerm)];
    if (mainIds.length > 0) {
        aliasConditions.push(notInArray(images.id, mainIds));
    }
    const aliasRemainingLimit = remainingLimit;

    const [tagResults, aliasResults] = remainingLimit <= 0
        ? [[], []] as [SearchResult[], SearchResult[]]
        : await Promise.all([
            db.select(searchFields)
                .from(images)
                .leftJoin(topics, eq(images.topic, topics.slug))
                .innerJoin(imageTags, eq(images.id, imageTags.imageId))
                .innerJoin(tags, eq(imageTags.tagId, tags.id))
                .where(and(...tagConditions))
                .groupBy(...searchGroupByColumns)
                .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id))
                .limit(remainingLimit),
            aliasRemainingLimit <= 0 ? [] : db.select(searchFields)
                .from(images)
                .leftJoin(topics, eq(images.topic, topics.slug))
                .innerJoin(topicAliases, eq(images.topic, topicAliases.topicSlug))
                .where(and(...aliasConditions))
                .groupBy(...searchGroupByColumns)
                .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id))
                .limit(aliasRemainingLimit),
        ]);

    const seen = new Set<number>();
    const combined: SearchResult[] = [];
    for (const r of [...results, ...tagResults, ...aliasResults]) {
        if (!seen.has(r.id)) {
            seen.add(r.id);
            combined.push(r);
        }
    }

    return combined.slice(0, effectiveLimit);
}

/** Lightweight query for sitemap: only id + created_at, no JOINs, no TEXT columns */
export async function getImageIdsForSitemap(limit: number = 24000) {
    const safeLimit = Math.min(Math.max(limit, 1), 50000);
    return db.select({
        id: images.id,
        created_at: images.created_at,
    })
    .from(images)
    .where(eq(images.processed, true))
    .orderBy(desc(images.created_at))
    .limit(safeLimit);
}

// PRIVACY: getMapImages is the ONLY public-facing function that exposes
// latitude/longitude. It enforces two layers of GPS-leak prevention:
// 1. SQL layer: INNER JOIN on topics.map_visible = true ensures the DB
//    only returns rows from opted-in topics.
// 2. Runtime layer: every returned row is asserted to have topic_map_visible=true
//    (defense-in-depth — catches future refactors that break the JOIN condition).
// Only images where BOTH latitude IS NOT NULL AND longitude IS NOT NULL are returned.
export async function getMapImages() {
    const rows = await db
        .select({
            ...publicMapSelectFields,
            topic_label: topics.label,
            topic_map_visible: topics.map_visible,
        })
        .from(images)
        .innerJoin(topics, eq(images.topic, topics.slug))
        .where(
            and(
                eq(images.processed, true),
                eq(topics.map_visible, true),
                isNotNull(images.latitude),
                isNotNull(images.longitude),
            )
        );

    // Runtime defense-in-depth: assert every row has map_visible=true.
    for (const row of rows) {
        if (!row.topic_map_visible) {
            throw new Error(
                `[getMapImages] GPS leak guard: image ${row.id} belongs to a map_visible=false topic. Refusing to return GPS data.`
            );
        }
    }

    return rows;
}

export const getImageCached = cache(getImage);
export const getTopicBySlugCached = cache(getTopicBySlug);
export const getTopicsCached = cache(getTopics);
export const getTagsCached = cache(_getTags);
export const getTopicsWithAliasesCached = cache(getTopicsWithAliases);
// Pure function — safe to cache.
export const getImageByShareKeyCached = cache(getImageByShareKey);
// cache() deduplicates calls by arguments within a single request. Shared-group
// lookups may buffer a view-count side effect unless called with
// incrementViewCount:false or a valid selectedPhotoId. Do not call the cached
// wrapper twice with different count semantics in the same render path.
export const getSharedGroupCached = cache(getSharedGroup);

// ── SEO Settings ──────────────────────────────────────────────────────────────
// Reads site-wide SEO/OG settings from the `admin_settings` table.
// Falls back to `site-config.json` defaults for any missing keys.
// Uses React `cache()` for SSR deduplication within a single request.

export interface SeoSettings {
    title: string;
    description: string;
    nav_title: string;
    author: string;
    locale: string;
    url: string;
    og_image_url: string | null;
}

async function _getSeoSettings(): Promise<SeoSettings> {
    let settingsMap = new Map<string, string>();
    try {
        // Read all SEO keys from admin_settings in a single query
        const rows = await db.select({ key: adminSettings.key, value: adminSettings.value })
            .from(adminSettings)
            .where(inArray(adminSettings.key, [...SEO_SETTING_KEYS]));
        settingsMap = new Map(rows.map(r => [r.key, r.value]));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[seo] Falling back to site-config defaults because admin_settings could not be read: ${message}`);
    }

    return {
        title: settingsMap.get('seo_title') || siteConfig.title,
        description: settingsMap.get('seo_description') || siteConfig.description,
        nav_title: settingsMap.get('seo_nav_title') || siteConfig.nav_title,
        author: settingsMap.get('seo_author') || siteConfig.author,
        locale: settingsMap.get('seo_locale') || siteConfig.locale,
        url: process.env.BASE_URL || siteConfig.url,
        og_image_url: settingsMap.get('seo_og_image_url') || null,
    };
}

export const getSeoSettings = cache(_getSeoSettings);
