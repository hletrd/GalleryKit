import { getImageIdsForSitemap, getTopics } from '@/lib/data';
import { MetadataRoute } from 'next';

// ISR: revalidate daily; force-dynamic required because DB isn't available at build time.
export const dynamic = 'force-dynamic';
export const revalidate = 86400;

import siteConfig from "@/site-config.json";
import { LOCALES } from '@/lib/constants';
import { localizeUrl } from '@/lib/locale-path';

const BASE_URL = process.env.BASE_URL || siteConfig.url;

// Google recommends max 50,000 URLs per sitemap file.
// With 2 locales, cap images at 24,000 to stay well under the limit
// (24,000 * 2 locales + homepage + topics = ~48,000).
const MAX_SITEMAP_IMAGES = 24000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [images, topics] = await Promise.all([
    getImageIdsForSitemap(MAX_SITEMAP_IMAGES),
    getTopics(),
  ]);

  const homepageEntries: MetadataRoute.Sitemap = LOCALES.map((locale) => ({
    url: localizeUrl(BASE_URL, locale, '/'),
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 1,
  }));

  const topicEntries: MetadataRoute.Sitemap = topics.flatMap((topic) =>
    LOCALES.map((locale) => ({
      url: localizeUrl(BASE_URL, locale, `/${topic.slug}`),
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))
  );

  // DB query already caps at MAX_SITEMAP_IMAGES — no slice needed
  const imageEntries: MetadataRoute.Sitemap = images.flatMap((image) =>
    LOCALES.map((locale) => ({
      url: localizeUrl(BASE_URL, locale, `/p/${image.id}`),
      lastModified: new Date(image.created_at || Date.now()),
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
