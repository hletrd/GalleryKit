import { getImageIdsForSitemap, getTopics } from '@/lib/data';
import { MetadataRoute } from 'next';

// AGG8F-02 / plan-234: drop `force-dynamic` so the existing `revalidate = 3600`
// actually takes effect. The previous combination silently disabled the
// revalidate value (force-dynamic overrides it), leaving every crawler hit to
// rerun the full sitemap query against the live DB. ISR with hourly
// revalidation keeps freshness within the bound expected by Googlebot for
// content this stable and protects the DB from sustained crawler bursts.
// Image lastModified continues to come from persisted `created_at` timestamps,
// not request time, so cached responses do not lie about freshness.
export const revalidate = 3600;

import siteConfig from "@/site-config.json";
import { LOCALES } from '@/lib/constants';
import { localizeUrl } from '@/lib/locale-path';

const BASE_URL = process.env.BASE_URL || siteConfig.url;

// Google recommends max 50,000 URLs per sitemap file. Reserve the budget for
// localized homepage/topic URLs first, then spend the remaining slots on images.
const MAX_SITEMAP_URLS = 50000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // AGG8F-02 / plan-234 follow-up: when this route is prerendered at build
  // time the DB is intentionally not reachable (Docker build stage has no DB
  // network). Tolerate that failure and emit a minimal homepage-only sitemap;
  // ISR will replace it with the real one on the first runtime hit. We do
  // not swallow runtime errors silently — at runtime a DB outage already
  // surfaces via /api/health and observability, so the same fallback there
  // is preferable to a 5xx on /sitemap.xml that would teach crawlers to back off.
  let topics: Awaited<ReturnType<typeof getTopics>> = [];
  let images: Awaited<ReturnType<typeof getImageIdsForSitemap>> = [];
  try {
    topics = await getTopics();
    const reservedLocalizedUrls = LOCALES.length * (1 + topics.length);
    const imageBudget = Math.max(
      0,
      Math.floor((MAX_SITEMAP_URLS - reservedLocalizedUrls) / LOCALES.length),
    );
    images = imageBudget > 0 ? await getImageIdsForSitemap(imageBudget) : [];
  } catch (err) {
    console.warn('[sitemap] falling back to homepage-only sitemap:', err);
    topics = [];
    images = [];
  }

  const homepageEntries: MetadataRoute.Sitemap = LOCALES.map((locale) => ({
    url: localizeUrl(BASE_URL, locale, '/'),
    changeFrequency: 'daily',
    priority: 1,
  }));

  const topicEntries: MetadataRoute.Sitemap = topics.flatMap((topic) =>
    LOCALES.map((locale) => ({
      url: localizeUrl(BASE_URL, locale, `/${topic.slug}`),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))
  );

  // DB query already caps at MAX_SITEMAP_IMAGES — no slice needed
  const imageEntries: MetadataRoute.Sitemap = images.flatMap((image) =>
    LOCALES.map((locale) => ({
      url: localizeUrl(BASE_URL, locale, `/p/${image.id}`),
      lastModified: image.created_at ? new Date(image.created_at) : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }))
  );

  return [
    ...homepageEntries,
    ...topicEntries,
    ...imageEntries,
  ];
}
