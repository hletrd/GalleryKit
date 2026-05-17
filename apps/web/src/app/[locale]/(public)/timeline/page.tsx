import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';
import { getTimelineYears, getTimelineImages } from '@/lib/data-timeline';
import { getSeoSettings } from '@/lib/data';
import { localizePath, localizeUrl, buildHreflangAlternates } from '@/lib/locale-path';
import { imageUrl, absoluteImageUrl } from '@/lib/image-url';
import { getConcisePhotoAltText, getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';
import { getGalleryConfig } from '@/lib/gallery-config';
import { getCspNonce } from '@/lib/csp-nonce';
import { safeJsonLd } from '@/lib/safe-json-ld';
import type { Metadata } from 'next';

export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('timeline'),
        getSeoSettings(),
    ]);

    const pageUrl = localizeUrl(seo.url, locale, '/timeline');
    const alternateLanguages = buildHreflangAlternates(seo.url, '/timeline');

    return {
        title: `${t('title')} | ${seo.title}`,
        description: t('description'),
        alternates: { canonical: pageUrl, languages: alternateLanguages },
    };
}

export default async function TimelinePage({
    searchParams,
}: {
    searchParams: Promise<{ year?: string }>;
}) {
    const { year: yearParam } = await searchParams;

    const [locale, t, years, config, seo, nonce] = await Promise.all([
        getLocale(),
        getTranslations('timeline'),
        getTimelineYears(),
        getGalleryConfig(),
        getSeoSettings(),
        getCspNonce(),
    ]);

    // Validate year param
    const selectedYear =
        yearParam && /^\d{4}$/.test(yearParam)
            ? Number(yearParam)
            : years[0] ?? null;

    const photos =
        selectedYear !== null
            ? await getTimelineImages(selectedYear)
            : [];

    const imageSizes = config.imageSizes ?? DEFAULT_IMAGE_SIZES;
    const smallSize = findNearestImageSize(imageSizes, 640);

    // Group photos by month for display
    const byMonth = new Map<number, typeof photos>();
    for (const photo of photos) {
        if (!photo.capture_date) continue;
        const m = new Date(photo.capture_date).getMonth() + 1;
        if (!Number.isFinite(m) || m < 1 || m > 12) continue;
        const bucket = byMonth.get(m) ?? [];
        bucket.push(photo);
        byMonth.set(m, bucket);
    }
    const sortedMonths = [...byMonth.keys()].sort((a, b) => b - a);

    // R19-L4: emit schema.org/ImageGallery JSON-LD so Google's image-search
    // surface treats the timeline as a gallery rich-result candidate. Mirrors
    // the homepage / topic / smart-collection pattern. Only emitted when the
    // page actually has photos to list.
    const galleryPhotos = sortedMonths.flatMap((month) => byMonth.get(month) ?? []);
    const galleryUrl = selectedYear !== null
        ? localizeUrl(seo.url, locale, `/timeline?year=${selectedYear}`)
        : localizeUrl(seo.url, locale, '/timeline');
    const galleryLd = galleryPhotos.length > 0 ? {
        '@context': 'https://schema.org',
        '@type': 'ImageGallery',
        name: selectedYear !== null
            ? `${t('yearInReview', { year: selectedYear })} | ${seo.title}`
            : `${t('title')} | ${seo.title}`,
        url: galleryUrl,
        image: galleryPhotos.slice(0, 10).map((img) => ({
            '@type': 'ImageObject',
            contentUrl: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, seo.url),
            // R21-M2: base JPEG filename for JSON-LD thumbnail so
            // Googlebot Image always gets a 200 response (sized
            // derivative can 404 for legacy / mid-backfill rows).
            thumbnail: absoluteImageUrl(`/uploads/jpeg/${img.filename_jpeg}`, seo.url),
            name: getPhotoDisplayTitleFromTagNames(img, `Photo ${img.id}`),
        })),
    } : null;
    const galleryLdJson = galleryLd ? safeJsonLd(galleryLd) : null;

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
            {/* Page heading */}
            <div>
                <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
                <p className="text-muted-foreground mt-1">{t('description')}</p>
            </div>

            {years.length === 0 ? (
                <p className="text-muted-foreground">{t('noPhotos')}</p>
            ) : (
                <>
                    {/* Year scrubber */}
                    <nav aria-label={t('yearScrubberLabel')}>
                        <div className="flex flex-wrap gap-2">
                            {years.map((year) => {
                                const isActive = year === selectedYear;
                                return (
                                    <Link
                                        key={year}
                                        href={localizePath(locale, `/timeline?year=${year}`)}
                                        className={
                                            `h-11 min-w-[44px] px-4 inline-flex items-center justify-center rounded-lg text-sm font-medium transition-colors ` +
                                            (isActive
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-muted hover:bg-muted/80 text-foreground')
                                        }
                                        aria-current={isActive ? 'page' : undefined}
                                    >
                                        {year}
                                    </Link>
                                );
                            })}
                        </div>
                    </nav>

                    {/* Year-in-review link */}
                    {selectedYear !== null && (
                        <div className="flex items-center gap-4">
                            <Link
                                href={localizePath(locale, `/year/${selectedYear}`)}
                                className="text-sm text-muted-foreground hover:text-primary transition-colors underline underline-offset-4"
                            >
                                {t('yearInReview', { year: selectedYear })}
                            </Link>
                        </div>
                    )}

                    {/* Photos grouped by month */}
                    {sortedMonths.length === 0 && selectedYear !== null && (
                        <p className="text-muted-foreground">{t('noPhotosForYear', { year: selectedYear })}</p>
                    )}

                    {sortedMonths.map((month) => {
                        const monthPhotos = byMonth.get(month) ?? [];
                        const monthName = t(`months.${month}` as Parameters<typeof t>[0]);

                        return (
                            <section key={month} aria-labelledby={`month-${month}`}>
                                <h2
                                    id={`month-${month}`}
                                    className="text-xl font-semibold mb-3 sticky top-0 bg-background/90 backdrop-blur-sm py-2 z-10"
                                >
                                    {t('monthHeading', { month: monthName, year: selectedYear ?? '' })}
                                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                                        {t('photosCount', { count: monthPhotos.length })}
                                    </span>
                                </h2>

                                <div className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5 gap-4 space-y-4">
                                    {monthPhotos.map((photo) => {
                                        const displayTitle = getPhotoDisplayTitleFromTagNames(photo, 'Photo');
                                        const altText = getConcisePhotoAltText(photo, 'Photo');
                                        const baseAvif = photo.filename_avif.replace(/\.avif$/i, '');
                                        const baseWebp = photo.filename_webp.replace(/\.webp$/i, '');
                                        const mediumSize = imageSizes.length >= 2
                                            ? imageSizes[1]
                                            : findNearestImageSize(imageSizes, 1536);

                                        return (
                                            <div
                                                key={photo.id}
                                                className="break-inside-avoid relative group overflow-hidden rounded-xl bg-muted/20 [mask-image:radial-gradient(white,black)] focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2"
                                                style={{
                                                    aspectRatio: `${photo.width} / ${photo.height}`,
                                                    backgroundColor: 'hsl(var(--muted))',
                                                }}
                                            >
                                                <Link
                                                    href={localizePath(locale, `/p/${photo.id}`)}
                                                    aria-label={displayTitle}
                                                >
                                                    <div className="relative w-full">
                                                        <picture>
                                                            <source
                                                                type="image/avif"
                                                                srcSet={`${imageUrl(`/uploads/avif/${baseAvif}_${smallSize}.avif`)} ${smallSize}w, ${imageUrl(`/uploads/avif/${baseAvif}_${mediumSize}.avif`)} ${mediumSize}w`}
                                                                sizes="(min-width: 1536px) 20vw, (max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                            />
                                                            <source
                                                                type="image/webp"
                                                                srcSet={`${imageUrl(`/uploads/webp/${baseWebp}_${smallSize}.webp`)} ${smallSize}w, ${imageUrl(`/uploads/webp/${baseWebp}_${mediumSize}.webp`)} ${mediumSize}w`}
                                                                sizes="(min-width: 1536px) 20vw, (max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                            />
                                                            {/* R19-M2: use the base JPEG filename for the
                                                                <picture> fallback rather than the sized derivative.
                                                                The base file always exists per the encoder
                                                                atomic-rename contract, so legacy / mid-backfill rows
                                                                whose `_${smallSize}.jpg` derivative is missing render
                                                                cleanly instead of producing a broken-tile glyph.
                                                                Modern browsers prefer the AVIF/WebP `<source>` rows
                                                                via srcset, so this fallback adds no extra bytes. */}
                                                            <img
                                                                src={imageUrl(`/uploads/jpeg/${photo.filename_jpeg}`)}
                                                                alt={altText}
                                                                width={photo.width}
                                                                height={photo.height}
                                                                className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                                loading="lazy"
                                                                decoding="async"
                                                            />
                                                        </picture>
                                                        <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/60 to-transparent p-4 sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-300">
                                                            <h3 className="text-white font-medium truncate">{displayTitle}</h3>
                                                        </div>
                                                    </div>
                                                </Link>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </>
            )}
        </div>
    );
}
