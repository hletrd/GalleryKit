import { getImagesLite, getTags, getImageCount, getTopics } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { Metadata } from 'next';
import siteConfig from "@/site-config.json";
import { safeJsonLd } from '@/lib/safe-json-ld';
import { getLocale } from 'next-intl/server';
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
  const pageUrl = localizeUrl(process.env.BASE_URL || siteConfig.url, locale, '/');

  const images = await getImagesLite(undefined, undefined, 1, 0);
  const latestImage = images[0];
  const isLatestTitleFilename = latestImage?.title
    ? /\.[a-z0-9]{3,4}$/i.test(latestImage.title)
    : false;

  const title = tagSlugs.length > 0
    ? `${tagSlugs.map(t => '#' + t).join(' ')} | Home`
    : 'Home';

  const description = tagSlugs.length > 0
    ? `Browse ${tagSlugs.join(', ')} photos on ${siteConfig.title}`
    : siteConfig.description;

  return {
    title: title,
    description: description,
    openGraph: {
      title: title,
      description: description,
      url: pageUrl,
      siteName: siteConfig.title,
      images: latestImage ? [
        {
          url: `${process.env.BASE_URL || siteConfig.url}/uploads/jpeg/${latestImage.filename_jpeg}`,
          width: latestImage.width,
          height: latestImage.height,
          alt: latestImage.title && !isLatestTitleFilename ? latestImage.title : 'Latest Photo',
        }
      ] : [],
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
  const baseUrl = process.env.BASE_URL || siteConfig.url;

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
    name: siteConfig.title,
    url: localizeUrl(baseUrl, locale, '/'),
    description: siteConfig.description,
  };

  const galleryLd = images.length > 0 ? {
    '@context': 'https://schema.org',
    '@type': 'ImageGallery',
    name: siteConfig.title,
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
