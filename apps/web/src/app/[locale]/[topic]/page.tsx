import { getImages, getTags, getTopicBySlug, getImageCount } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { notFound, redirect } from 'next/navigation';
import { Metadata } from 'next';
import siteConfig from "@/site-config.json";

export const revalidate = 3600;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ topic: string }>, searchParams: Promise<{ tags?: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const { tags: tagsParam } = await searchParams;
  const tagSlugs = tagsParam ? tagsParam.split(',').filter(Boolean) : [];

  const topicData = await getTopicBySlug(topic);

  if (!topicData) return {};



  const title = tagSlugs.length > 0
    ? `${tagSlugs.map(t => '#' + t).join(' ')} | ${topicData.label}`
    : topicData.label;

  const description = tagSlugs.length > 0
    ? `Browse ${tagSlugs.join(', ')} photos in ${topicData.label} category`
    : `Photos in ${topicData.label} category`;

  return {
    title: title,
    description: description,
    openGraph: {
      title: `${title} | ${siteConfig.title}`,
      description: description,
      images: [
        {
          url: `/api/og?topic=${topicData.slug}&tags=${tagSlugs.join(',')}`,
          width: 1200,
          height: 630,
          alt: title,
        }
      ],
    },
  };
}

export default async function TopicPage({
  params,
  searchParams
}: {
  params: Promise<{ topic: string }>,
  searchParams: Promise<{ tags?: string }>
}) {
  const { topic } = await params;
  const { tags: tagsParam } = await searchParams;



  const topicData = await getTopicBySlug(topic);
  if (!topicData) {
    notFound();
  }

  // If the requested topic slug doesn't match the canonical slug, redirect standardly
  if (topicData.slug !== topic) {
      redirect(`/${topicData.slug}`);
  }

  const allTags = await getTags(topic);

  // Parse and validate tag slugs
  const rawTagSlugs = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const tagSlugs = rawTagSlugs.filter(slug => allTags.some(t => t.slug === slug));

  const PAGE_SIZE = 30;
  const filterTags = tagSlugs.length > 0 ? tagSlugs : undefined;
  const [images, totalCount] = await Promise.all([
    getImages(topic, filterTags, PAGE_SIZE, 0),
    getImageCount(topic, filterTags),
  ]);
  const hasMore = totalCount > PAGE_SIZE;
  const tags = allTags.filter(t => t.count > 1);

  return <HomeClient images={images} tags={tags} currentTags={tagSlugs} topicSlug={topic} hasMore={hasMore} />;
}
