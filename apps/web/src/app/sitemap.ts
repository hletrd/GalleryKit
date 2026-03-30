import { getImageIdsForSitemap, getTopics } from '@/lib/data';
import { MetadataRoute } from 'next';

export const dynamic = 'force-dynamic';

import siteConfig from "@/site-config.json";

const BASE_URL = process.env.BASE_URL || siteConfig.url;
const LOCALES = ['en', 'ko'];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [images, topics] = await Promise.all([
    getImageIdsForSitemap(),
    getTopics(),
  ]);

  const homepageEntries: MetadataRoute.Sitemap = LOCALES.map((locale) => ({
    url: `${BASE_URL}/${locale}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 1,
  }));

  const topicEntries: MetadataRoute.Sitemap = topics.flatMap((topic) =>
    LOCALES.map((locale) => ({
      url: `${BASE_URL}/${locale}/${topic.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    }))
  );

  const imageEntries: MetadataRoute.Sitemap = images.flatMap((image) =>
    LOCALES.map((locale) => ({
      url: `${BASE_URL}/${locale}/p/${image.id}`,
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
