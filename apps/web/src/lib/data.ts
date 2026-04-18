import { cache } from 'react';
import { db, images, topics, topicAliases, tags, imageTags, sharedGroups, sharedGroupImages } from '@/db';
import { eq, desc, asc, and, gt, lt, or, inArray, like } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { isBase56 } from './base56';

const selectFields = {
    id: images.id,
    // filename_original is intentionally omitted for privacy
    filename_avif: images.filename_avif,
    filename_webp: images.filename_webp,
    filename_jpeg: images.filename_jpeg,
    width: images.width,
    height: images.height,
    original_width: images.original_width,
    original_height: images.original_height,
    title: images.title,
    description: images.description,
    // user_filename intentionally excluded from public queries — may contain PII
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
    color_space: images.color_space,
    white_balance: images.white_balance,
    metering_mode: images.metering_mode,
    exposure_compensation: images.exposure_compensation,
    exposure_program: images.exposure_program,
    flash: images.flash,
    bit_depth: images.bit_depth,
    original_format: images.original_format,
    original_file_size: images.original_file_size,
    // blur_data_url excluded from selectFields — fetched only in individual image
    // queries to avoid bloating InnoDB buffer pool and SSR payload on listing pages.
};

// Admin-only fields — extend selectFields with PII columns.
const adminExtraFields = {
    user_filename: images.user_filename,
    latitude: images.latitude,
    longitude: images.longitude,
};

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
        if (!/^[a-z0-9_-]+$/i.test(topic) || topic.length > 100) return 0;
        conditions.push(eq(images.topic, topic));
    }

    if (!options?.includeUnprocessed) {
        conditions.push(eq(images.processed, true));
    }

    const validTagSlugs = (tagSlugs || [])
        .map(s => s.trim())
        .filter(s => s.length > 0 && /^[a-z0-9-]+$/i.test(s) && s.length <= 100);

    if (validTagSlugs.length > 0) {
        const tagConditions = validTagSlugs.map(slug => eq(tags.slug, slug));
        const imageIdsWithAllTags = db
            .select({ imageId: imageTags.imageId })
            .from(imageTags)
            .innerJoin(tags, eq(imageTags.tagId, tags.id))
            .where(or(...tagConditions))
            .groupBy(imageTags.imageId)
            .having(sql`COUNT(DISTINCT ${tags.slug}) = ${validTagSlugs.length}`);
        conditions.push(inArray(images.id, imageIdsWithAllTags));
    }

    const result = await db.select({ count: sql<number>`count(*)` })
        .from(images)
        .where(and(...conditions));

    return Number(result[0]?.count ?? 0);
}

/** Build tag-filter conditions (shared between getImages and getImagesLite). */
function buildTagFilterCondition(tagSlugs?: string[]) {
    const validTagSlugs = (tagSlugs || [])
        .map(s => s.trim())
        .filter(s => s.length > 0 && /^[a-z0-9-]+$/i.test(s) && s.length <= 100);
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
        if (!/^[a-z0-9_-]+$/i.test(topic) || topic.length > 100) return null;
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
export async function getImagesLite(topic?: string, tagSlugs?: string[], limit: number = 0, offset: number = 0, includeUnprocessed: boolean = false) {
    const conditions = buildImageConditions(topic, tagSlugs, includeUnprocessed);
    if (conditions === null) return [];

    const baseQuery = db.select({
        ...selectFields,
        tag_names: sql<string | null>`(SELECT GROUP_CONCAT(DISTINCT t.name ORDER BY t.name) FROM ${imageTags} it JOIN ${tags} t ON it.tag_id = t.id WHERE it.image_id = ${images.id})`,
    })
        .from(images)
        .orderBy(desc(images.capture_date), desc(images.created_at), desc(images.id));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    const effectiveLimit = limit > 0 ? Math.min(limit, 500) : 500;
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
        ...selectFields,
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

    const effectiveLimit = limit > 0 ? Math.min(limit, 500) : 500;
    return query.limit(effectiveLimit).offset(offset);
}

export async function getImage(id: number) {
    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    // Only return processed images (processed is true OR null/undefined for legacy)
    const [image] = await db.select({
        ...selectFields,
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

export async function getImageByShareKey(key: string) {
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, [5, 10])) {
        return null;
    }

    const result = await db.select({
        ...selectFields,
        blur_data_url: images.blur_data_url,
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

    const imageTagsResult = await db.select({
            slug: tags.slug,
            name: tags.name
        })
        .from(imageTags)
        .innerJoin(tags, eq(imageTags.tagId, tags.id))
        .where(eq(imageTags.imageId, image.id));

    return {
        ...image,
        tags: imageTagsResult,
        prevId: null,
        nextId: null
    };
}

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

    if (options?.incrementViewCount !== false) {
        db.update(sharedGroups)
            .set({ view_count: sql`${sharedGroups.view_count} + 1` })
            .where(eq(sharedGroups.id, group.id))
            .catch(err => console.debug('view_count increment failed:', err.message));
    }

    const groupImages = await db.select({
        ...selectFields,
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

    return {
        ...group,
        images: groupImages
    };
}

export async function getTopicBySlug(slug: string) {
    if (!/^[a-z0-9_-]+$/i.test(slug)) return null;

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

interface SearchResult {
    id: number;
    title: string | null;
    description: string | null;
    filename_jpeg: string;
    filename_webp: string;
    filename_avif: string;
    width: number;
    height: number;
    topic: string;
    camera_model: string | null;
    capture_date: string | null;
    blur_data_url: string | null;
}

export type { SearchResult };

export async function searchImages(query: string, limit: number = 20): Promise<SearchResult[]> {
    if (!query || query.trim().length === 0) return [];
    const effectiveLimit = Math.min(Math.max(limit, 1), 500);

    const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
    const searchTerm = `%${escaped}%`;

    const searchFields = {
        id: images.id, title: images.title, description: images.description,
        filename_jpeg: images.filename_jpeg, filename_webp: images.filename_webp,
        filename_avif: images.filename_avif, width: images.width, height: images.height,
        topic: images.topic, camera_model: images.camera_model,
        capture_date: images.capture_date, blur_data_url: images.blur_data_url,
    };

    // Run main query first; only query tags if we need more results (saves a connection)
    const results = await db.select(searchFields).from(images)
        .where(and(
            eq(images.processed, true),
            or(
                like(images.title, searchTerm),
                like(images.description, searchTerm),
                like(images.camera_model, searchTerm),
                like(images.topic, searchTerm),
            )
        ))
        .orderBy(desc(images.created_at))
        .limit(effectiveLimit);

    // Only search tags if main results are insufficient
    const tagResults = results.length >= effectiveLimit ? [] : await db.select(searchFields)
        .from(images)
        .innerJoin(imageTags, eq(images.id, imageTags.imageId))
        .innerJoin(tags, eq(imageTags.tagId, tags.id))
        .where(and(eq(images.processed, true), like(tags.name, searchTerm)))
        .orderBy(desc(images.created_at))
        .limit(effectiveLimit);

    const seen = new Set<number>();
    const combined: SearchResult[] = [];
    for (const r of [...results, ...tagResults]) {
        if (!seen.has(r.id)) {
            seen.add(r.id);
            combined.push(r);
        }
    }

    return combined.slice(0, limit);
}

/** Lightweight query for sitemap: only id + created_at, no JOINs, no TEXT columns */
export async function getImageIdsForSitemap() {
    return db.select({
        id: images.id,
        created_at: images.created_at,
    })
    .from(images)
    .where(eq(images.processed, true))
    .orderBy(desc(images.created_at))
    .limit(50000);
}

export { adminExtraFields };

export const getImageCached = cache(getImage);
export const getTopicBySlugCached = cache(getTopicBySlug);
export const getTopicsWithAliasesCached = cache(getTopicsWithAliases);
