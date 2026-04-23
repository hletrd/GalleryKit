import { cache } from 'react';
import { db, images, topics, topicAliases, tags, imageTags, sharedGroups, sharedGroupImages, adminSettings } from '@/db';
import { eq, desc, asc, and, gt, lt, or, inArray, notInArray, like } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { isBase56 } from './base56';
import { SEO_SETTING_KEYS } from './gallery-config-shared';
import { isRestoreMaintenanceActive } from './restore-maintenance';
import { isValidTagSlug } from './validation';
import siteConfig from '@/site-config.json';

// Module-level buffer for debounced shared-group view count increments
const viewCountBuffer = new Map<number, number>();
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
    const batch = new Map(viewCountBuffer);
    viewCountBuffer.clear();
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
                        .then((result) => { succeeded++; return result; })
                        .catch(() => {
                            // Re-buffer failed increment in one operation with capacity check.
                            // Using a single Map.set instead of per-increment calls avoids O(n)
                            // overhead when count is large (e.g., accumulated during DB outage).
                            if (viewCountBuffer.size >= MAX_VIEW_COUNT_BUFFER_SIZE && !viewCountBuffer.has(groupId)) {
                                console.warn(`[viewCount] Buffer at capacity, dropping re-buffered increment for group ${groupId}`);
                                return;
                            }
                            viewCountBuffer.set(groupId, (viewCountBuffer.get(groupId) ?? 0) + count);
                        })
                )
            );
        }
    } finally {
        isFlushing = false;
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
    ...publicSelectFieldCore
} = adminSelectFields;

const publicSelectFields = {
    ...publicSelectFieldCore,
} as const;

export const adminSelectFieldKeys = Object.freeze(
    Object.keys(adminSelectFields).sort(),
) as readonly (keyof typeof adminSelectFields)[];

export const publicSelectFieldKeys = Object.freeze(
    Object.keys(publicSelectFields).sort(),
) as readonly (keyof typeof publicSelectFields)[];

// Compile-time privacy guard: if latitude, longitude, filename_original, or user_filename
// are ever added to publicSelectFields, this assertion will produce a TypeScript error.
// This prevents accidental PII leakage in public-facing API responses.
// The guard uses Extract to find any sensitive keys that exist in publicSelectFields.
// If the result is `never` (no sensitive keys), the guard passes. Otherwise, the
// offending key name(s) appear in the type error.
type _PrivacySensitiveKeys = 'latitude' | 'longitude' | 'filename_original' | 'user_filename' | 'processed' | 'original_format' | 'original_file_size';
type _SensitiveKeysInPublic = Extract<keyof typeof publicSelectFields, _PrivacySensitiveKeys>;
const _privacyGuard: _SensitiveKeysInPublic extends never ? true : [_SensitiveKeysInPublic, 'ERROR: privacy-sensitive field found in publicSelectFields — see PRIVACY comment above'] = true;
void _privacyGuard;

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

export async function getTags(topic?: string) {
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

export async function getImageCount(
    topic?: string,
    tagSlugs?: string[],
    options?: { includeUnprocessed?: boolean },
): Promise<number> {
    const conditions = [];

    if (topic !== undefined) {
        if (!/^[a-z0-9_-]+$/.test(topic) || topic.length > 100) return 0;
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
    const validTagSlugs = (tagSlugs || [])
        .map(s => s.trim())
        .filter(isValidTagSlug);
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
        if (!/^[a-z0-9_-]+$/.test(topic) || topic.length > 100) return null;
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
 * Lightweight image listing — uses a scalar subquery for tag_names instead
 * of LEFT JOIN + GROUP BY. Avoids the expensive GROUP_CONCAT that requires
 * grouping the entire result set, while still providing tag names for
 * display titles and alt text in the gallery grid.
 */
// PRIVACY: `selectFields` intentionally omits latitude, longitude,
// filename_original, and user_filename for public-facing queries.
// Do NOT add those fields. See CLAUDE.md "Privacy" section.
export async function getImagesLite(topic?: string, tagSlugs?: string[], limit: number = 0, offset: number = 0, includeUnprocessed: boolean = false) {
    const conditions = buildImageConditions(topic, tagSlugs, includeUnprocessed);
    if (conditions === null) return [];

    const baseQuery = db.select({
        ...publicSelectFields,
        tag_names: sql<string | null>`(SELECT GROUP_CONCAT(DISTINCT t.name ORDER BY t.name) FROM ${imageTags} it JOIN ${tags} t ON it.tag_id = t.id WHERE it.image_id = ${images.id})`,
    })
        .from(images)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    const effectiveLimit = limit > 0 ? Math.min(limit, 100) : 100;
    return query.limit(effectiveLimit).offset(offset);
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
        tag_names: sql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`
    })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    const effectiveLimit = limit > 0 ? Math.min(limit, 100) : 100;
    return query.limit(effectiveLimit).offset(offset);
}

export async function getAdminImagesLite(limit: number = 0, offset: number = 0, includeUnprocessed: boolean = false) {
    const conditions = [];
    if (!includeUnprocessed) {
        conditions.push(eq(images.processed, true));
    }

    const baseQuery = db.select({
        ...adminSelectFields,
        tag_names: sql<string | null>`(SELECT GROUP_CONCAT(DISTINCT t.name ORDER BY t.name) FROM ${imageTags} it JOIN ${tags} t ON it.tag_id = t.id WHERE it.image_id = ${images.id})`,
    })
        .from(images)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    const effectiveLimit = limit > 0 ? Math.min(limit, 100) : 100;
    return query.limit(effectiveLimit).offset(offset);
}

export async function getImage(id: number) {
    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    // Only return explicitly processed images.
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
        );

    if (!image) {
        return null;
    }

    const [imageTagsResult, prevResult, nextResult] = await Promise.all([
        db.select({
            name: tags.name,
            slug: tags.slug
        })
            .from(imageTags)
            .innerJoin(tags, eq(imageTags.tagId, tags.id))
            .where(eq(imageTags.imageId, id)),

        // Prev: Newer image by (capture_date, created_at, id) — matches gallery grid sort order
        // When capture_date is NULL, all dated images are "newer" (NULLs sort last in DESC).
        // Using DESC ordering picks the LATEST-dated image (closest newer), not the earliest.
        db.select({ id: images.id })
            .from(images)
            .where(
                and(
                    or(
                        image.capture_date
                            ? gt(images.capture_date, image.capture_date)
                            : sql`${images.capture_date} IS NOT NULL`,
                        and(
                            image.capture_date
                                ? eq(images.capture_date, image.capture_date)
                                : sql`${images.capture_date} IS NULL`,
                            gt(images.created_at, image.created_at)
                        ),
                        and(
                            image.capture_date
                                ? eq(images.capture_date, image.capture_date)
                                : sql`${images.capture_date} IS NULL`,
                            eq(images.created_at, image.created_at),
                            gt(images.id, image.id)
                        )
                    ),
                    eq(images.processed, true)
                )
            )
            .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id))
            .limit(1),

        // Next: Older image by (capture_date, created_at, id) — matches gallery grid sort order.
        // When capture_date is NULL, FALSE is intentional: in MySQL DESC sort, NULLs sort last,
        // so there are no "older" images by capture_date — only created_at/id tiebreakers apply.
        db.select({ id: images.id })
            .from(images)
            .where(
                and(
                    or(
                        image.capture_date
                            ? lt(images.capture_date, image.capture_date)
                            : sql`FALSE`,
                        and(
                            image.capture_date
                                ? eq(images.capture_date, image.capture_date)
                                : sql`${images.capture_date} IS NULL`,
                            lt(images.created_at, image.created_at)
                        ),
                        and(
                            image.capture_date
                                ? eq(images.capture_date, image.capture_date)
                                : sql`${images.capture_date} IS NULL`,
                            eq(images.created_at, image.created_at),
                            lt(images.id, image.id)
                        )
                    ),
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
        nextId: nextImage?.id ?? null
    };
}

// PRIVACY: This query serves the public /s/[key] route (unauthenticated).
// `selectFields` intentionally omits latitude, longitude, filename_original,
// and user_filename. Do NOT add those fields — they would leak PII to
// unauthenticated visitors. See CLAUDE.md "Privacy" section.
export async function getImageByShareKey(key: string) {
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, [5, 10])) {
        return null;
    }

    const result = await db.select({
        ...publicSelectFields,
    })
        .from(images)
        .where(
            and(
                eq(images.share_key, trimmedKey),
                eq(images.processed, true)
            )
        )
        .limit(1);
    const image = result[0];
    if (!image) return null;

    const [imageTagsResult] = await Promise.all([
        db.select({
                slug: tags.slug,
                name: tags.name
            })
            .from(imageTags)
            .innerJoin(tags, eq(imageTags.tagId, tags.id))
            .where(eq(imageTags.imageId, image.id)),
    ]);

    return {
        ...image,
        tags: imageTagsResult,
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
    options?: { incrementViewCount?: boolean },
) {
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, [6, 10])) {
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

    // Increment view count only after the image fetch succeeds — avoids
    // overcounting on DB errors during the image JOIN query.
    if (options?.incrementViewCount !== false) {
        bufferGroupViewCount(group.id);
    }

    return {
        ...group,
        images: imagesWithTags
    };
}

export async function getTopicBySlug(slug: string) {
    // Direct topic slugs are always ASCII-safe; aliases may contain CJK/emoji
    if (/^[a-z0-9_-]+$/.test(slug)) {
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
    capture_date: string | null;
}

export type { SearchResult };

export async function searchImages(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    if (query.length > 200) return [];
    if (limit <= 0) return [];
    const effectiveLimit = Math.min(Math.max(limit, 1), 100);

    const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
    const searchTerm = `%${escaped}%`;

    // PRIVACY: Omit filename_webp and filename_avif from public search results
    // to minimize internal filename exposure. filename_jpeg is needed for thumbnails.
    const searchFields = {
        id: images.id, title: images.title, description: images.description,
        filename_jpeg: images.filename_jpeg, width: images.width, height: images.height,
        topic: images.topic, topic_label: topics.label, camera_model: images.camera_model,
        capture_date: images.capture_date,
    };

    // Run main query first; only query tags if we need more results (saves a connection)
    const results = await db.select(searchFields).from(images)
        .leftJoin(topics, eq(images.topic, topics.slug))
        .where(and(
            eq(images.processed, true),
            or(
                like(images.title, searchTerm),
                like(images.description, searchTerm),
                like(images.camera_model, searchTerm),
                like(images.topic, searchTerm),
                like(topics.label, searchTerm),
            )
        ))
        .orderBy(desc(images.created_at), desc(images.id))
        .limit(effectiveLimit);

    // Short-circuit: if the main query already filled the limit, skip
    // the expensive tag and alias queries. This avoids 2 unnecessary DB
    // round-trips on popular search terms that match in title/description/etc.
    if (results.length >= effectiveLimit) {
        return results;
    }

    // Only search tags if main results are insufficient; limit to remaining slots.
    // Exclude IDs already found by the main query so tag-result slots aren't
    // wasted on duplicates (especially with small effectiveLimit values).
    const remainingLimit = effectiveLimit - results.length;
    const mainIds = results.map(r => r.id);
    const tagConditions = [eq(images.processed, true), like(tags.name, searchTerm)];
    if (mainIds.length > 0) {
        tagConditions.push(notInArray(images.id, mainIds));
    }
    const tagResults = remainingLimit <= 0 ? [] : await db.select(searchFields)
        .from(images)
        .leftJoin(topics, eq(images.topic, topics.slug))
        .innerJoin(imageTags, eq(images.id, imageTags.imageId))
        .innerJoin(tags, eq(imageTags.tagId, tags.id))
        .where(and(...tagConditions))
        .groupBy(
            images.id,
            images.title,
            images.description,
            images.filename_jpeg,
            images.width,
            images.height,
            images.topic,
            topics.label,
            images.camera_model,
            images.capture_date,
        )
        .orderBy(desc(images.created_at), desc(images.id))
        .limit(remainingLimit);

    const seenIds = new Set([...mainIds, ...tagResults.map((result) => result.id)]);
    const aliasConditions = [eq(images.processed, true), like(topicAliases.alias, searchTerm)];
    if (seenIds.size > 0) {
        aliasConditions.push(notInArray(images.id, [...seenIds]));
    }
    const aliasRemainingLimit = effectiveLimit - seenIds.size;
    const aliasResults = aliasRemainingLimit <= 0 ? [] : await db.select(searchFields)
        .from(images)
        .leftJoin(topics, eq(images.topic, topics.slug))
        .innerJoin(topicAliases, eq(images.topic, topicAliases.topicSlug))
        .where(and(...aliasConditions))
        .groupBy(
            images.id,
            images.title,
            images.description,
            images.filename_jpeg,
            images.width,
            images.height,
            images.topic,
            topics.label,
            images.camera_model,
            images.capture_date,
        )
        .orderBy(desc(images.created_at), desc(images.id))
        .limit(aliasRemainingLimit);

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

export const getImageCached = cache(getImage);
export const getTopicBySlugCached = cache(getTopicBySlug);
export const getTopicsCached = cache(getTopics);
export const getTopicsWithAliasesCached = cache(getTopicsWithAliases);
export const getImageByShareKeyCached = cache(getImageByShareKey);
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
