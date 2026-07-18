import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { getYearInReviewImages } from '@/lib/data-timeline';
import { getSeoSettings } from '@/lib/data';
import { localizePath, localizeUrl, buildHreflangAlternates, getAlternateOpenGraphLocales, getOpenGraphLocale } from '@/lib/locale-path';
import { imageUrl, absoluteImageUrl, sizedImageSrcSet, sizedImageUrl } from '@/lib/image-url';
import { getConcisePhotoAltText, getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';
import { getGalleryConfig } from '@/lib/gallery-config';
import { getCspNonce } from '@/lib/csp-nonce';
import { safeJsonLd } from '@/lib/safe-json-ld';
import { GridPicture } from '@/components/grid-picture';
import { GridPictureFallbackBoundary } from '@/components/grid-picture-fallback-boundary';
import type { Metadata } from 'next';
import { isRestoreMaintenanceActive } from '@/lib/restore-maintenance';
import { PublicRestoreMaintenance } from '@/components/public-restore-maintenance';
import { getPublicRestoreMaintenanceMetadata } from '@/lib/public-restore-maintenance-metadata';
import { ARCHIVE_MASONRY_SIZES } from '@/lib/responsive-masonry';

export const revalidate = 0;

export async function generateMetadata({
    params,
}: {
    params: Promise<{ year: string }>;
}): Promise<Metadata> {
    const { year: yearParam } = await params;
    const maintenanceMetadata = await getPublicRestoreMaintenanceMetadata();
    if (maintenanceMetadata) return maintenanceMetadata;

    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('timeline'),
        getSeoSettings(),
    ]);
    const yearNum = Number(yearParam);
    if (!Number.isInteger(yearNum) || yearNum < 1 || yearNum > 9999) {
        // C2-04 (UX-03, run-10 c2): notFound() here yields a real HTTP 404 —
        // the page body's notFound() fires after the streamed 200 shell
        // (see the p/[id] generateMetadata note for the full mechanism).
        notFound();
    }

    const pageUrl = localizeUrl(seo.url, locale, `/year/${yearNum}`);
    const openGraphLocale = getOpenGraphLocale(locale, seo.locale);
    const alternateLanguages = buildHreflangAlternates(seo.url, `/year/${yearNum}`);
    const title = t('yearInReview', { year: yearNum });
    const description = t('yearInReviewDescription', { year: yearNum });
    const ogImages = seo.og_image_url
        ? [{ url: seo.og_image_url, width: 1200, height: 630, alt: t('yearInReview', { year: yearNum }) }]
        : undefined;

    return {
        title,
        description,
        alternates: { canonical: pageUrl, languages: alternateLanguages },
        openGraph: {
            title,
            description,
            url: pageUrl,
            siteName: seo.title,
            locale: openGraphLocale,
            alternateLocale: getAlternateOpenGraphLocales(locale, seo.locale),
            type: 'website',
            ...(ogImages ? { images: ogImages } : {}),
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
            ...(ogImages ? { images: ogImages.map((image) => image.url) } : {}),
        },
    };
}

export default async function YearInReviewPage({
    params,
}: {
    params: Promise<{ year: string }>;
}) {
    const { year: yearParam } = await params;
    const yearNum = Number(yearParam);

    if (!Number.isInteger(yearNum) || yearNum < 1 || yearNum > 9999) {
        return notFound();
    }
    if (isRestoreMaintenanceActive()) {
        const tCommon = await getTranslations('common');
        return <PublicRestoreMaintenance title={tCommon('restoreMaintenanceTitle')} body={tCommon('restoreMaintenanceBody')} />;
    }

    const [locale, t, tCommon, tAria, yearInReview, config, seo, nonce] = await Promise.all([
        getLocale(),
        getTranslations('timeline'),
        getTranslations('common'),
        getTranslations('aria'),
        getYearInReviewImages(yearNum),
        getGalleryConfig(),
        getSeoSettings(),
        getCspNonce(),
    ]);
    // R4C6 COR-R4C6-02: truncation is surfaced, never silent.
    const { sections: monthSections, truncated } = yearInReview;

    const imageSizes = config.imageSizes ?? DEFAULT_IMAGE_SIZES;
    const smallSize = findNearestImageSize(imageSizes, 640);

    // R19-L4: schema.org/ImageGallery JSON-LD. Mirrors the timeline /
    // topic / smart-collection pattern. Emitted only when at least one
    // month section has photos.
    const galleryPhotos = monthSections.flatMap((s) => s.images);
    const galleryLd = galleryPhotos.length > 0 ? {
        '@context': 'https://schema.org',
        '@type': 'ImageGallery',
        name: `${t('yearInReview', { year: yearNum })} | ${seo.title}`,
        url: localizeUrl(seo.url, locale, `/year/${yearNum}`),
        image: galleryPhotos.slice(0, 10).map((img) => ({
            '@type': 'ImageObject',
            contentUrl: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, seo.url),
            // R21-M2: base JPEG filename for JSON-LD thumbnail so
            // Googlebot Image always gets a 200 response (sized
            // derivative can 404 for legacy / mid-backfill rows).
            thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, seo.url),
            name: getPhotoDisplayTitleFromTagNames(img, `${tCommon('photo')} ${img.id}`),
        })),
    } : null;
    const galleryLdJson = galleryLd ? safeJsonLd(galleryLd) : null;
    // CSS column breaks are browser-owned and data-dependent. Only the first
    // DOM photo is guaranteed to be a visual column leader.
    const eagerArchiveImageIds = new Set(galleryPhotos.slice(0, 1).map((photo) => photo.id));

    return (
        <div className="space-y-6">
            {galleryLdJson && (
                <script
                    type="application/ld+json"
                    nonce={nonce}
                    // Pattern mirrors apps/web/src/app/[locale]/(public)/[topic]/page.tsx:204-210
                    // for project-consistent JSON-LD injection through safeJsonLd.
                    {...{ dangerouslySetInnerHTML: { __html: galleryLdJson } }}
                />
            )}
            {/* Back link + heading */}
            <div className="space-y-1">
                <Link
                    href={localizePath(locale, `/timeline?year=${yearNum}`)}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1 min-h-11 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                    {t('backToTimeline')}
                </Link>
                <h1 className="text-3xl font-bold tracking-tight">
                    {t('yearInReview', { year: yearNum })}
                </h1>
                <p className="text-muted-foreground">{t('yearInReviewDescription', { year: yearNum })}</p>
            </div>

            {/* R4C6 COR-R4C6-02: visible truncation notice — the year-in-review
                must never silently misrepresent the archive's shape. */}
            {truncated && (
                <p role="note" className="text-sm text-muted-foreground border rounded-lg px-4 py-3 bg-muted/40">
                    {t('truncationNotice', { count: galleryPhotos.length, year: yearNum })}
                </p>
            )}

            {monthSections.length === 0 ? (
                <p className="text-muted-foreground">{t('noPhotosForYear', { year: yearNum })}</p>
            ) : (
                <div className="space-y-10">
                    {monthSections.map(({ month, images: monthPhotos }) => {
                        const monthName = t(`months.${month}` as Parameters<typeof t>[0]);

                        return (
                            <section key={month} aria-labelledby={`month-section-${month}`}>
                                <h2
                                    id={`month-section-${month}`}
                                    className="text-xl font-semibold mb-4 pb-2 border-b"
                                >
                                    {monthName}
                                    {' · '}
                                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                                        {t('photosCount', { count: monthPhotos.length })}
                                    </span>
                                </h2>

                                <GridPictureFallbackBoundary className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5 gap-4 space-y-4">
                                    {monthPhotos.map((photo) => {
                                        const shouldEagerLoad = eagerArchiveImageIds.has(photo.id);
                                        const displayTitle = getPhotoDisplayTitleFromTagNames(photo, tCommon('untitled'));
                                        const accessibleTitle = `${displayTitle} #${photo.id}`;
                                        const altText = getConcisePhotoAltText(photo, tCommon('photo'));
                                        const aspectRatio = photo.width > 0 && photo.height > 0
                                            ? `${photo.width} / ${photo.height}`
                                            : '1 / 1';

                                        return (
                                            <div
                                                key={photo.id}
                                                className="break-inside-avoid relative group overflow-hidden rounded-xl bg-muted/20 [mask-image:radial-gradient(white,black)] focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2"
                                                style={{
                                                    aspectRatio,
                                                    backgroundColor: 'hsl(var(--muted))',
                                                }}
                                            >
                                                <Link
                                                    href={localizePath(locale, `/p/${photo.id}`)}
                                                    prefetch={false}
                                                    aria-label={tAria('viewPhoto', { title: accessibleTitle })}
                                                >
                                                    <div className="relative w-full">
                                                        <GridPicture
                                                            sources={[
                                                                {
                                                                    type: 'image/avif',
                                                                    srcSet: sizedImageSrcSet('/uploads/avif', photo.filename_avif, imageSizes),
                                                                    sizes: ARCHIVE_MASONRY_SIZES,
                                                                },
                                                                {
                                                                    type: 'image/webp',
                                                                    srcSet: sizedImageSrcSet('/uploads/webp', photo.filename_webp, imageSizes),
                                                                    sizes: ARCHIVE_MASONRY_SIZES,
                                                                },
                                                                {
                                                                    type: 'image/jpeg',
                                                                    srcSet: sizedImageSrcSet('/uploads/jpeg', photo.filename_jpeg, imageSizes),
                                                                    sizes: ARCHIVE_MASONRY_SIZES,
                                                                },
                                                            ]}
                                                            src={sizedImageUrl('/uploads/jpeg', photo.filename_jpeg, smallSize, imageSizes)}
                                                            fallbackSrc={imageUrl(`/uploads/jpeg/${photo.filename_jpeg}`)}
                                                            alt={altText}
                                                            width={photo.width}
                                                            height={photo.height}
                                                            className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                            loading={shouldEagerLoad ? 'eager' : 'lazy'}
                                                            fetchPriority={shouldEagerLoad ? 'high' : undefined}
                                                            decoding="async"
                                                        />
                                                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 sm:p-4 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-300">
                                                            <h3 className="text-white text-sm sm:text-base font-medium truncate">{displayTitle}</h3>
                                                        </div>
                                                    </div>
                                                </Link>
                                            </div>
                                        );
                                    })}
                                </GridPictureFallbackBoundary>
                            </section>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
