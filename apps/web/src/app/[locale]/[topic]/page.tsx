import { getImages, getTags, getTopicBySlug } from '@/lib/data';
import Image from 'next/image';
import Link from 'next/link';
import { TagFilter } from '@/components/tag-filter';
import { TopicEmptyState } from '@/components/topic-empty-state';
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

  const images = await getImages(topic);
  const latestImage = images[0];
  const isLatestTitleFilename = latestImage?.title
    ? /\.[a-z0-9]{3,4}$/i.test(latestImage.title)
    : false;

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
      images: latestImage ? [
        {
          url: `/uploads/jpeg/${latestImage.filename_jpeg}`,
          width: latestImage.width,
          height: latestImage.height,
          alt: latestImage.title && !isLatestTitleFilename ? latestImage.title : topicData.label,
        }
      ] : [],
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

  // Parse comma-separated tags
  const tagSlugs = tagsParam ? tagsParam.split(',').filter(Boolean) : [];

  const topicData = await getTopicBySlug(topic);
  if (!topicData) {
    notFound();
  }

  // If the requested topic slug doesn't match the canonical slug, redirect standardly
  if (topicData.slug !== topic) {
      redirect(`/${topicData.slug}`);
  }

  const images = await getImages(topic, tagSlugs.length > 0 ? tagSlugs : undefined);
  const tags = (await getTags(topic)).filter(t => t.count > 1);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col space-y-2">
          <h1 className="text-3xl font-bold tracking-tight flex flex-wrap items-baseline gap-x-2">
            {topicData.label}
            {tagSlugs.length > 0 && (
              <span className="text-muted-foreground font-normal">
                {tagSlugs.map(slug => {
                  const match = tags.find(t => t.slug === slug.trim().toLowerCase());
                  return `#${match?.name ?? slug}`;
                }).join(' ')}
              </span>
            )}
          </h1>
          <p className="text-muted-foreground">
            {images.length} photos.
          </p>
        </div>
        <TagFilter tags={tags} />
      </div>

      <div className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 gap-4 space-y-4">
        {images.map((image) => {
          const altText = image.title || image.user_filename || 'Gallery Image';

          return (
            <div key={image.id} className="break-inside-avoid relative group overflow-hidden rounded-xl bg-muted/20 [mask-image:radial-gradient(white,black)]">
              <Link href={`/p/${image.id}`}>
                <div className="relative w-full">
                  <picture>
                    {(() => {
                      const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
                      const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');

                      if (baseWebp && baseAvif) {
                        return (
                          <>
                            <source
                              type="image/avif"
                              srcSet={`/uploads/avif/${baseAvif}_640.avif 640w, /uploads/avif/${baseAvif}_1536.avif 1536w`}
                              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                            />
                            <source
                              type="image/webp"
                              srcSet={`/uploads/webp/${baseWebp}_640.webp 640w, /uploads/webp/${baseWebp}_1536.webp 1536w`}
                              sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                            />
                            <img
                              src={`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, '_640.jpg')}`}
                              // Fallback if 640 doesn't exist (legacy), browser will try.
                              // Ideally we should have a reliable fallback.
                              // Actually for legacy images, only existing sizes work.
                              // We can just use the standard filename_jpeg as src for safety, but with 640w in srcset if we wanted for img.
                              // Let's just use the filename_jpeg as main src.
                              alt={altText}
                              width={image.width}
                              height={image.height}
                              className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                              loading="lazy"
                              decoding="async"
                            />
                          </>
                        );
                      }

                      return (
                        <Image
                          src={`/uploads/jpeg/${image.filename_jpeg}`}
                          alt={altText}
                          width={image.width}
                          height={image.height}
                          className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                          sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                          blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                          placeholder="blur"
                        />
                      );
                    })()}
                  </picture>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <h3 className="text-white font-medium truncate">
                      {image.title && image.title.trim().length > 0
                        ? image.title
                        : (image.tag_names
                            ? image.tag_names.split(',').map((t: string) => `#${t.trim()}`).join(' ')
                            : (image.user_filename || 'Untitled'))}
                    </h3>
                    <p className="text-white/80 text-xs truncate">{image.topic}</p>
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      {images.length === 0 && (
        <TopicEmptyState
          hasFilters={tagSlugs.length > 0}
          clearHref={`/${topic}`}
        />
      )}
    </div>
  );
}
