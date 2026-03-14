import { getImages, getTags, getImageCount } from '@/lib/data';
import { HomeClient } from '@/components/home-client';
import { Metadata } from 'next';
import siteConfig from "@/site-config.json";

// Homepage is dynamic, but we can set revalidate for better performance if desired.
// However, since it shows latest uploads, we might want it fresher or use ISR with short revalidate.
// Let's stick to force-dynamic or standard behavior for now as user didn't ask for homepage caching explicitly,
// but adding revalidate=3600 (1 hour) is a safe SEO/Performance win.
export const revalidate = 3600;

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ tags?: string }> }): Promise<Metadata> {
  const { tags: tagsParam } = await searchParams;
  const tagSlugs = tagsParam ? tagsParam.split(',').filter(Boolean) : [];

  const images = await getImages(undefined, undefined, 1, 0);
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
      images: latestImage ? [
        {
          url: `/uploads/jpeg/${latestImage.filename_jpeg}`,
          width: latestImage.width,
          height: latestImage.height,
          alt: latestImage.title && !isLatestTitleFilename ? latestImage.title : 'Latest Photo',
        }
      ] : [],
    },
  };
}

export default async function Home({ searchParams }: { searchParams: Promise<{ tags?: string }> }) {
  const { tags: tagsParam } = await searchParams;

  // Root always gets latest uploads (no topic)
  const allTags = await getTags();

  // Parse and validate tag slugs
  const rawTagSlugs = tagsParam ? tagsParam.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const tagSlugs = rawTagSlugs.filter(slug => allTags.some(t => t.slug === slug));

  const PAGE_SIZE = 30;
  const filterTags = tagSlugs.length > 0 ? tagSlugs : undefined;
  const [images, totalCount] = await Promise.all([
    getImages(undefined, filterTags, PAGE_SIZE, 0),
    getImageCount(undefined, filterTags),
  ]);
  const hasMore = totalCount > PAGE_SIZE;

  return <HomeClient images={images} tags={allTags} currentTags={tagSlugs} hasMore={hasMore} />;
}
