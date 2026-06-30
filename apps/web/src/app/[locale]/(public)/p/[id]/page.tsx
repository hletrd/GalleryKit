import { getImageCached, getImageForViewerCached, getSeoSettings } from '@/lib/data';
import { isAdmin } from '@/app/actions/auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { TagInfo, formatShutterSpeed } from '@/lib/image-types';
import { getLocale, getTranslations } from 'next-intl/server';
import { safeJsonLd } from '@/lib/safe-json-ld';
// AGG-R8c3-02 (run-8 c3): use the SHARED sanitizer (Unicode-format strip + C0
// control strip), not a local copy. The previous local sanitizeForOg here only
// stripped Unicode formatting (no C0 control strip) yet claimed to "match" the
// OG image route — false once AGG-R8-13 upgraded the OG route version to also
// strip C0. Importing the one og-sanitize keeps the JSON-LD path in lockstep.
import { sanitizeForOg } from '@/lib/og-sanitize';
import { buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale, localizePath, localizeUrl } from '@/lib/locale-path';
import siteConfig from "@/site-config.json";
import { getGalleryConfig } from '@/lib/gallery-config';
import { absoluteImageUrl } from '@/lib/image-url';
import { getPhotoDisplayTitle } from '@/lib/photo-title';
import { PhotoViewerLoading } from '@/components/photo-viewer-loading';
import { getCspNonce } from '@/lib/csp-nonce';
import { recordPhotoView } from '@/app/actions/public';
import { parseSafePositiveInteger } from '@/lib/validation';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';
import { getPublicRestoreMaintenanceMetadata } from '@/lib/public-restore-maintenance-metadata';

const PhotoViewer = dynamic(() => import('@/components/photo-viewer'), {
    loading: () => <PhotoViewerLoading />,
});

function toIsoTimestamp(value: string | Date | null | undefined) {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}



// Photo metadata and processed-file availability can change after background
// processing and admin edits, so render fresh instead of keeping week-long ISR.
export const revalidate = 0;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
    const maintenanceMetadata = await getPublicRestoreMaintenanceMetadata();
    if (maintenanceMetadata) return maintenanceMetadata;

    const imageId = parseSafePositiveInteger(id);
    if (imageId === null) {
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

export default async function PhotoPage({ params }: {
    params: Promise<{ id: string }>;
}) {
  const { id } = await params;
    const imageId = parseSafePositiveInteger(id);
    if (imageId === null) {
        return notFound();
    }
    if (isRestoreMaintenanceActive()) {
        const tCommon = await getTranslations('common');
        return <PublicRestoreMaintenance title={tCommon('restoreMaintenanceTitle')} body={tCommon('restoreMaintenanceBody')} />;
    }

    const [locale, t, seo, config, isAdminUser] = await Promise.all([
        getLocale(),
        getTranslations('photo'),
        getSeoSettings(),
        getGalleryConfig(),
        isAdmin(),
    ]);
    const image = await getImageForViewerCached(imageId, isAdminUser);

    if (!image) return notFound();

    // R4C8 PERF-R4C8-03: the server-rendered neighbor preload hints were
    // removed. The `type` attribute on a preload link only gates MIME
    // SUPPORT, not whether the eventual <picture> will pick that source —
    // Chromium fetched all three per-format hints (verified live), so the
    // old block triple-fetched ~1536 px files for both neighbors with
    // fetchPriority=high, competing with the CURRENT photo's bandwidth.
    // Neighbor warming is owned by the photo-viewer client effect, which
    // emits exactly ONE responsive preload per neighbor (format chosen via
    // the AVIF-support probe).

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
        // R21-M2: use the base JPEG filename for thumbnailUrl so Googlebot
        // Image always gets a 200 response. The encoder atomic-rename
        // contract guarantees the base file is on disk; the sized
        // derivative (`_${size}.jpg`) may be missing for legacy rows or
        // photos caught mid-backfill after an IMAGE_PIPELINE_VERSION
        // bump, which previously dropped the photo from Google Image
        // Search indexing during the backfill window.
        thumbnailUrl: absoluteImageUrl(`/uploads/jpeg/${image.filename_jpeg}`, seo.url),
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
        // AGG-C4-07 (run-9 c1 TRC-1): `name`/`description`/`keywords` and the
        // breadcrumb `topic_label` below are intentionally NOT wrapped in
        // sanitizeForOg, while the EXIF PropertyValues ARE. This asymmetry is
        // deliberate: (1) every value rendered here is JSON-serialized and
        // emitted via `safeJsonLd`, which escapes `</script>` and JSON-escapes
        // control chars in string values, and (2) title/description/topic.label
        // are write-time validator-gated (`containsUnicodeFormatting` rejects
        // bidi + zero-width chars on the admin string surfaces). EXIF strings
        // (camera/lens/exposure) come straight from the file's metadata and are
        // NOT validator-gated, so they get the extra sanitizeForOg pass. Do NOT
        // "fix" this by wrapping the already-gated fields.
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
                forceShowColorChips={config.forceShowColorChips}
                forceSrgbDerivatives={config.forceSrgbDerivatives}
                semanticSearchMode={config.semanticSearchMode}
            />
            {/* Keep adjacency links out of the tab order without render-time prefetch. */}
            {image.prevId && (
                <Link href={localizePath(locale, `/p/${image.prevId}`)} prefetch={false} className="hidden" aria-hidden="true" tabIndex={-1}>
                    prev
                </Link>
            )}
            {image.nextId && (
                <Link href={localizePath(locale, `/p/${image.nextId}`)} prefetch={false} className="hidden" aria-hidden="true" tabIndex={-1}>
                    next
                </Link>
            )}
        </>
    );
}
