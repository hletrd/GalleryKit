import { getImageIdsForSitemap, getTopics } from '@/lib/data';
import { MetadataRoute } from 'next';

export const dynamic = 'force-dynamic';

import siteConfig from "@/site-config.json";

const BASE_URL = process.env.BASE_URL || siteConfig.url;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [images, topics] = await Promise.all([
    getImageIdsForSitemap(),
    getTopics(),
  ]);

  const entries: MetadataRoute.Sitemap = images.map((image) => ({
    url: `${BASE_URL}/p/${image.id}`,
    lastModified: new Date(image.created_at || Date.now()),
    changeFrequency: 'weekly',
    priority: 0.7,
  }));

  const topicEntries: MetadataRoute.Sitemap = topics.map((topic) => ({
    url: `${BASE_URL}/${topic.slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [
    {
      url: `${BASE_URL}`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...topicEntries,
    ...entries,
  ];
}
