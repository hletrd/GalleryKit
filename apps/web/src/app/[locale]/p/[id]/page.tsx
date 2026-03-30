import { getImageCached } from '@/lib/data';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import siteConfig from "@/site-config.json";
import { TagInfo } from '@/lib/image-types';
import { getLocale } from 'next-intl/server';

const PhotoViewer = dynamic(() => import('@/components/photo-viewer'));


// Cache for 1 week (604800s) as photo content rarely changes
export const revalidate = 604800;

const BASE_URL = process.env.BASE_URL || siteConfig.url;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const locale = await getLocale();
    const imageId = parseInt(id, 10);
    const image = await getImageCached(imageId);

    if (!image) {
        return {
            title: 'Photo Not Found',
        };
    }

    // Safe title generation logic
    const hasTags = image.tags && image.tags.length > 0;
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);

    let displayTitle = 'Untitled';
    let keywords: string[] = [];

    if (hasTags) {
        displayTitle = image.tags.map((t: TagInfo) => `#${t.name}`).join(' ');
        keywords = image.tags.map((t: TagInfo) => t.name);
    } else if (image.title && !isTitleFilename) {
        displayTitle = image.title.split(/\s+/).map((word: string) => `#${word}`).join(' ');
    } else {
        displayTitle = `Photo ${image.id}`;
    }

    if (image.topic) keywords.push(image.topic);

    const imageUrl = `/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, '_1536.jpg')}`;
    const absoluteImageUrl = `${BASE_URL}${imageUrl}`;
    const pageUrl = `${BASE_URL}/${locale}/p/${id}`;

    return {
        title: displayTitle,
        description: image.description || `View photo by ${siteConfig.author} (${displayTitle})`,
        keywords: keywords,
        alternates: {
            canonical: pageUrl,
        },
        openGraph: {
            title: displayTitle,
            description: image.description || `View photo by ${siteConfig.author}`,
            url: pageUrl,
            images: [
                {
                    url: absoluteImageUrl,
                    width: image.width,
                    height: image.height,
                    alt: displayTitle,
                }
            ],
            type: 'article',
            publishedTime: image.created_at?.toString(),
            authors: [siteConfig.author],
        },
        twitter: {
            card: 'summary_large_image',
            title: displayTitle,
            description: image.description || `View photo by ${siteConfig.author}`,
            images: [absoluteImageUrl],
        }
    };
}

export default async function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const locale = await getLocale();

    // Validate that id is a valid positive integer
    const imageId = parseInt(id, 10);
    if (isNaN(imageId) || imageId <= 0 || !Number.isInteger(imageId)) {
        return notFound();
    }

    const image = await getImageCached(imageId);

    if (!image) return notFound();

    // Replicate title logic for JSON-LD
    const hasTags = image.tags && image.tags.length > 0;
    const isTitleFilename = image.title && /\.[a-z0-9]{3,4}$/i.test(image.title);

    const displayTitle = hasTags
        ? image.tags.map((t: TagInfo) => `#${t.name}`).join(' ')
        : (image.title && !isTitleFilename
            ? image.title.split(/\s+/).map((word: string) => `#${word}`).join(' ')
            : 'Untitled');

    const keywords = image.tags?.map((t: TagInfo) => t.name) || [];
    if (image.topic) keywords.push(image.topic);

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ImageObject',
        contentUrl: `${process.env.BASE_URL || siteConfig.url}/uploads/jpeg/${image.filename_jpeg}`,
        thumbnailUrl: `${process.env.BASE_URL || siteConfig.url}/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, '_640.jpg')}`,
        encodingFormat: 'image/jpeg',
        license: 'https://creativecommons.org/licenses/by-nc/4.0/',
        acquireLicensePage: siteConfig.parent_url,
        creditText: siteConfig.author,
        creator: {
            '@type': 'Person',
            name: siteConfig.author,
        },
        copyrightNotice: siteConfig.author,
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
                name: siteConfig.title || 'GalleryKit',
                item: `${BASE_URL}/${locale}`,
            },
            image.topic && {
                '@type': 'ListItem',
                position: 2,
                name: image.topic,
                item: `${BASE_URL}/${locale}/${image.topic}`,
            },
            {
                '@type': 'ListItem',
                position: image.topic ? 3 : 2,
                name: displayTitle,
                item: `${BASE_URL}/${locale}/p/${id}`,
            },
        ].filter(Boolean),
    };

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c')
                }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify(breadcrumbLd).replace(/</g, '\\u003c')
                }}
            />
            <PhotoViewer
                images={[image]}
                initialImageId={image.id}
                tags={[]}
                prevId={image.prevId}
                nextId={image.nextId}
            />
            {/* Prefetch adjacent photos for instant navigation */}
            {image.prevId && (
                <Link href={`/p/${image.prevId}`} prefetch={true} className="hidden" aria-hidden="true" tabIndex={-1}>
                    prev
                </Link>
            )}
            {image.nextId && (
                <Link href={`/p/${image.nextId}`} prefetch={true} className="hidden" aria-hidden="true" tabIndex={-1}>
                    next
                </Link>
            )}
        </>
    );
}
