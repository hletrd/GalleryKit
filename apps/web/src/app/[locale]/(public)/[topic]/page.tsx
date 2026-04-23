import { getImagesLitePage, getTagsCached, getTopicBySlugCached, getTopicsCached, getSeoSettings } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { notFound, redirect } from 'next/navigation';
import { Metadata } from 'next';

import { getLocale, getTranslations } from 'next-intl/server';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { absoluteImageUrl } from '@/lib/image-url';
import siteConfig from '@/site-config.json';
import { filterExistingTagSlugs, parseRequestedTagSlugs } from '@/lib/tag-slugs';


export const revalidate = 3600;

export async function generateMetadata({ params, searchParams }: { params: Promise<{ topic: string }>, searchParams: Promise<{ tags?: string }> }): Promise<Metadata> {
  const { topic } = await params;
  const { tags: tagsParam } = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations('topic');
  const seo = await getSeoSettings();

  const topicData = await getTopicBySlugCached(topic);

  if (!topicData) return {
    title: t('notFoundTitle'),
    description: t('notFoundDescription'),
  };

  const requestedTagSlugs = parseRequestedTagSlugs(tagsParam);
  const tagSlugs = requestedTagSlugs.length > 0
    ? filterExistingTagSlugs(requestedTagSlugs, await getTagsCached(topicData.slug))
    : [];

  const title = tagSlugs.length > 0
    ? `${tagSlugs.map(t => '#' + t).join(' ')} | ${topicData.label}`
    : topicData.label;

  const description = tagSlugs.length > 0
    ? t('browsePhotosWithTag', { tags: tagSlugs.join(', '), topic: topicData.label })
    : t('photosInTopic', { topic: topicData.label });

  const pageUrl = localizeUrl(seo.url, locale, `/${topicData.slug}`);

  // Use custom OG image if configured, otherwise use generated OG image
  const topicOgParams = new URLSearchParams({ topic: topicData.slug });
  if (tagSlugs.length > 0) {
    topicOgParams.set('tags', tagSlugs.join(','));
  }
  topicOgParams.set('label', topicData.label);
  topicOgParams.set('site', seo.title || siteConfig.title);

  const ogImages = seo.og_image_url
    ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: title }]
    : [{
        url: `${seo.url}/api/og?${topicOgParams.toString()}`,
        width: 1200,
        height: 630,
        alt: title,
      }];

  return {
    title: title,
    description: description,
    alternates: {
      canonical: pageUrl,
    },
    openGraph: {
      title: `${title} | ${seo.title}`,
      description: description,
      url: pageUrl,
      siteName: seo.title,
      images: ogImages,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${seo.title}`,
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
    return notFound();
  }

  // If the requested topic slug doesn't match the canonical slug, redirect with locale preserved
  if (topicData.slug !== topic) {
      const destination = localizePath(locale, `/${topicData.slug}`);
      const redirectSearch = new URLSearchParams();
      if (tagsParam) {
        redirectSearch.set('tags', tagsParam);
      }
      redirect(redirectSearch.size > 0 ? `${destination}?${redirectSearch.toString()}` : destination);
  }

  const seo = await getSeoSettings();
  const allTags = await getTagsCached(topic);
  const tagSlugs = filterExistingTagSlugs(parseRequestedTagSlugs(tagsParam), allTags);

  const PAGE_SIZE = 30;
  const filterTags = tagSlugs.length > 0 ? tagSlugs : undefined;
  const [{ images, totalCount, hasMore }, allTopics] = await Promise.all([
    getImagesLitePage(topic, filterTags, PAGE_SIZE, 0),
    getTopicsCached(),
  ]);
  const tags = allTags.filter(t => t.count > 1);

  const baseUrl = seo.url;
  const config = await getGalleryConfig();
  const galleryLd = images.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: `${topicData.label} | ${seo.title}`,
    url: localizeUrl(baseUrl, locale, `/${topicData.slug}`),
    image: images.slice(0, 10).map((img) => ({
      '@type': 'ImageObject',
      contentUrl: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, baseUrl),
      thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(config.imageSizes, 640)}.jpg`)}`, baseUrl),
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
      <HomeClient images={images} tags={tags} topics={allTopics} currentTags={tagSlugs} topicSlug={topicData.slug} heading={topicData.label} hasMore={hasMore} totalCount={totalCount} imageSizes={config.imageSizes} />
    </>
  );
}
