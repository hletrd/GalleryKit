import { getSharedGroupCached, getSeoSettings } from '@/lib/data';
import { recordSharedGroupView } from '@/app/actions/public';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { ArrowLeft } from 'lucide-react';
import { imageUrl, sizedImageSrcSet, sizedImageUrl } from '@/lib/image-url';
import { getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl } from '@/lib/locale-path';
import PhotoViewer from '@/components/photo-viewer';
import { GridPicture } from '@/components/grid-picture';
import { GridPictureFallbackBoundary } from '@/components/grid-picture-fallback-boundary';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findGridCardImageSize } from '@/lib/gallery-config-shared';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { getClientIp, preIncrementShareAttempt } from '@/lib/rate-limit';
import { isBase56 } from '@/lib/base56';
import { parseSafePositiveInteger } from '@/lib/validation';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';
import { getPublicRestoreMaintenanceMetadata } from '@/lib/public-restore-maintenance-metadata';
import { SHARED_GROUP_MASONRY_SIZES } from '@/lib/responsive-masonry';

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
    const maintenanceMetadata = await getPublicRestoreMaintenanceMetadata();
    if (maintenanceMetadata) return maintenanceMetadata;

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

    if (!isBase56(key, 10)) {
        return notFound();
    }
    if (isRestoreMaintenanceActive()) {
        const tCommon = await getTranslations('common');
        return <PublicRestoreMaintenance title={tCommon('restoreMaintenanceTitle')} body={tCommon('restoreMaintenanceBody')} />;
    }

    // Rate-limit share-key lookups to prevent automated key enumeration
    if (await isShareLookupRateLimited()) {
        return notFound();
    }

    const photoId = parseSafePositiveInteger(photoIdParam);

    const [group, seo, t, tAria, config] = await Promise.all([
        getSharedGroupCached(key, { selectedPhotoId: photoId }),
        getSeoSettings(),
        getTranslations('sharedGroup'),
        getTranslations('aria'),
        getGalleryConfig(),
    ]);

    if (!group) {
        return notFound();
    }

    const gridImageSize = findGridCardImageSize(config.imageSizes);
    const gridImageSizes = config.imageSizes;

    let selectedImage = null;

    if (photoId) {
        const index = group.images.findIndex(img => img.id === photoId);
        if (index !== -1) {
            selectedImage = group.images[index];
        }
    }

    // Fire-and-forget durable view recording. Use the same resolved selection
    // decision as the denormalized bufferGroupViewCount path in data.ts, so an
    // invalid ?photoId= URL cannot increment only one shared-group counter.
    if (!selectedImage && group.images.length > 0) {
        void recordSharedGroupView(group.id, key);
    }

    if (selectedImage) {
        const displayTitle = getPhotoDisplayTitle(selectedImage, t('photo'));
        const subtitle = selectedImage.description || t('viewCount', { count: group.images.length });

        return (
            <>
                <div className="flex items-center justify-between mb-4 px-4 pt-4">
                    <Link href={localizePath(locale, `/g/${key}`)} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 min-h-11 outline-none rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <ArrowLeft className="h-4 w-4" /> {t('backToSharedPhotos')}
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
                    forceShowColorChips={config.forceShowColorChips}
                    forceSrgbDerivatives={config.forceSrgbDerivatives}
                    semanticSearchMode={config.semanticSearchMode}
                />
            </>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">{t('title')}</h1>
                <Link href={localizePath(locale, '/')} className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center gap-1 min-h-11 outline-none rounded focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    <ArrowLeft className="h-4 w-4" /> {t('viewGallery')}
                </Link>
            </div>
            <GridPictureFallbackBoundary className="columns-1 md:columns-2 lg:columns-3 xl:columns-4 gap-4 space-y-4">
                {group.images.map((image, index) => {
                    const altText = getPhotoDisplayTitle(image, t('photo'));
                    const aspectWidth = image.width > 0 ? image.width : 1;
                    const aspectHeight = image.height > 0 ? image.height : 1;
                    // CSS columns balance top-to-bottom, so only the first DOM
                    // item is invariantly a visual column leader.
                    const isAboveFold = index === 0;

                    return (
                        <Link
                            key={image.id}
                            href={`${localizePath(locale, `/g/${key}`)}?photoId=${image.id}`}
                            // C4-04 / PERF4-01 (run-10 c4): viewport-entry RSC
                            // prefetches of every visible tile drain the same
                            // per-IP SHARE_MAX_REQUESTS budget as real lookups
                            // (each prefetch re-runs the pre-incrementing page
                            // render) — a large shared grid could 404 the
                            // recipient's session before they clicked anything.
                            prefetch={false}
                            className="block break-inside-avoid relative group overflow-hidden rounded-lg bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                            aria-label={tAria('viewPhoto', { title: altText })}
                            style={{
                                aspectRatio: `${aspectWidth} / ${aspectHeight}`,
                                backgroundColor: 'hsl(var(--muted))',
                                containIntrinsicSize: `auto ${Math.round(300 * aspectHeight / aspectWidth)}px`,
                            }}
                        >
                            <div className="absolute inset-x-0 top-0 z-10 sm:hidden bg-gradient-to-b from-black/65 to-transparent p-3">
                                <p className="text-white text-sm font-medium truncate">{altText}</p>
                            </div>
                            <GridPicture
                                sources={[
                                    ...(image.filename_avif ? [{
                                        type: 'image/avif',
                                        srcSet: sizedImageSrcSet('/uploads/avif', image.filename_avif, gridImageSizes),
                                        sizes: SHARED_GROUP_MASONRY_SIZES,
                                    }] : []),
                                    ...(image.filename_webp ? [{
                                        type: 'image/webp',
                                        srcSet: sizedImageSrcSet('/uploads/webp', image.filename_webp, gridImageSizes),
                                        sizes: SHARED_GROUP_MASONRY_SIZES,
                                    }] : []),
                                    {
                                        type: 'image/jpeg',
                                        srcSet: sizedImageSrcSet('/uploads/jpeg', image.filename_jpeg, gridImageSizes),
                                        sizes: SHARED_GROUP_MASONRY_SIZES,
                                    },
                                ]}
                                src={sizedImageUrl('/uploads/jpeg', image.filename_jpeg, gridImageSize, gridImageSizes)}
                                fallbackSrc={imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)}
                                alt={altText}
                                width={image.width}
                                height={image.height}
                                className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-105"
                                loading={isAboveFold ? "eager" : "lazy"}
                                fetchPriority={isAboveFold ? "high" : "auto"}
                                decoding="async"
                            />
                            {/* Desktop hover overlay — matches main gallery pattern */}
                            <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/60 to-transparent p-4 sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-300">
                                <p className="text-white font-medium truncate">{altText}</p>
                            </div>
                        </Link>
                    );
                })}
            </GridPictureFallbackBoundary>
            {group.images.length === 0 && (
                <div className="text-center py-20 text-muted-foreground">
                    {t('empty')}
                </div>
            )}
        </div>
    );
}
