/**
 * Analytics data access layer for the admin /analytics page (US-P44).
 * All queries exclude bot=true rows from counts exposed to admins.
 * Indexed columns (image_id+viewed_at, topic+viewed_at, group_id+viewed_at)
 * are used for all time-window scans.
 */

import { db, imageViews, topicViews, images, topics } from '@/db';
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
