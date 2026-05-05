import { getSharedGroupCached, getSeoSettings } from '@/lib/data';
import { recordSharedGroupView } from '@/app/actions/public';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { ArrowLeft } from 'lucide-react';
import { imageUrl } from '@/lib/image-url';
import { getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl } from '@/lib/locale-path';
import PhotoViewer from '@/components/photo-viewer';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findGridCardImageSize, findNearestImageSize } from '@/lib/gallery-config-shared';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { getClientIp, preIncrementShareAttempt } from '@/lib/rate-limit';

export const revalidate = 0;

const sharePageRobots = {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
        index: false,
        follow: false,
        noarchive: true,
        noimageindex: true,
    },
} as const;

async function isShareLookupRateLimited() {
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    return preIncrementShareAttempt(ip);
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    // C4-AGG-01: Rate limit is NOT checked here — it is enforced once in the
    // page body. Both generateMetadata and the page body run in separate React
    // render contexts, so calling preIncrementShareAttempt in both would
    // double-increment the counter, giving users half the intended budget.
    //
    // AGG-C1-02: do not look up the share group here either. `generateMetadata`
    // is not the rate-limit enforcement point, so it must not reveal key
    // validity or image-specific OG data through an unthrottled DB lookup.
    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('sharedGroup'),
        getSeoSettings(),
    ]);
    const pagePath = `/g/${key}`;
    const pageUrl = localizeUrl(seo.url, locale, pagePath);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);
    const metadataTitle = t('ogTitle');
    const metadataDescription = t('ogGenericDescription', { site: seo.title });

    return {
        title: metadataTitle,
        description: metadataDescription,
        robots: sharePageRobots,
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title: metadataTitle,
            description: metadataDescription,
            url: pageUrl,
            siteName: seo.title,
            type: 'website',
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
        },
        twitter: {
            card: 'summary_large_image',
            title: metadataTitle,
            description: metadataDescription,
        },
    };
}

export default async function SharedGroupPage({ params, searchParams }: { params: Promise<{ key: string, locale: string }>, searchParams: Promise<{ photoId?: string }> }) {
    const { key, locale } = await params;
    const { photoId: photoIdParam } = await searchParams;

    // Rate-limit share-key lookups to prevent automated key enumeration
    if (await isShareLookupRateLimited()) {
        return notFound();
    }

    let photoId: number | null = null;
    if (photoIdParam && /^\d+$/.test(photoIdParam)) {
        const parsed = parseInt(photoIdParam, 10);
        if (parsed > 0) {
            photoId = parsed;
        }
    }

    const [group, seo, t, config] = await Promise.all([
        getSharedGroupCached(key, { selectedPhotoId: photoId }),
        getSeoSettings(),
        getTranslations('sharedGroup'),
        getGalleryConfig(),
    ]);

    if (!group) {
        return notFound();
    }

    // Fire-and-forget durable view recording. Only on the initial shared-group
    // page load (no per-photo query param) and only when there are visible images
    // — matching the existing bufferGroupViewCount logic in data.ts.
    // The existing denormalized view_count column is kept in lockstep by the
    // existing buffer flush mechanism; this adds the durable per-event record.
    if (!photoId && group.images.length > 0) {
        void recordSharedGroupView(group.id);
    }

    const gridImageSize = findGridCardImageSize(config.imageSizes);
    const gridImageSizes = config.imageSizes;
    const smallGridSize = gridImageSizes.length >= 2 ? gridImageSizes[0] : gridImageSize;
    const mediumGridSize = gridImageSizes.length >= 2 ? gridImageSizes[1] : findNearestImageSize(gridImageSizes, 1536);

    let selectedImage = null;

    if (photoId) {
        const index = group.images.findIndex(img => img.id === photoId);
        if (index !== -1) {
            selectedImage = group.images[index];
        }
    }

    if (selectedImage) {
        const displayTitle = getPhotoDisplayTitle(selectedImage, t('photo'));
        const subtitle = selectedImage.description || t('viewCount', { count: group.images.length });

        return (
            <>
                <div className="flex items-center justify-between mb-4 px-4 pt-4">
                    <Link href={localizePath(locale, '/')} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                        <ArrowLeft className="h-4 w-4" /> {t('viewGallery')}
                    </Link>
                </div>
                <div className="px-4 pb-3">
                    <h1 className="text-2xl font-semibold tracking-tight">{displayTitle}</h1>
                    <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
                </div>
                <PhotoViewer
                    images={group.images}
                    initialImageId={selectedImage.id}
                    tags={selectedImage.tags ?? []}
                    isSharedView
                    syncPhotoQueryBasePath={localizePath(locale, `/g/${key}`)}
                    imageSizes={config.imageSizes}
                    siteTitle={seo.title}
                    shareBaseUrl={seo.url}
                    untitledFallbackTitle={t('photo')}
                    showDocumentHeading={false}
                    slideshowIntervalSeconds={config.slideshowIntervalSeconds}
                    licensePrices={config.licensePrices}
                />
            </>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <Link href={localizePath(locale, '/')} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
                    <ArrowLeft className="h-4 w-4" /> {t('viewGallery')}
                </Link>
            </div>
            <div className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {group.images.map((image, index) => {
                    const altText = getPhotoDisplayTitle(image, t('photo'));
                    // Above-the-fold detection: in a CSS `columns` masonry layout,
                    // images flow top-to-bottom then left-to-right. The max column
                    // count is 4 (xl: breakpoint). Mark the first 4 images as eager
                    // so they load immediately for the best LCP on any viewport.
                    const isAboveFold = index < 4;

                    return (
                        <Link
                            key={image.id}
                            href={`${localizePath(locale, `/g/${key}`)}?photoId=${image.id}`}
                            className="block break-inside-avoid relative group overflow-hidden rounded-lg bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            style={{
                                aspectRatio: `${image.width} / ${image.height}`,
                                backgroundColor: 'hsl(var(--muted))',
                                containIntrinsicSize: `auto ${Math.round(300 * image.height / image.width)}px`,
                            }}
                        >
                            <div className="absolute inset-x-0 top-0 z-10 sm:hidden bg-gradient-to-b from-black/65 to-transparent p-3">
                                <p className="text-white text-sm font-medium truncate">{altText}</p>
                            </div>
                            <picture>
                                {image.filename_avif && (
                                    <source
                                        type="image/avif"
                                        srcSet={`${imageUrl(`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, `_${smallGridSize}.avif`)}`)} ${smallGridSize}w, ${imageUrl(`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, `_${mediumGridSize}.avif`)}`)} ${mediumGridSize}w`}
                                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                    />
                                )}
                                {image.filename_webp && (
                                    <source
                                        type="image/webp"
                                        srcSet={`${imageUrl(`/uploads/webp/${image.filename_webp.replace(/\.webp$/i, `_${smallGridSize}.webp`)}`)} ${smallGridSize}w, ${imageUrl(`/uploads/webp/${image.filename_webp.replace(/\.webp$/i, `_${mediumGridSize}.webp`)}`)} ${mediumGridSize}w`}
                                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                    />
                                )}
                                <img
                                    src={imageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${smallGridSize}.jpg`)}`)}
                                    alt={altText}
                                    width={image.width}
                                    height={image.height}
                                    className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-105"
                                    loading={isAboveFold ? "eager" : "lazy"}
                                    fetchPriority={isAboveFold ? "high" : "auto"}
                                    decoding="async"
                                />
                            </picture>
                            {/* Desktop hover overlay — matches main gallery pattern */}
                            <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/60 to-transparent p-4 sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-300">
                                <p className="text-white font-medium truncate">{altText}</p>
                            </div>
                        </Link>
                    );
                })}
            </div>
            {group.images.length === 0 && (
                <div className="text-center py-20 text-muted-foreground">
                    {t('processing')}
                </div>
            )}
        </div>
    );
}
