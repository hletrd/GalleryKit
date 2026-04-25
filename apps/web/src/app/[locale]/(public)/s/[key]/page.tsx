import { getImageByShareKeyCached, getSeoSettings } from '@/lib/data';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl } from '@/lib/locale-path';
import PhotoViewer from '@/components/photo-viewer';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { absoluteImageUrl } from '@/lib/image-url';
import { getPhotoDisplayTitle } from '@/lib/photo-title';

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

function toIsoTimestamp(value: string | Date | null | undefined) {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const [locale, t, seo, config, image] = await Promise.all([
        getLocale(),
        getTranslations('shared'),
        getSeoSettings(),
        getGalleryConfig(),
        getImageByShareKeyCached(key),
    ]);
    if (!image) return {
        title: t('ogNotFoundTitle'),
        description: t('ogNotFoundDescription'),
        robots: sharePageRobots,
    };
    const title = getPhotoDisplayTitle(image, t('ogTitle'));
    const pageUrl = localizeUrl(seo.url, locale, `/s/${key}`);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);
    // Use configured image sizes for OG image URL (avoids 404s if admin changes image_sizes)
    const ogImageSize = findNearestImageSize(config.imageSizes, 1536);

    const ogImageUrl = absoluteImageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${ogImageSize}.jpg`)}`, seo.url);
    const ogImages = [{
        url: ogImageUrl,
        width: image.width,
        height: image.height,
        alt: title,
    }];

    return {
        title: title,
        description: image.description || t('ogDescription', { site: seo.title }),
        robots: sharePageRobots,
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title: title,
            description: image.description || t('ogDescription', { site: seo.title }),
            url: pageUrl,
            siteName: seo.title,
            images: ogImages,
            type: 'article',
            publishedTime: toIsoTimestamp(image.created_at),
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
        },
        twitter: {
            card: 'summary_large_image',
            title: title,
            description: image.description || t('ogDescription', { site: seo.title }),
            images: [ogImageUrl],
        },
    };
}

export default async function SharedPhotoPage({ params }: { params: Promise<{ key: string }> }) {
    const { key } = await params;
    const [locale, t, image, seo, config] = await Promise.all([
        getLocale(),
        getTranslations('shared'),
        getImageByShareKeyCached(key),
        getSeoSettings(),
        getGalleryConfig(),
    ]);

    if (!image) {
        return notFound();
    }

    const displayTitle = getPhotoDisplayTitle(image, t('sharedPhoto'));
    const subtitle = image.description || `${seo.nav_title || seo.title} · ${t('sharedPhoto')}`;

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
                images={[image]}
                initialImageId={image.id}
                tags={image.tags ?? []}
                prevId={null}
                nextId={null}
                isSharedView
                imageSizes={config.imageSizes}
                siteTitle={seo.title}
                shareBaseUrl={seo.url}
                untitledFallbackTitle={t('sharedPhoto')}
            />
        </>
    );
}
