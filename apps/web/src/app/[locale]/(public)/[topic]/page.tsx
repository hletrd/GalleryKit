import { getImagesLitePage, getTagsCached, getTopicBySlugCached, getTopicsCached, getSeoSettings } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { notFound, redirect } from 'next/navigation';
import { Metadata } from 'next';

import { getLocale, getTranslations } from 'next-intl/server';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl } from '@/lib/locale-path';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { absoluteImageUrl } from '@/lib/image-url';
import { filterExistingTagSlugs, parseRequestedTagSlugs } from '@/lib/tag-slugs';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { getCspNonce } from '@/lib/csp-nonce';


export const revalidate = 0;

const RESERVED_TOPIC_SEGMENTS = new Set([
  'apple-icon',
  'favicon.ico',
  'icon',
  'manifest',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
]);

function isReservedTopicSegment(segment: string) {
  return RESERVED_TOPIC_SEGMENTS.has(segment.toLowerCase());
}

export async function generateMetadata({ params, searchParams }: { params: Promise<{ topic: string }>, searchParams: Promise<{ tags?: string }> }): Promise<Metadata> {
  const { topic } = await params;
  if (isReservedTopicSegment(topic)) {
    return {
      title: '',
      robots: { index: false, follow: false },
    };
  }
  const { tags: tagsParam } = await searchParams;
  const requestedTagSlugs = parseRequestedTagSlugs(tagsParam);
  const topicDataPromise = getTopicBySlugCached(topic);
  const topicTagsPromise = requestedTagSlugs.length > 0
    ? topicDataPromise.then((resolvedTopic) => (
        resolvedTopic ? getTagsCached(resolvedTopic.slug) : []
      ))
    : Promise.resolve([]);

  const [locale, t, seo, topicData, allTags] = await Promise.all([
    getLocale(),
    getTranslations('topic'),
    getSeoSettings(),
    topicDataPromise,
    topicTagsPromise,
  ]);

  if (!topicData) return {
    title: t('notFoundTitle'),
    description: t('notFoundDescription'),
  };

  const tagSlugs = requestedTagSlugs.length > 0
    ? filterExistingTagSlugs(requestedTagSlugs, allTags)
    : [];

  const title = tagSlugs.length > 0
    ? `${tagSlugs.map(t => '#' + t).join(' ')} | ${topicData.label}`
    : topicData.label;

  const description = tagSlugs.length > 0
    ? t('browsePhotosWithTag', { tags: tagSlugs.join(', '), topic: topicData.label })
    : t('photosInTopic', { topic: topicData.label });

  const pageUrl = localizeUrl(seo.url, locale, `/${topicData.slug}`);
  const openGraphLocale = getOpenGraphLocale(locale, seo.locale);

  // Use custom OG image if configured, otherwise use generated OG image
  const topicOgParams = new URLSearchParams({ topic: topicData.slug });
  if (tagSlugs.length > 0) {
    topicOgParams.set('tags', tagSlugs.join(','));
  }
  const ogImages = seo.og_image_url
    ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: title }]
    : [{
        url: `${seo.url}/api/og?${topicOgParams.toString()}`,
        width: 1200,
        height: 630,
        alt: title,
      }];

  // F-17 / AGG1L-LOW-04 / plan-301-C: emit hreflang alternates for the
  // topic page in every supported locale (and `x-default`) so search
  // engines can associate `/en/<topic>` with `/ko/<topic>` and avoid
  // duplicate-content penalties. The map is generated from the LOCALES
  // constant so adding a new locale automatically extends it.
  const alternateLanguages = buildHreflangAlternates(seo.url, `/${topicData.slug}`);

  return {
    title: title,
    description: description,
    alternates: {
      canonical: pageUrl,
      languages: alternateLanguages,
    },
    robots: tagSlugs.length > 0 ? { index: false, follow: true } : undefined,
    openGraph: {
      title: `${title} | ${seo.title}`,
      description: description,
      url: pageUrl,
      siteName: seo.title,
      images: ogImages,
      locale: openGraphLocale,
      alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} | ${seo.title}`,
      description: description,
      images: ogImages.map((image) => image.url),
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
  if (isReservedTopicSegment(topic)) {
    return notFound();
  }
  const { tags: tagsParam } = await searchParams;
  const [locale, topicData] = await Promise.all([
    getLocale(),
    getTopicBySlugCached(topic),
  ]);
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

  const [seo, config, allTags, allTopics] = await Promise.all([
    getSeoSettings(),
    getGalleryConfig(),
    getTagsCached(topicData.slug),
    getTopicsCached(),
  ]);
  const tagSlugs = filterExistingTagSlugs(parseRequestedTagSlugs(tagsParam), allTags);

  const PAGE_SIZE = 30;
  const filterTags = tagSlugs.length > 0 ? tagSlugs : undefined;
  const { images, totalCount, hasMore } = await getImagesLitePage(topicData.slug, filterTags, PAGE_SIZE, 0);
  const tags = allTags.filter(t => t.count > 1);

  const baseUrl = seo.url;
  const nonce = await getCspNonce();
  // AGG8F-19 / plan-238: skip JSON-LD on `noindex` page variants. Filtered
  // tag-slug views set `robots: { index: false, follow: true }` (see
  // `generateMetadata`), so search engines do not index them; emitting
  // JSON-LD here is dead weight. The unfiltered topic view still emits
  // the gallery structured data.
  const shouldEmitJsonLd = tagSlugs.length === 0;
  const galleryLd = images.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: `${topicData.label} | ${seo.title}`,
    url: localizeUrl(baseUrl, locale, `/${topicData.slug}`),
    image: images.slice(0, 10).map((img) => ({
      '@type': 'ImageObject',
      contentUrl: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, baseUrl),
      thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(config.imageSizes, 640)}.jpg`)}`, baseUrl),
      name: getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`),
    })),
  } : null;

  return (
    <>
      {shouldEmitJsonLd && galleryLd && (
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(galleryLd)
          }}
        />
      )}
      <HomeClient images={images} tags={tags} topics={allTopics} currentTags={tagSlugs} topicSlug={topicData.slug} heading={topicData.label} hasMore={hasMore} totalCount={totalCount} imageSizes={config.imageSizes} />
    </>
  );
}
