import { getImageCached, getSeoSettings } from '@/lib/data';
import { isAdmin } from '@/app/actions/auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { TagInfo } from '@/lib/image-types';
import { getLocale, getTranslations } from 'next-intl/server';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import siteConfig from "@/site-config.json";
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';

const PhotoViewer = dynamic(() => import('@/components/photo-viewer'), {
    loading: () => <div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>,
});


// Cache for 1 week (604800s) as photo content rarely changes
export const revalidate = 604800;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const locale = await getLocale();
    const t = await getTranslations('photo');
    const seo = await getSeoSettings();

    // Validate that id is a purely numeric positive integer before parseInt
    // (matches the default export's validation pattern)
    if (!/^\d+$/.test(id)) {
        return { title: t('notFoundTitle') };
    }
    const imageId = parseInt(id, 10);
    if (isNaN(imageId) || imageId <= 0 || !Number.isInteger(imageId)) {
        return { title: t('notFoundTitle') };
    }

    const image = await getImageCached(imageId);

    if (!image) {
        return {
            title: t('notFoundTitle'),
        };
    }

    // Safe title generation logic
    const hasTags = image.tags && image.tags.length > 0;
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);

    let displayTitle = t('untitled');
    let keywords: string[] = [];

    if (hasTags) {
        displayTitle = image.tags.map((t: TagInfo) => `#${t.name}`).join(' ');
        keywords = image.tags.map((t: TagInfo) => t.name);
    } else if (image.title && !isTitleFilename) {
        displayTitle = image.title.split(/\s+/).map((word: string) => `#${word}`).join(' ');
    } else {
        displayTitle = t('titleWithId', { id: image.id });
    }

    if (image.topic) keywords.push(image.topic);

    // Use configured image sizes for OG image URLs (avoids 404s if admin changes image_sizes)
    const config = await getGalleryConfig();
    const ogImageSize = findNearestImageSize(config.imageSizes, 1536);
    const imageUrl = `/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${ogImageSize}.jpg`)}`;
    const absoluteImageUrl = `${seo.url}${imageUrl}`;
    const pageUrl = localizeUrl(seo.url, locale, `/p/${id}`);

    // Use custom OG image if configured, otherwise use photo image
    const ogImages = seo.og_image_url
        ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: seo.title }]
        : [{
            url: absoluteImageUrl,
            width: image.width,
            height: image.height,
            alt: displayTitle,
        }];

    return {
        title: displayTitle,
        description: image.description || t('descriptionByAuthorWithTitle', { author: seo.author, title: displayTitle }),
        keywords: keywords,
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title: displayTitle,
            description: image.description || t('descriptionByAuthor', { author: seo.author }),
            url: pageUrl,
            siteName: seo.title,
            images: ogImages,
            type: 'article',
            publishedTime: image.created_at?.toString(),
            authors: [seo.author],
        },
        twitter: {
            card: 'summary_large_image',
            title: displayTitle,
            description: image.description || t('descriptionByAuthor', { author: seo.author }),
            images: seo.og_image_url ? [seo.og_image_url] : [absoluteImageUrl],
        }
    };
}

export default async function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const locale = await getLocale();
    const t = await getTranslations('photo');

    // Validate that id is a purely numeric positive integer
    if (!/^\d+$/.test(id)) {
        return notFound();
    }
    const imageId = parseInt(id, 10);
    if (isNaN(imageId) || imageId <= 0 || !Number.isInteger(imageId)) {
        return notFound();
    }

    const image = await getImageCached(imageId);

    if (!image) return notFound();

    const seo = await getSeoSettings();
    const config = await getGalleryConfig();

    // Replicate title logic for JSON-LD
    const hasTags = image.tags && image.tags.length > 0;
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);

    const displayTitle = hasTags
        ? image.tags.map((t: TagInfo) => `#${t.name}`).join(' ')
        : (image.title && !isTitleFilename
            ? image.title.split(/\s+/).map((word: string) => `#${word}`).join(' ')
            : t('untitled'));

    const keywords = image.tags?.map((t: TagInfo) => t.name) || [];
    if (image.topic) keywords.push(image.topic);

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ImageObject',
        contentUrl: `${seo.url}/uploads/jpeg/${image.filename_jpeg}`,
        thumbnailUrl: `${seo.url}/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(config.imageSizes, 640)}.jpg`)}`,
        encodingFormat: 'image/jpeg',
        license: 'https://creativecommons.org/licenses/by-nc/4.0/',
        acquireLicensePage: siteConfig.parent_url,
        creditText: seo.author,
        creator: {
            '@type': 'Person',
            name: seo.author,
        },
        copyrightNotice: seo.author,
        datePublished: image.created_at,
        uploadDate: image.created_at,
        width: {
            '@type': 'QuantitativeValue',
            value: image.width,
            unitCode: 'E37',
        },
        height: {
            '@type': 'QuantitativeValue',
            value: image.height,
            unitCode: 'E37',
        },
        name: displayTitle,
        description: image.description,
        keywords: keywords.join(', '),
        // GPS coordinates are intentionally excluded from public queries for privacy
        exifData: [
            image.camera_model && { '@type': 'PropertyValue', name: 'Camera', value: image.camera_model },
            image.lens_model && { '@type': 'PropertyValue', name: 'Lens', value: image.lens_model },
            image.iso && { '@type': 'PropertyValue', name: 'ISO', value: image.iso },
            image.f_number && { '@type': 'PropertyValue', name: 'Aperture', value: `f/${image.f_number}` },
            image.exposure_time && { '@type': 'PropertyValue', name: 'Exposure Time', value: `${image.exposure_time}s` },
        ].filter(Boolean),
    };

    const breadcrumbLd = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            {
                '@type': 'ListItem',
                position: 1,
                name: seo.title || 'GalleryKit',
                item: localizeUrl(seo.url, locale, '/'),
            },
            image.topic && {
                '@type': 'ListItem',
                position: 2,
                name: image.topic,
                item: localizeUrl(seo.url, locale, `/${image.topic}`),
            },
            {
                '@type': 'ListItem',
                position: image.topic ? 3 : 2,
                name: displayTitle,
                item: localizeUrl(seo.url, locale, `/p/${id}`),
            },
        ].filter(Boolean),
    };

    const isAdminUser = await isAdmin();

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: safeJsonLd(jsonLd)
                }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: safeJsonLd(breadcrumbLd)
                }}
            />
            <PhotoViewer
                images={[image]}
                initialImageId={image.id}
                tags={image.tags ?? []}
                prevId={image.prevId}
                nextId={image.nextId}
                canShare={isAdminUser}
                isAdmin={isAdminUser}
                imageSizes={config.imageSizes}
                siteTitle={seo.title}
            />
            {/* Prefetch adjacent photos for instant navigation */}
            {image.prevId && (
                <Link href={localizePath(locale, `/p/${image.prevId}`)} prefetch={true} className="hidden" aria-hidden="true" tabIndex={-1}>
                    prev
                </Link>
            )}
            {image.nextId && (
                <Link href={localizePath(locale, `/p/${image.nextId}`)} prefetch={true} className="hidden" aria-hidden="true" tabIndex={-1}>
                    next
                </Link>
            )}
        </>
    );
}
