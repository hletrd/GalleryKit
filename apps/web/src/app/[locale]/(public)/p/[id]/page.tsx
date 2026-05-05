import { getImageCached, getSeoSettings } from '@/lib/data';
import { isAdmin } from '@/app/actions/auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { TagInfo, formatShutterSpeed } from '@/lib/image-types';
import { getLocale, getTranslations } from 'next-intl/server';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { UNICODE_FORMAT_CHARS } from '@/lib/validation';
import { buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl } from '@/lib/locale-path';
import siteConfig from "@/site-config.json";
import { getGalleryConfig } from '@/lib/gallery-config';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { absoluteImageUrl } from '@/lib/image-url';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { PhotoViewerLoading } from '@/components/photo-viewer-loading';
import { getCspNonce } from '@/lib/csp-nonce';
import { recordPhotoView } from '@/app/actions/public';

const PhotoViewer = dynamic(() => import('@/components/photo-viewer'), {
    loading: () => <PhotoViewerLoading />,
});

function toIsoTimestamp(value: string | Date | null | undefined) {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/**
 * Strip Unicode bidi/invisible formatting characters from a display string
 * before embedding it into structured data. Defense-in-depth: these are already
 * rejected at admin write time, but a cheap strip here closes any future gap
 * (e.g., data imported from a raw DB restore that bypasses validation).
 * Matches the `sanitizeForOg` in the OG image route.
 */
function sanitizeForOg(value: string): string {
    return value.replace(UNICODE_FORMAT_CHARS, '');
}


// Photo metadata and processed-file availability can change after background
// processing and admin edits, so render fresh instead of keeping week-long ISR.
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
    // Validate that id is a purely numeric positive integer before parseInt
    // (matches the default export's validation pattern)
    if (!/^\d+$/.test(id)) {
        const t = await getTranslations('photo');
        return { title: t('notFoundTitle') };
    }
    const imageId = parseInt(id, 10);
    if (isNaN(imageId) || imageId <= 0 || !Number.isInteger(imageId)) {
        const t = await getTranslations('photo');
        return { title: t('notFoundTitle') };
    }

    const [locale, t, seo, image] = await Promise.all([
        getLocale(),
        getTranslations('photo'),
        getSeoSettings(),
        getImageCached(imageId),
    ]);

    if (!image) {
        return {
            title: t('notFoundTitle'),
        };
    }

    const displayTitle = getPhotoDisplayTitle(image, t('titleWithId', { id: image.id }));
    let keywords: string[] = [];

    if (image.tags && image.tags.length > 0) {
        keywords = image.tags.map((t: TagInfo) => t.name);
    }

    if (image.topic) keywords.push(image.topic);

    const pageUrl = localizeUrl(seo.url, locale, `/p/${id}`);
    const author = seo.author.trim();
    const metadataDescription = image.description
        || (author
            ? t('descriptionByAuthorWithTitle', { author, title: displayTitle })
            : displayTitle);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);

    // US-P13: use per-photo OG image route; falls back to site default internally.
    const ogImageUrl = absoluteImageUrl(`/api/og/photo/${id}`, seo.url);

    const ogImages = [{
        url: ogImageUrl,
        width: 1200,
        height: 630,
        alt: displayTitle,
    }];

    // F-17 / AGG1L-LOW-04 / plan-301-C: emit hreflang alternates so
    // `/en/p/<id>` and `/ko/p/<id>` are associated for SEO instead of
    // being treated as separate pages. The map is generated from the
    // LOCALES constant so adding a new locale automatically extends it.
    const alternateLanguages = buildHreflangAlternates(seo.url, `/p/${id}`);

    return {
        title: displayTitle,
        description: metadataDescription,
        keywords: keywords,
        alternates: {
            canonical: pageUrl,
            languages: alternateLanguages,
        },
        openGraph: {
            title: displayTitle,
            description: metadataDescription,
            url: pageUrl,
            siteName: seo.title,
            images: ogImages,
            type: 'article',
            publishedTime: toIsoTimestamp(image.created_at),
            ...(author ? { authors: [author] } : {}),
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
        },
        twitter: {
            card: 'summary_large_image',
            title: displayTitle,
            description: metadataDescription,
            images: [ogImageUrl],
        }
    };
}

export default async function PhotoPage({ params, searchParams }: {
    params: Promise<{ id: string }>;
    // C1RPF-PHOTO-HIGH-02: read `?checkout=success|cancel` so the photo
    // viewer can surface a toast on Stripe post-checkout redirect.
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
    // Validate that id is a purely numeric positive integer
    if (!/^\d+$/.test(id)) {
        return notFound();
    }
    const imageId = parseInt(id, 10);
    if (isNaN(imageId) || imageId <= 0 || !Number.isInteger(imageId)) {
        return notFound();
    }

    const sp = (await searchParams) ?? {};
    const checkoutRaw = sp.checkout;
    const checkoutValue = Array.isArray(checkoutRaw) ? checkoutRaw[0] : checkoutRaw;
    const checkoutStatus: 'success' | 'cancel' | null =
        checkoutValue === 'success' || checkoutValue === 'cancel' ? checkoutValue : null;

    const [locale, t, image, seo, config, isAdminUser] = await Promise.all([
        getLocale(),
        getTranslations('photo'),
        getImageCached(imageId),
        getSeoSettings(),
        getGalleryConfig(),
        isAdmin(),
    ]);

    if (!image) return notFound();

    // Preload adjacent images for instant prev/next navigation
    const [prevImage, nextImage] = await Promise.all([
        image.prevId ? getImageCached(image.prevId) : null,
        image.nextId ? getImageCached(image.nextId) : null,
    ]);
    const preloadSize = findNearestImageSize(config.imageSizes, 1536);
    const preloadUrls: string[] = [];
    for (const adj of [prevImage, nextImage]) {
        if (adj?.filename_jpeg) {
            const base = adj.filename_jpeg.replace(/\.jpg$/i, '');
            preloadUrls.push(absoluteImageUrl(`/uploads/jpeg/${base}_${preloadSize}.jpg`, seo.url));
        }
    }

    // Fire-and-forget view recording: do not block render on analytics insert.
    // recordPhotoView is a void server action — errors are swallowed internally.
    void recordPhotoView(image.id);

    // Keep JSON-LD naming aligned with metadata and the hydrated viewer
    const displayTitle = getPhotoDisplayTitle(image, t('titleWithId', { id: image.id }));
    const nonce = await getCspNonce();

    const keywords = image.tags?.map((t: TagInfo) => t.name) || [];
    if (image.topic) keywords.push(image.topic);
    const author = seo.author.trim();

    const jsonLd = {
        '@context': 'https://schema.org',
        '@type': 'ImageObject',
        contentUrl: absoluteImageUrl(`/uploads/jpeg/${image.filename_jpeg}`, seo.url),
        thumbnailUrl: absoluteImageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(config.imageSizes, 640)}.jpg`)}`, seo.url),
        encodingFormat: 'image/jpeg',
        ...(author ? {
            creditText: author,
            creator: {
                '@type': 'Person',
                name: author,
            },
            copyrightNotice: author,
        } : {}),
        datePublished: toIsoTimestamp(image.created_at),
        uploadDate: toIsoTimestamp(image.created_at),
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
            image.camera_model && { '@type': 'PropertyValue', name: 'Camera', value: sanitizeForOg(image.camera_model) },
            image.lens_model && { '@type': 'PropertyValue', name: 'Lens', value: sanitizeForOg(image.lens_model) },
            image.iso && { '@type': 'PropertyValue', name: 'ISO', value: image.iso },
            image.f_number && { '@type': 'PropertyValue', name: 'Aperture', value: `f/${image.f_number}` },
            image.exposure_time && { '@type': 'PropertyValue', name: 'Exposure Time', value: sanitizeForOg(formatShutterSpeed(image.exposure_time) ?? image.exposure_time) },
        ].filter(Boolean),
    };

    const breadcrumbLd = {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
            {
                '@type': 'ListItem',
                position: 1,
                name: seo.title || siteConfig.title,
                item: localizeUrl(seo.url, locale, '/'),
            },
            image.topic && {
                '@type': 'ListItem',
                position: 2,
                // C4R-RPL2-03: prefer the human-facing topic label over the
                // url-slug so search engines show "Family Vacation 2024"
                // rather than "family-vacation-2024" in the breadcrumb.
                name: image.topic_label || image.topic,
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

    return (
        <>
            {preloadUrls.map((url) => (
                <link key={url} rel="preload" as="image" href={url} />
            ))}
            <script
                type="application/ld+json"
                nonce={nonce}
                dangerouslySetInnerHTML={{
                    __html: safeJsonLd(jsonLd)
                }}
            />
            <script
                type="application/ld+json"
                nonce={nonce}
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
                shareBaseUrl={seo.url}
                untitledFallbackTitle={t('titleWithId', { id: image.id })}
                slideshowIntervalSeconds={config.slideshowIntervalSeconds}
                licensePrices={config.licensePrices}
                checkoutStatus={checkoutStatus}
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
