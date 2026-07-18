import { getImageIdsForSitemap, getLatestImageUpdatedAt, getTopicsWithLatestUpdate } from '@/lib/data';
import { MetadataRoute } from 'next';
import { unstable_cache } from 'next/cache';

// C2-01: the production image build intentionally has no DB access. Keep the
// route itself dynamic so that build cannot seal its fallback response into a
// fresh ISR artifact. The successful DB payload is cached separately below for
// one hour; failed loads throw before unstable_cache can persist a value.
export const dynamic = 'force-dynamic';

import siteConfig from "@/site-config.json";
import { LOCALES } from '@/lib/constants';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import { getGalleryConfig } from '@/lib/gallery-config';

const BASE_URL = process.env.BASE_URL || siteConfig.url;

// Google recommends max 50,000 URLs per sitemap file. Reserve the budget for
// every non-image row (localized homepage/topic pages, the global feed entry,
// and localized per-topic feed entries) first, then spend the remaining slots
// on images. A final `.slice(0, MAX_SITEMAP_URLS)` clamp guards the total.
const MAX_SITEMAP_URLS = 50000;
const ALWAYS_STATIC_PUBLIC_PATHS = ['/privacy', '/about-gallerykit'] as const;

function getStaticPublicPaths(config: { showTimelineNav: boolean; showMapNav: boolean }) {
  return [
    ...(config.showTimelineNav ? ['/timeline'] as const : []),
    ...(config.showMapNav ? ['/map'] as const : []),
    ...ALWAYS_STATIC_PUBLIC_PATHS,
  ] as const;
}

const getCachedSitemapData = unstable_cache(async () => {
  const [topics, homepageLastModified, galleryConfig] = await Promise.all([
    getTopicsWithLatestUpdate(),
    getLatestImageUpdatedAt(),
    getGalleryConfig(),
  ]);
  const staticPublicPaths = getStaticPublicPaths(galleryConfig);
  const reservedNonImageUrls =
    LOCALES.length * (1 + staticPublicPaths.length + topics.length) + 1 + LOCALES.length * topics.length;
  const imageBudget = Math.max(
    0,
    Math.floor((MAX_SITEMAP_URLS - reservedNonImageUrls) / LOCALES.length),
  );
  const images = imageBudget > 0 ? await getImageIdsForSitemap(imageBudget) : [];

  return { topics, homepageLastModified, staticPublicPaths, images };
}, ['public-sitemap-data-v1'], { revalidate: 3600 });

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Runtime DB outages still return a bounded discovery fallback rather than a
  // 5xx. Because getCachedSitemapData caches only successful resolutions, this
  // fallback never becomes the one-hour cached truth.
  let topics: Awaited<ReturnType<typeof getTopicsWithLatestUpdate>> = [];
  let images: Awaited<ReturnType<typeof getImageIdsForSitemap>> = [];
  let staticPublicPaths = getStaticPublicPaths({ showTimelineNav: true, showMapNav: true });
  // R18-M1: site-wide `MAX(images.updated_at)` for the homepage entries'
  // `<lastmod>`. Googlebot uses lastmod as a published crawl-prioritization
  // signal ("We use lastmod to detect fresh content"). Cached with the
  // successful sitemap data payload for 3,600 seconds.
  let homepageLastModified: Date | null = null;
  try {
    const resolved = await getCachedSitemapData();
    topics = resolved.topics;
    homepageLastModified = resolved.homepageLastModified;
    staticPublicPaths = resolved.staticPublicPaths;
    images = resolved.images;
  } catch (err) {
    console.warn('[sitemap] data unavailable; returning static discovery fallback:', err);
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

  const staticPublicEntries: MetadataRoute.Sitemap = staticPublicPaths.flatMap((path) =>
    LOCALES.map((locale) => ({
      url: localizeUrl(BASE_URL, locale, path),
      lastModified: homepageLastModified ? new Date(homepageLastModified) : undefined,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    }))
  );

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
