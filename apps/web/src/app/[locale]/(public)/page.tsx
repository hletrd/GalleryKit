import { getImagesLite, getImagesLitePage, getTagsCached, getTopicsCached, getSeoSettings } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { OnThisDayWidget } from '@/components/on-this-day-widget';
import { Metadata } from 'next';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { getLocale, getTranslations } from 'next-intl/server';
import { buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale, localizeUrl } from '@/lib/locale-path';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { absoluteImageUrl } from '@/lib/image-url';
import { filterExistingTagSlugs, parseRequestedTagSlugs } from '@/lib/tag-slugs';
import { getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { getCspNonce } from '@/lib/csp-nonce';

// Public gallery pages must reflect asynchronous image processing as soon as
// the background queue marks uploads processed; avoid ISR staleness here.
export const revalidate = 0;

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ tags?: string }> }): Promise<Metadata> {
  const { tags: tagsParam } = await searchParams;
  const requestedTagSlugs = parseRequestedTagSlugs(tagsParam);
  const allTagsPromise = requestedTagSlugs.length > 0
    ? getTagsCached()
    : Promise.resolve([]);

  const [locale, t, seo, allTags] = await Promise.all([
    getLocale(),
    getTranslations('home'),
    getSeoSettings(),
    allTagsPromise,
  ]);
  const pageUrl = localizeUrl(seo.url, locale, '/');
  const openGraphLocale = getOpenGraphLocale(locale, seo.locale);
  const tagSlugs = requestedTagSlugs.length > 0
    ? filterExistingTagSlugs(requestedTagSlugs, allTags)
    : [];
  const tagLabels = tagSlugs.map((slug) => allTags.find((tag) => tag.slug === slug)?.name ?? slug);

  const title = tagSlugs.length > 0
    ? `${tagLabels.map(tag => '#' + tag).join(' ')} | ${seo.title}`
    : seo.title;

  const description = tagSlugs.length > 0
    ? t('browsePhotosWithTag', { tags: tagLabels.join(', '), site: seo.title })
    : seo.description;

  const robots = tagSlugs.length > 0 ? { index: false, follow: true } : undefined;

  // AGG1L-LOW-04 / plan-301-C: emit hreflang alternates on the home page
  // too (previously missing). The unfiltered home page is the highest-SEO
  // surface and benefits the most from cross-locale association.
  const alternateLanguages = buildHreflangAlternates(seo.url, '/');
  const atomFeedUrl = `${seo.url}/feed.xml`;

  if (seo.og_image_url) {
    const ogImages = [{ url: seo.og_image_url, width: 1200, height: 630, alt: seo.title }];
    return {
      title,
      description,
      alternates: { canonical: pageUrl, languages: alternateLanguages, types: { 'application/atom+xml': atomFeedUrl } },
      robots,
      openGraph: {
        title,
        description,
        url: pageUrl,
        siteName: seo.title,
        images: ogImages,
        locale: openGraphLocale,
        alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
        type: 'website',
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        images: ogImages.map((image) => image.url),
      },
    };
  }

  const [images, config] = await Promise.all([
    getImagesLite(undefined, tagSlugs.length > 0 ? tagSlugs : undefined, 1, 0),
    getGalleryConfig(),
  ]);
  const latestImage = images[0];
  // Use configured image sizes for OG image URL (avoids 404s if admin changes image_sizes)
  const ogImageSize = findNearestImageSize(config.imageSizes, 1536);
  const isLatestTitleFilename = latestImage?.title
    ? /\.[a-z0-9]{3,4}$/i.test(latestImage.title)
    : false;

  // Use custom OG image if configured, otherwise use latest photo
  const ogImages = latestImage
    ? [{
        url: absoluteImageUrl(`/uploads/jpeg/${latestImage.filename_jpeg.replace(/\.jpg$/i, `_${ogImageSize}.jpg`)}`, seo.url),
        width: latestImage.width,
        height: latestImage.height,
        alt: latestImage.title && !isLatestTitleFilename ? latestImage.title : t('latestPhoto'),
      }]
    : [];

  return {
    title: title,
    description: description,
    alternates: { canonical: pageUrl, languages: alternateLanguages, types: { 'application/atom+xml': atomFeedUrl } },
    robots,
    openGraph: {
      title: title,
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
      title: title,
      description: description,
      images: ogImages.map((image) => image.url),
    },
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ tags?: string }> }) {
  const { tags: tagsParam } = await searchParams;
  const [locale, seo, config, allTags, allTopics] = await Promise.all([
    getLocale(),
    getSeoSettings(),
    getGalleryConfig(),
    getTagsCached(),
    getTopicsCached(),
  ]);
  const baseUrl = seo.url;
  const nonce = await getCspNonce();

  // Parse and validate tag slugs
  const tagSlugs = filterExistingTagSlugs(parseRequestedTagSlugs(tagsParam), allTags);

  const PAGE_SIZE = 30;
  const filterTags = tagSlugs.length > 0 ? tagSlugs : undefined;
  const { images, totalCount, hasMore } = await getImagesLitePage(undefined, filterTags, PAGE_SIZE, 0);

  // AGG8F-19 / plan-238: skip JSON-LD on `noindex` page variants. Filtered
  // tag-slug views set `robots: { index: false, follow: true }`, so search
  // engines won't index the page; emitting JSON-LD on those views wastes
  // bandwidth and DOM bytes for no SEO gain. The unfiltered view continues
  // to emit the website + gallery structured data.
  const shouldEmitJsonLd = tagSlugs.length === 0;

  const websiteLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: seo.title,
    url: localizeUrl(baseUrl, locale, '/'),
    description: seo.description,
  };

  const galleryLd = images.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: seo.title,
    url: localizeUrl(baseUrl, locale, '/'),
    image: images.slice(0, 10).map((img) => ({
      '@type': 'ImageObject',
      contentUrl: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, baseUrl),
      thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(config.imageSizes, 640)}.jpg`)}`, baseUrl),
      name: getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`),
    })),
  } : null;

  return (
    <>
      {shouldEmitJsonLd && (
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(websiteLd)
          }}
        />
      )}
      {shouldEmitJsonLd && galleryLd && (
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(galleryLd)
          }}
        />
      )}
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="flex-1 min-w-0">
          <HomeClient images={images} tags={allTags} topics={allTopics} currentTags={tagSlugs} hasMore={hasMore} totalCount={totalCount} imageSizes={config.imageSizes} />
        </div>
        <div className="lg:w-64 xl:w-72 flex-shrink-0">
          <OnThisDayWidget />
        </div>
      </div>
    </>
  );
}
