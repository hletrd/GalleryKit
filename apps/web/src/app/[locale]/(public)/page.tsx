import { getImagesLite, getImagesLitePage, getTagsCached, getTopicsCached, getSeoSettings } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { OnThisDayWidget } from '@/components/on-this-day-widget';
import { Metadata } from 'next';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { getLocale, getTranslations } from 'next-intl/server';
import { buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale, localizeUrl } from '@/lib/locale-path';
import { getGalleryConfig } from '@/lib/gallery-config';
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
  // AGG-10 (run-6 c1): the root layout sets title.template = `%s | ${seo.title}`,
  // which Next applies to any string `metadata.title`. The home page already
  // bakes the site name into `title` (the no-filter branch IS the site root =
  // `seo.title`; the filtered branch ends `… | ${seo.title}`), so a string title
  // here double-suffixes: `GalleryKit | GalleryKit` (no-filter) and
  // `#tag | GalleryKit | GalleryKit` (filtered). `{ absolute }` opts the page out
  // of the template. OpenGraph/Twitter titles are NOT templated by Next, so those
  // keep the plain `title` string.
  const metadataTitle = { absolute: title } as const;

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
      title: metadataTitle,
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

  // AGG-R7-09: the OG image now uses the always-present base JPEG, so the
  // gallery config (only needed previously for findNearestImageSize) is no
  // longer fetched in this metadata path.
  const images = await getImagesLite(undefined, tagSlugs.length > 0 ? tagSlugs : undefined, 1, 0);
  const latestImage = images[0];
  const isLatestTitleFilename = latestImage?.title
    ? /\.[a-z0-9]{3,4}$/i.test(latestImage.title)
    : false;

  // AGG-R7-09 (run-7 c1): point the home OG <meta og:image> at the BASE JPEG,
  // not a `_${size}.jpg` sized derivative. The previous nearest-configured-size
  // approach did NOT guarantee that derivative is on disk for a freshly-
  // uploaded or legacy `latestImage` mid-backfill (or right after an
  // `image_sizes` reconfigure), so a sized URL could 404 the social card until
  // backfill catches up. The encoder atomic-rename contract
  // guarantees the base filename always exists for a processed photo; a
  // base-resolution card is fully valid and never 404s. (Unlike the per-photo
  // OG ROUTE, which Satori-renders bytes server-side and so iterates sizes via
  // pickFirstAvailablePhotoBuffer, this path only emits a URL string and cannot
  // probe the filesystem cheaply — so prefer the always-present base.)
  const ogImages = latestImage
    ? [{
        url: absoluteImageUrl(`/uploads/jpeg/${latestImage.filename_jpeg}`, seo.url),
        width: latestImage.width,
        height: latestImage.height,
        alt: latestImage.title && !isLatestTitleFilename ? latestImage.title : t('latestPhoto'),
      }]
    : [];

  return {
    title: metadataTitle,
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
      // R21-M2: use the base JPEG filename for the JSON-LD thumbnail so
      // Googlebot Image always gets a 200 response. The sized derivative
      // can be missing for legacy rows or photos caught mid-backfill;
      // the base filename is guaranteed by the encoder atomic-rename
      // contract.
      thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, baseUrl),
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
      <div className="space-y-12">
        <HomeClient images={images} tags={allTags} topics={allTopics} currentTags={tagSlugs} hasMore={hasMore} totalCount={totalCount} imageSizes={config.imageSizes} />
        <OnThisDayWidget />
      </div>
    </>
  );
}
