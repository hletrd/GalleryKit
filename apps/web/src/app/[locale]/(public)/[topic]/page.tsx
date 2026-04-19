import { getImagesLite, getTags, getTopicBySlugCached, getImageCount, getTopics } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { notFound, redirect } from 'next/navigation';
import { Metadata } from 'next';
import siteConfig from "@/site-config.json";
import { getLocale, getTranslations } from 'next-intl/server';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import { BASE_URL } from '@/lib/constants';


export const revalidate = 3600;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ topic: string }>, searchParams: Promise<{ tags?: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const { tags: tagsParam } = await searchParams;
  const tagSlugs = tagsParam ? tagsParam.split(',').filter(Boolean) : [];
  const locale = await getLocale();
  const t = await getTranslations('topic');

  const topicData = await getTopicBySlugCached(topic);

  if (!topicData) return {
    title: t('notFoundTitle'),
    description: t('notFoundDescription'),
  };

  const title = tagSlugs.length > 0
    ? `${tagSlugs.map(t => '#' + t).join(' ')} | ${topicData.label}`
    : topicData.label;

  const description = tagSlugs.length > 0
    ? t('browsePhotosWithTag', { tags: tagSlugs.join(', '), topic: topicData.label })
    : t('photosInTopic', { topic: topicData.label });

  const pageUrl = localizeUrl(BASE_URL, locale, `/${topicData.slug}`);

  return {
    title: title,
    description: description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: `${title} | ${siteConfig.title}`,
      description: description,
      url: pageUrl,
      siteName: siteConfig.title,
      images: [
        {
          url: `${BASE_URL}/api/og?topic=${topicData.slug}&tags=${tagSlugs.join(',')}`,
          width: 1200,
          height: 630,
          alt: title,
        }
      ],
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${siteConfig.title}`,
      description: description,
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
  const locale = await getLocale();

  const topicData = await getTopicBySlugCached(topic);
  if (!topicData) {
    notFound();
  }

  // If the requested topic slug doesn't match the canonical slug, redirect with locale preserved
  if (topicData.slug !== topic) {
      redirect(localizePath(locale, `/${topicData.slug}`));
  }

  const allTags = await getTags(topic);

  // Parse and validate tag slugs
  const rawTagSlugs = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const tagSlugs = rawTagSlugs.filter(slug => allTags.some(t => t.slug === slug));

  const PAGE_SIZE = 30;
  const filterTags = tagSlugs.length > 0 ? tagSlugs : undefined;
  const [images, totalCount, allTopics] = await Promise.all([
    getImagesLite(topic, filterTags, PAGE_SIZE, 0),
    getImageCount(topic, filterTags),
    getTopics(),
  ]);
  const hasMore = totalCount > PAGE_SIZE;
  const tags = allTags.filter(t => t.count > 1);

  const baseUrl = BASE_URL;
  const galleryLd = images.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: `${topicData.label} | ${siteConfig.title}`,
    url: localizeUrl(baseUrl, locale, `/${topicData.slug}`),
    image: images.slice(0, 10).map((img) => ({
      '@type': 'ImageObject',
      contentUrl: `${baseUrl}/uploads/jpeg/${img.filename_jpeg}`,
      thumbnail: `${baseUrl}/uploads/jpeg/${img.filename_jpeg.replace(/\.jpg$/i, '_640.jpg')}`,
      name: img.title || `Photo ${img.id}`,
    })),
  } : null;

  return (
    <>
      {galleryLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(galleryLd)
          }}
        />
      )}
      <HomeClient images={images} tags={tags} topics={allTopics} currentTags={tagSlugs} topicSlug={topicData.slug} heading={topicData.label} hasMore={hasMore} totalCount={totalCount} />
    </>
  );
}
