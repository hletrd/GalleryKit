/**
 * Analytics data access layer for the admin /analytics page (US-P44).
 * All queries exclude bot=true rows from counts exposed to admins.
 * Indexed columns (image_id+viewed_at, topic+viewed_at, group_id+viewed_at)
 * are used for all time-window scans.
 */

import { db, imageViews, topicViews, sharedGroupViews, images, topics, sharedGroups } from '@/db';
import { eq, and, gte, count, desc, sql } from 'drizzle-orm';

export type TimeWindow = '30d' | '90d' | 'all';

function windowStart(window: TimeWindow): Date | null {
    if (window === 'all') return null;
    const days = window === '30d' ? 30 : 90;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
}

export interface TopPhotoRow {
    imageId: number;
    title: string | null;
    topic: string;
    viewCount: number;
}

export async function getTopPhotosByViews(window: TimeWindow, limit = 20): Promise<TopPhotoRow[]> {
    const since = windowStart(window);
    const whereClause = since
        ? and(eq(imageViews.bot, false), gte(imageViews.viewed_at, since))
        : eq(imageViews.bot, false);

    const rows = await db
        .select({
            imageId: imageViews.imageId,
            title: images.title,
            topic: images.topic,
            viewCount: count(imageViews.id).as('viewCount'),
        })
        .from(imageViews)
        .innerJoin(images, eq(imageViews.imageId, images.id))
        .where(whereClause)
        .groupBy(imageViews.imageId, images.title, images.topic)
        .orderBy(desc(sql`viewCount`))
        .limit(limit);

    return rows.map((r) => ({
        imageId: r.imageId,
        title: r.title ?? null,
        topic: r.topic,
        viewCount: Number(r.viewCount),
    }));
}

export interface TopTopicRow {
    topic: string;
    label: string;
    viewCount: number;
}

export async function getTopTopicsByViews(window: TimeWindow, limit = 20): Promise<TopTopicRow[]> {
    const since = windowStart(window);
    const whereClause = since
        ? and(eq(topicViews.bot, false), gte(topicViews.viewed_at, since))
        : eq(topicViews.bot, false);

    const rows = await db
        .select({
            topic: topicViews.topic,
            label: topics.label,
            viewCount: count(topicViews.id).as('viewCount'),
        })
        .from(topicViews)
        .innerJoin(topics, eq(topicViews.topic, topics.slug))
        .where(whereClause)
        .groupBy(topicViews.topic, topics.label)
        .orderBy(desc(sql`viewCount`))
        .limit(limit);

    return rows.map((r) => ({
        topic: r.topic,
        label: r.label,
        viewCount: Number(r.viewCount),
    }));
}

export interface CountryRow {
    country_code: string;
    viewCount: number;
}

// PERF-R5C2-01 (index-utilization note): the `(bot, viewed_at, country_code)`
// and `(bot, viewed_at, referrer_host)` composite indexes serve the WINDOWED
// (default, non-'all') case as a covering RANGE SCAN — the equality on `bot`
// plus the `viewed_at >= since` range narrows directly to the time window, and
// the trailing GROUP BY column is in the index so MySQL aggregates without
// touching the base table.
//
// For the 'all' window (no `viewed_at` predicate) MySQL cannot do a loose
// index scan to skip-aggregate, because `viewed_at` sits BETWEEN the leading
// `bot` column and the GROUP BY column in the index order — so it falls back to
// a covering-index temp-table aggregation: full covering-index scan over the
// `bot = false` slice into a temp table grouped by the trailing column. This is
// bounded by view-event retention (events are pruned, so the scan size is
// capped), which is why the 'all' case is acceptable today.
//
// Re-ordering the index to put the GROUP BY column adjacent to `bot` (enabling a
// loose scan for the 'all' case) is DELIBERATELY DEFERRED pending EXPLAIN
// evidence that the temp-table aggregation is actually a hot path — see
// plan-322 entry 3. Do not reorder these indexes without that evidence.
export async function getCountryBreakdown(window: TimeWindow, limit = 30): Promise<CountryRow[]> {
    const since = windowStart(window);
    const whereClause = since
        ? and(eq(imageViews.bot, false), gte(imageViews.viewed_at, since))
        : eq(imageViews.bot, false);

    const rows = await db
        .select({
            country_code: imageViews.country_code,
            viewCount: count(imageViews.id).as('viewCount'),
        })
        .from(imageViews)
        .where(whereClause)
        .groupBy(imageViews.country_code)
        .orderBy(desc(sql`viewCount`))
        .limit(limit);

    return rows.map((r) => ({
        country_code: r.country_code,
        viewCount: Number(r.viewCount),
    }));
}

export interface ReferrerRow {
    referrer_host: string;
    viewCount: number;
}

// Cycle 4 RPF loop R27-UX-MED-4: top shared albums section. Surfaces
// per-share-key engagement so the photographer can see which client
// delivery (shared group) is getting the most views in the selected
// window. Admin-only query — `shared_group_views` is internal-only
// (groupId is the integer PK, not the public `key`). We resolve the
// integer back to the share `key` via the `sharedGroups` join so the
// admin UI can deep-link to `/g/${key}` for an as-the-client preview.
//
// CAVEAT: `shared_group_views` rows are only inserted on the INITIAL
// shared-group page load (no `?p=` query param), per the CLAUDE.md
// shared-group analytics note. Intra-share photo navigation within the
// same session does NOT increment this counter. The analytics page's
// `approximateDisclaimer` callout (R27-UX-MED-2) already discloses the
// buffered-flush undercount; the per-photo-nav undercount is a
// secondary effect of the same approximation.
export interface TopSharedGroupRow {
    /** Public share key (the URL segment, e.g. `/g/abc123`). */
    shareKey: string;
    viewCount: number;
}

export async function getTopSharedGroupsByViews(
    window: TimeWindow,
    limit = 20,
): Promise<TopSharedGroupRow[]> {
    const since = windowStart(window);
    const whereClause = since
        ? and(eq(sharedGroupViews.bot, false), gte(sharedGroupViews.viewed_at, since))
        : eq(sharedGroupViews.bot, false);

    const rows = await db
        .select({
            shareKey: sharedGroups.key,
            viewCount: count(sharedGroupViews.id).as('viewCount'),
        })
        .from(sharedGroupViews)
        .innerJoin(sharedGroups, eq(sharedGroupViews.groupId, sharedGroups.id))
        .where(whereClause)
        .groupBy(sharedGroups.key)
        .orderBy(desc(sql`viewCount`))
        .limit(limit);

    return rows.map((r) => ({
        shareKey: r.shareKey,
        viewCount: Number(r.viewCount),
    }));
}

// PERF-R5C2-01: same index-utilization characteristics as getCountryBreakdown
// above — windowed case is a covering range scan on `(bot, viewed_at, referrer_host)`;
// the 'all' window aggregates via covering-index temp table (bounded by retention).
// Index re-ordering deferred pending EXPLAIN evidence (plan-322 entry 3).
export async function getReferrerBreakdown(window: TimeWindow, limit = 20): Promise<ReferrerRow[]> {
    const since = windowStart(window);
    const whereClause = since
        ? and(eq(imageViews.bot, false), gte(imageViews.viewed_at, since))
        : eq(imageViews.bot, false);

    const rows = await db
        .select({
            referrer_host: imageViews.referrer_host,
            viewCount: count(imageViews.id).as('viewCount'),
        })
        .from(imageViews)
        .where(whereClause)
        .groupBy(imageViews.referrer_host)
        .orderBy(desc(sql`viewCount`))
        .limit(limit);

    return rows.map((r) => ({
        referrer_host: r.referrer_host,
        viewCount: Number(r.viewCount),
    }));
}
