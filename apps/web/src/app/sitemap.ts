import { getImageIdsForSitemap, getTopics } from '@/lib/data';
import { MetadataRoute } from 'next';

// Dynamic because the database is not available at build time. Do not emit
// request-time `lastModified` values for unchanged pages; crawler freshness
// should reflect persisted content timestamps only.
export const dynamic = 'force-dynamic';
export const revalidate = 3600;

import siteConfig from "@/site-config.json";
import { LOCALES } from '@/lib/constants';
import { localizeUrl } from '@/lib/locale-path';

const BASE_URL = process.env.BASE_URL || siteConfig.url;

// Google recommends max 50,000 URLs per sitemap file. Reserve the budget for
// localized homepage/topic URLs first, then spend the remaining slots on images.
const MAX_SITEMAP_URLS = 50000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const topics = await getTopics();
  const reservedLocalizedUrls = LOCALES.length * (1 + topics.length);
  const imageBudget = Math.max(
    0,
    Math.floor((MAX_SITEMAP_URLS - reservedLocalizedUrls) / LOCALES.length),
  );
  const images = imageBudget > 0 ? await getImageIdsForSitemap(imageBudget) : [];

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
