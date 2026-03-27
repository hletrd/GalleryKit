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
    color_space: images.color_space,
    white_balance: images.white_balance,
    metering_mode: images.metering_mode,
    exposure_compensation: images.exposure_compensation,
    exposure_program: images.exposure_program,
    flash: images.flash,
    bit_depth: images.bit_depth,
    original_format: images.original_format,
    original_file_size: images.original_file_size,
    blur_data_url: images.blur_data_url,
};

const adminSelectFields = {
    ...selectFields,
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

export async function getImageCount(topic?: string, tagSlugs?: string[]): Promise<number> {
    const conditions = [];

    if (topic !== undefined) {
        if (!/^[a-z0-9_-]+$/i.test(topic) || topic.length > 100) return 0;
        conditions.push(eq(images.topic, topic));
    }

    conditions.push(eq(images.processed, true));

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

export async function getImages(topic?: string, tagSlugs?: string[], limit: number = 0, offset: number = 0, includeUnprocessed: boolean = false) {
    const conditions = [];

    if (topic !== undefined) {
        if (!/^[a-z0-9_-]+$/i.test(topic) || topic.length > 100) return [];
        conditions.push(eq(images.topic, topic));
    }

    // Only show processed images (processed is true).
    if (!includeUnprocessed) {
        conditions.push(eq(images.processed, true));
    }

    // Validate and filter tag slugs
    const validTagSlugs = (tagSlugs || [])
        .map(s => s.trim())
        .filter(s => s.length > 0 && /^[a-z0-9-]+$/i.test(s) && s.length <= 100);

    const hasTagFilter = validTagSlugs.length > 0;

    if (hasTagFilter) {
        // For multiple tags, we need to find images that have ALL the specified tags
        // Using a subquery approach: get image IDs that have all required tags
        const tagConditions = validTagSlugs.map(slug => eq(tags.slug, slug));

        // Create a subquery to find images with all the required tags
        const imageIdsWithAllTags = db
            .select({ imageId: imageTags.imageId })
            .from(imageTags)
            .innerJoin(tags, eq(imageTags.tagId, tags.id))
            .where(or(...tagConditions))
            .groupBy(imageTags.imageId)
            .having(sql`COUNT(DISTINCT ${tags.slug}) = ${validTagSlugs.length}`);

        conditions.push(inArray(images.id, imageIdsWithAllTags));
    }

    const baseQuery = db.select({
        ...selectFields,
        tag_names: sql<string | null>`GROUP_CONCAT(DISTINCT ${tags.name} ORDER BY ${tags.name})`
    })
        .from(images)
        .leftJoin(imageTags, eq(images.id, imageTags.imageId))
        .leftJoin(tags, eq(imageTags.tagId, tags.id))
        .groupBy(images.id)
        .orderBy(desc(images.capture_date), desc(images.created_at));

    const query = conditions.length > 0
        ? baseQuery.where(and(...conditions))
        : baseQuery;

    // Enforce a hard max to prevent unbounded result sets that can OOM the server.
    const effectiveLimit = limit > 0 ? Math.min(limit, 500) : 500;
    return query.limit(effectiveLimit).offset(offset);
}

export async function getImage(id: number) {
    // Validate ID is a positive integer
    if (!Number.isInteger(id) || id <= 0) {
        return null;
    }

    // Only return processed images (processed is true OR null/undefined for legacy)
    const [image] = await db.select({
        ...selectFields,
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

    // Return null if image not found (instead of spreading undefined)
    if (!image) {
        return null;
    }

    // Fetch tags, prev, and next image in parallel (all independent of each other)
    const [imageTagsResult, prevResult, nextResult] = await Promise.all([
        // Fetch tags
        db.select({
            name: tags.name,
            slug: tags.slug
        })
            .from(imageTags)
            .innerJoin(tags, eq(imageTags.tagId, tags.id))
            .where(eq(imageTags.imageId, id)),

        // Prev: Newer image by (capture_date, created_at, id) — matches gallery grid sort order
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
            .orderBy(asc(images.capture_date), asc(images.created_at), asc(images.id))
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
    // Validate key format (Base56; supports legacy 5-char and newer longer keys)
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, [5, 10])) {
        return null;
    }

    const result = await db.select(selectFields)
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

    // Fetch tags for this image
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

export async function getSharedGroup(key: string) {
    // Validate key format (Base56; supports legacy 6-char and newer longer keys)
    const trimmedKey = (key || '').trim();
    if (!isBase56(trimmedKey, [6, 10])) {
        return null;
    }

    const [group] = await db.select().from(sharedGroups).where(eq(sharedGroups.key, trimmedKey)).limit(1);
    if (!group) return null;

    const groupImages = await db.select(selectFields)
    .from(sharedGroupImages)
    .innerJoin(images, eq(sharedGroupImages.imageId, images.id))
    .where(
        and(
            eq(sharedGroupImages.groupId, group.id),
            eq(images.processed, true)
        )
    )
    .limit(100);

    return {
        ...group,
        images: groupImages
    };
}

export async function getTopicBySlug(slug: string) {
    if (!/^[a-z0-9_-]+$/i.test(slug)) return null;

    // Single query: direct match OR alias resolution via LEFT JOIN
    const [result] = await db
        .select({
            slug: topics.slug,
            label: topics.label,
            order: topics.order,
            image_filename: topics.image_filename,
        })
        .from(topics)
        .leftJoin(topicAliases, eq(topics.slug, topicAliases.topicSlug))
        .where(or(eq(topics.slug, slug), eq(topicAliases.alias, slug)))
        .limit(1);

    return result || null;
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

    const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
    const searchTerm = `%${escaped}%`;

    const [results, tagResults] = await Promise.all([
        db
            .select({
                id: images.id,
                title: images.title,
                description: images.description,
                filename_jpeg: images.filename_jpeg,
                filename_webp: images.filename_webp,
                filename_avif: images.filename_avif,
                width: images.width,
                height: images.height,
                topic: images.topic,
                camera_model: images.camera_model,
                capture_date: images.capture_date,
                blur_data_url: images.blur_data_url,
            })
            .from(images)
            .where(
                and(
                    eq(images.processed, true),
                    or(
                        like(images.title, searchTerm),
                        like(images.description, searchTerm),
                        like(images.camera_model, searchTerm),
                        like(images.topic, searchTerm),
                    )
                )
            )
            .orderBy(desc(images.created_at))
            .limit(limit),

        // Also search by tag name
        db
            .select({
                id: images.id,
                title: images.title,
                description: images.description,
                filename_jpeg: images.filename_jpeg,
                filename_webp: images.filename_webp,
                filename_avif: images.filename_avif,
                width: images.width,
                height: images.height,
                topic: images.topic,
                camera_model: images.camera_model,
                capture_date: images.capture_date,
                blur_data_url: images.blur_data_url,
            })
            .from(images)
            .innerJoin(imageTags, eq(images.id, imageTags.imageId))
            .innerJoin(tags, eq(imageTags.tagId, tags.id))
            .where(
                and(
                    eq(images.processed, true),
                    like(tags.name, searchTerm),
                )
            )
            .orderBy(desc(images.created_at))
            .limit(limit),
    ]);

    // Deduplicate by id
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

/** Lightweight query for sitemap: only id + created_at, no JOINs, no TEXT columns, no limit */
export async function getImageIdsForSitemap() {
    return db.select({
        id: images.id,
        created_at: images.created_at,
    })
    .from(images)
    .where(eq(images.processed, true))
    .orderBy(desc(images.created_at));
}

export { adminSelectFields };

export const getImageCached = cache(getImage);
export const getTopicBySlugCached = cache(getTopicBySlug);
export const getTopicsWithAliasesCached = cache(getTopicsWithAliases);
