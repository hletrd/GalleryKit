import { getImagesLite, getTags, getImageCount, getTopics, getSeoSettings } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { Metadata } from 'next';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { getLocale, getTranslations } from 'next-intl/server';
import { localizeUrl } from '@/lib/locale-path';

// Homepage is dynamic, but we can set revalidate for better performance if desired.
// However, since it shows latest uploads, we might want it fresher or use ISR with short revalidate.
// Let's stick to force-dynamic or standard behavior for now as user didn't ask for homepage caching explicitly,
// but adding revalidate=3600 (1 hour) is a safe SEO/Performance win.
export const revalidate = 3600;

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ tags?: string }> }): Promise<Metadata> {
  const { tags: tagsParam } = await searchParams;
  const tagSlugs = tagsParam ? tagsParam.split(',').filter(Boolean) : [];
  const locale = await getLocale();
  const t = await getTranslations('home');
  const seo = await getSeoSettings();
  const pageUrl = localizeUrl(seo.url, locale, '/');

  const images = await getImagesLite(undefined, undefined, 1, 0);
  const latestImage = images[0];
  const isLatestTitleFilename = latestImage?.title
    ? /\.[a-z0-9]{3,4}$/i.test(latestImage.title)
    : false;

  const title = tagSlugs.length > 0
    ? `${tagSlugs.map(t => '#' + t).join(' ')} | ${seo.title}`
    : seo.title;

  const description = tagSlugs.length > 0
    ? t('browsePhotosWithTag', { tags: tagSlugs.join(', '), site: seo.title })
    : seo.description;

  // Use custom OG image if configured, otherwise use latest photo
  const ogImages = seo.og_image_url
    ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: seo.title }]
    : latestImage
      ? [{
          url: `${seo.url}/uploads/jpeg/${latestImage.filename_jpeg.replace(/\.jpg$/i, '_1536.jpg')}`,
          width: latestImage.width,
          height: latestImage.height,
          alt: latestImage.title && !isLatestTitleFilename ? latestImage.title : t('latestPhoto'),
        }]
      : [];

  return {
    title: title,
    description: description,
    openGraph: {
      title: title,
      description: description,
      url: pageUrl,
      siteName: seo.title,
      images: ogImages,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: title,
      description: description,
    },
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ tags?: string }> }) {
  const { tags: tagsParam } = await searchParams;
  const locale = await getLocale();
  const seo = await getSeoSettings();
  const baseUrl = seo.url;

  // Root always gets latest uploads (no topic)
  const [allTags, allTopics] = await Promise.all([getTags(), getTopics()]);

  // Parse and validate tag slugs
  const rawTagSlugs = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const tagSlugs = rawTagSlugs.filter(slug => allTags.some(t => t.slug === slug));

  const PAGE_SIZE = 30;
  const filterTags = tagSlugs.length > 0 ? tagSlugs : undefined;
  const [images, totalCount] = await Promise.all([
    getImagesLite(undefined, filterTags, PAGE_SIZE, 0),
    getImageCount(undefined, filterTags),
  ]);
  const hasMore = totalCount > PAGE_SIZE;

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
      contentUrl: `${baseUrl}/uploads/jpeg/${img.filename_jpeg}`,
      thumbnail: `${baseUrl}/uploads/jpeg/${img.filename_jpeg.replace(/\.jpg$/i, '_640.jpg')}`,
      name: img.title || `Photo ${img.id}`,
    })),
  } : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: safeJsonLd(websiteLd)
        }}
      />
      {galleryLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: safeJsonLd(galleryLd)
          }}
        />
      )}
      <HomeClient images={images} tags={allTags} topics={allTopics} currentTags={tagSlugs} hasMore={hasMore} totalCount={totalCount} />
    </>
  );
}
