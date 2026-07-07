import { getImageIdsForSitemap, getLatestImageUpdatedAt, getTopicsWithLatestUpdate } from '@/lib/data';
import { MetadataRoute } from 'next';

// AGG8F-02 / plan-234: drop `force-dynamic` so the existing `revalidate = 3600`
// actually takes effect. The previous combination silently disabled the
// revalidate value (force-dynamic overrides it), leaving every crawler hit to
// rerun the full sitemap query against the live DB. ISR with hourly
// revalidation keeps freshness within the bound expected by Googlebot for
// content this stable and protects the DB from sustained crawler bursts.
// Image lastModified comes from persisted row timestamps, not request time, so
// cached responses do not lie about freshness.
export const revalidate = 3600;

import siteConfig from "@/site-config.json";
import { LOCALES } from '@/lib/constants';
import { localizePath, localizeUrl } from '@/lib/locale-path';

const BASE_URL = process.env.BASE_URL || siteConfig.url;

// Google recommends max 50,000 URLs per sitemap file. Reserve the budget for
// every non-image row (localized homepage/topic pages, the global feed entry,
// and localized per-topic feed entries) first, then spend the remaining slots
// on images. A final `.slice(0, MAX_SITEMAP_URLS)` clamp guards the total.
const MAX_SITEMAP_URLS = 50000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // AGG8F-02 / plan-234 follow-up: when this route is prerendered at build
  // time the DB is intentionally not reachable (Docker build stage has no DB
  // network). Tolerate that failure and emit a minimal homepage-only sitemap;
  // ISR will replace it with the real one on the first runtime hit. We do
  // not swallow runtime errors silently — at runtime a DB outage already
  // surfaces via /api/health and observability, so the same fallback there
  // is preferable to a 5xx on /sitemap.xml that would teach crawlers to back off.
  let topics: Awaited<ReturnType<typeof getTopicsWithLatestUpdate>> = [];
  let images: Awaited<ReturnType<typeof getImageIdsForSitemap>> = [];
  // R18-M1: site-wide `MAX(images.updated_at)` for the homepage entries'
  // `<lastmod>`. Googlebot uses lastmod as a published crawl-prioritization
  // signal ("We use lastmod to detect fresh content"). Cached via the route's
  // `revalidate = 3600` ISR window.
  let homepageLastModified: Date | null = null;
  try {
    [topics, homepageLastModified] = await Promise.all([
      getTopicsWithLatestUpdate(),
      getLatestImageUpdatedAt(),
    ]);
    // WP18 (C2-29/CRIT-02, run-10 cycle-2): reserve budget for EVERY non-image
    // row appended below, not just homepage + topic pages. homepageEntries +
    // topicEntries reserve `LOCALES.length * (1 + topics.length)`; feedEntry is
    // a single global (non-localized) URL (+1); topicFeedEntries reserves one
    // localized row per topic (`LOCALES.length * topics.length`). Previously
    // only the first term was reserved, so feedEntry and topicFeedEntries
    // could push the total past MAX_SITEMAP_URLS uncounted. Static public
    // experience pages add one localized row per locale.
    const reservedNonImageUrls =
      LOCALES.length * (2 + topics.length) + 1 + LOCALES.length * topics.length;
    const imageBudget = Math.max(
      0,
      Math.floor((MAX_SITEMAP_URLS - reservedNonImageUrls) / LOCALES.length),
    );
    images = imageBudget > 0 ? await getImageIdsForSitemap(imageBudget) : [];
  } catch (err) {
    console.warn('[sitemap] falling back to homepage-only sitemap:', err);
    topics = [];
    images = [];
    homepageLastModified = null;
  }

  const homepageEntries: MetadataRoute.Sitemap = LOCALES.map((locale) => ({
    url: localizeUrl(BASE_URL, locale, '/'),
    lastModified: homepageLastModified ? new Date(homepageLastModified) : undefined,
    changeFrequency: 'daily',
    priority: 1,
  }));

  const topicEntries: MetadataRoute.Sitemap = topics.flatMap((topic) =>
    LOCALES.map((locale) => ({
      url: localizeUrl(BASE_URL, locale, `/${topic.slug}`),
      lastModified: topic.last_image_updated_at
        ? new Date(topic.last_image_updated_at)
        : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))
  );

  // DB query already caps at MAX_SITEMAP_IMAGES — no slice needed
  const imageEntries: MetadataRoute.Sitemap = images.flatMap((image) =>
    LOCALES.map((locale) => ({
      url: localizeUrl(BASE_URL, locale, `/p/${image.id}`),
      lastModified: (image.updated_at ?? image.created_at)
        ? new Date(image.updated_at ?? image.created_at)
        : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }))
  );

  const staticPublicEntries: MetadataRoute.Sitemap = LOCALES.map((locale) => ({
    url: localizeUrl(BASE_URL, locale, '/timeline'),
    lastModified: homepageLastModified ? new Date(homepageLastModified) : undefined,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  // R18-L6: list the feed itself so sitemap-first aggregators (Inoreader,
  // Feedly) can auto-discover the syndication channel even when their
  // HTML-link discovery misses the homepage's <link rel="alternate"> hint.
  const feedEntry: MetadataRoute.Sitemap = [{
    url: `${BASE_URL}/feed.xml`,
    lastModified: homepageLastModified ? new Date(homepageLastModified) : undefined,
    changeFrequency: 'daily',
    priority: 0.5,
  }];

  // R19-L3: per-topic feed entries. Each topic ships a per-locale feed at
  // `/{locale}/{topic}/feed.xml`; without these sitemap rows
  // sitemap-first aggregators (Inoreader, Feedly auto-discovery) cannot
  // see them. Reuses `topic.last_image_updated_at` from
  // getTopicsWithLatestUpdate() (already projected by R18-M1; moved out of
  // getTopics() by WP11/C2-13) so freshness signals match the topic page's
  // `<lastmod>`.
  const topicFeedEntries: MetadataRoute.Sitemap = topics.flatMap((topic) =>
    LOCALES.map((locale) => ({
      url: `${BASE_URL}${localizePath(locale, `/${topic.slug}/feed.xml`)}`,
      lastModified: topic.last_image_updated_at
        ? new Date(topic.last_image_updated_at)
        : undefined,
      changeFrequency: 'daily' as const,
      priority: 0.4,
    }))
  );

  // WP18 (C2-29/CRIT-02, run-10 cycle-2): defensive clamp — the reservation
  // arithmetic above should already keep the total within budget, but this
  // guarantees the contract even if a future entry type is added upstream of
  // it without updating the reservation.
  return [
    ...homepageEntries,
    ...staticPublicEntries,
    ...topicEntries,
    ...imageEntries,
    ...feedEntry,
    ...topicFeedEntries,
  ].slice(0, MAX_SITEMAP_URLS);
}
