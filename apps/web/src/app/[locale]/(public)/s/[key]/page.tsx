import { getImageByShareKeyCached, getSeoSettings } from '@/lib/data';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import PhotoViewer from '@/components/photo-viewer';
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { absoluteImageUrl } from '@/lib/image-url';

function toIsoTimestamp(value: string | Date | null | undefined) {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
    const { key } = await params;
    const locale = await getLocale();
    const t = await getTranslations('shared');
    const seo = await getSeoSettings();
    const image = await getImageByShareKeyCached(key);
    if (!image) return {
        title: t('ogNotFoundTitle'),
        description: t('ogNotFoundDescription'),
    };
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
    const title = image.title && !isTitleFilename ? image.title : t('ogTitle');
    const pageUrl = localizeUrl(seo.url, locale, `/s/${key}`);
    // Use configured image sizes for OG image URL (avoids 404s if admin changes image_sizes)
    const config = await getGalleryConfig();
    const ogImageSize = findNearestImageSize(config.imageSizes, 1536);

    // Use custom OG image if configured, otherwise use photo image
    const ogImages = seo.og_image_url
        ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: seo.title }]
        : [{
            url: absoluteImageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${ogImageSize}.jpg`)}`, seo.url),
            width: image.width,
            height: image.height,
            alt: title,
        }];

    return {
        title: title,
        description: image.description || t('ogDescription', { site: seo.title }),
        robots: {
            index: false,
            follow: false,
            nocache: true,
            googleBot: {
                index: false,
                follow: false,
                noarchive: true,
                noimageindex: true,
            },
        },
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
        },
        twitter: {
            card: 'summary_large_image',
            title: title,
            description: image.description || t('ogDescription', { site: seo.title }),
            images: seo.og_image_url ? [seo.og_image_url] : [absoluteImageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${ogImageSize}.jpg`)}`, seo.url)],
        },
    };
}

export default async function SharedPhotoPage({ params }: { params: Promise<{ key: string }> }) {
    const { key } = await params;
    const locale = await getLocale();
    const t = await getTranslations('shared');
    const image = await getImageByShareKeyCached(key);

    if (!image) {
        return notFound();
    }

    const seo = await getSeoSettings();
    const config = await getGalleryConfig();

    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);
    const displayTitle = image.title && !isTitleFilename ? image.title : t('sharedPhoto');
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
            />
        </>
    );
}
