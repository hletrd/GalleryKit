import { getSharedGroupCached, getSeoSettings } from '@/lib/data';
import { notFound } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { ArrowLeft } from 'lucide-react';
import { absoluteImageUrl, imageUrl } from '@/lib/image-url';
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

export async function generateMetadata({ params, searchParams }: { params: Promise<{ key: string }>, searchParams: Promise<{ photoId?: string }> }): Promise<Metadata> {
    const { key } = await params;
    const { photoId: photoIdParam } = await searchParams;
    const [locale, t, seo, config, group] = await Promise.all([
        getLocale(),
        getTranslations('sharedGroup'),
        getSeoSettings(),
        getGalleryConfig(),
        getSharedGroupCached(key, { incrementViewCount: false }),
    ]);
    if (!group) return {
        title: t('notFoundTitle'),
        description: t('notFoundDescription'),
        robots: sharePageRobots,
    };
    let selectedImage = null;
    if (photoIdParam && /^\d+$/.test(photoIdParam)) {
        const selectedId = Number.parseInt(photoIdParam, 10);
        selectedImage = group.images.find((image) => image.id === selectedId) ?? null;
    }

    const pagePath = selectedImage ? `/g/${key}?photoId=${selectedImage.id}` : `/g/${key}`;
    const pageUrl = localizeUrl(seo.url, locale, pagePath);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);
    const coverImage = selectedImage ?? group.images[0];
    const metadataTitle = selectedImage ? getPhotoDisplayTitle(selectedImage, t('photo')) : t('ogTitle');
    const metadataDescription = selectedImage?.description || (selectedImage ? t('ogDescriptionWithSite', { count: group.images.length, site: seo.title }) : t('ogDescriptionWithSite', { count: group.images.length, site: seo.title }));
    // Use configured image sizes for OG image URL (avoids 404s if admin changes image_sizes)
    const ogImageSize = findNearestImageSize(config.imageSizes, 1536);

    const coverImageUrl = coverImage
        ? absoluteImageUrl(`/uploads/jpeg/${coverImage.filename_jpeg.replace(/\.jpg$/i, `_${ogImageSize}.jpg`)}`, seo.url)
        : null;
    const ogImages = coverImage && coverImageUrl
        ? [{
            url: coverImageUrl,
            width: coverImage.width,
            height: coverImage.height,
            alt: selectedImage ? metadataTitle : t('ogAlt'),
        }]
        : [];

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
            images: ogImages,
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
        },
        twitter: {
            card: 'summary_large_image',
            title: metadataTitle,
            description: metadataDescription,
            ...(coverImageUrl ? {
                images: [coverImageUrl],
            } : {}),
        },
    };
}

export default async function SharedGroupPage({ params, searchParams }: { params: Promise<{ key: string, locale: string }>, searchParams: Promise<{ photoId?: string }> }) {
    const { key, locale } = await params;
    const { photoId: photoIdParam } = await searchParams;

    // Rate-limit share-key lookups to prevent automated key enumeration
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    if (preIncrementShareAttempt(ip, Date.now())) {
        return notFound();
    }

    const [group, seo, t, config] = await Promise.all([
        getSharedGroupCached(key, { incrementViewCount: !photoIdParam }),
        getSeoSettings(),
        getTranslations('sharedGroup'),
        getGalleryConfig(),
    ]);

    if (!group) {
        return notFound();
    }
    const gridImageSize = findGridCardImageSize(config.imageSizes);

    let photoId: number | null = null;
    if (photoIdParam && /^\d+$/.test(photoIdParam)) {
        const parsed = parseInt(photoIdParam, 10);
        if (parsed > 0) {
            photoId = parsed;
        }
    }

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
                {group.images.map((image) => {
                    const altText = getPhotoDisplayTitle(image, t('photo'));

                    return (
                        <Link
                            key={image.id}
                            href={`${localizePath(locale, `/g/${key}`)}?photoId=${image.id}`}
                            className="block break-inside-avoid relative group overflow-hidden rounded-lg bg-muted/20"
                        >
                            <div className="absolute inset-x-0 top-0 z-10 sm:hidden bg-gradient-to-b from-black/65 to-transparent p-3">
                                <p className="text-white text-sm font-medium truncate">{altText}</p>
                            </div>
                            <Image
                                src={imageUrl(`/uploads/webp/${image.filename_webp.replace(/\.webp$/i, `_${gridImageSize}.webp`)}`)}
                                alt={altText}
                                width={image.width}
                                height={image.height}
                                className="w-full h-auto object-cover transition-transform duration-300 group-hover:scale-105"
                                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            />
                        </Link>
                    );
                })}
            </div>
            {group.images.length === 0 && (
                <div className="text-center py-20 text-muted-foreground">
                    {t('empty')}
                </div>
            )}
        </div>
    );
}
