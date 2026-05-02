import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, getLocale } from 'next-intl/server';
import { getYearInReviewImages } from '@/lib/data-timeline';
import { getSeoSettings } from '@/lib/data';
import { localizePath, localizeUrl, buildHreflangAlternates } from '@/lib/locale-path';
import { imageUrl } from '@/lib/image-url';
import { getConcisePhotoAltText, getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';
import { getGalleryConfig } from '@/lib/gallery-config';
import type { Metadata } from 'next';

export const revalidate = 0;

export async function generateMetadata({
    params,
}: {
    params: Promise<{ year: string }>;
}): Promise<Metadata> {
    const { year: yearParam } = await params;
    const yearNum = Number(yearParam);
    if (!Number.isInteger(yearNum) || yearNum < 1 || yearNum > 9999) {
        return { title: 'Not Found', robots: { index: false, follow: false } };
    }

    const [locale, t, seo] = await Promise.all([
        getLocale(),
        getTranslations('timeline'),
        getSeoSettings(),
    ]);

    const pageUrl = localizeUrl(seo.url, locale, `/year/${yearNum}`);
    const alternateLanguages = buildHreflangAlternates(seo.url, `/year/${yearNum}`);

    return {
        title: `${t('yearInReview', { year: yearNum })} | ${seo.title}`,
        description: t('yearInReviewDescription', { year: yearNum }),
        alternates: { canonical: pageUrl, languages: alternateLanguages },
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

    const [locale, t, monthSections, config] = await Promise.all([
        getLocale(),
        getTranslations('timeline'),
        getYearInReviewImages(yearNum),
        getGalleryConfig(),
    ]);

    const imageSizes = config.imageSizes ?? DEFAULT_IMAGE_SIZES;
    const smallSize = findNearestImageSize(imageSizes, 640);
    const mediumSize = imageSizes.length >= 2
        ? imageSizes[1]
        : findNearestImageSize(imageSizes, 1536);

    return (
        <div className="space-y-6">
            {/* Back link + heading */}
            <div className="space-y-1">
                <Link
                    href={localizePath(locale, `/timeline?year=${yearNum}`)}
                    className="text-sm text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
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
                                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                                        {t('photosCount', { count: monthPhotos.length })}
                                    </span>
                                </h2>

                                <div className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5 gap-4 space-y-4">
                                    {monthPhotos.map((photo) => {
                                        const displayTitle = getPhotoDisplayTitleFromTagNames(photo, monthName);
                                        const altText = getConcisePhotoAltText(photo, 'Photo');
                                        const baseAvif = photo.filename_avif.replace(/\.avif$/i, '');
                                        const baseWebp = photo.filename_webp.replace(/\.webp$/i, '');

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
                                                            <img
                                                                src={imageUrl(`/uploads/jpeg/${photo.filename_jpeg.replace(/\.jpg$/i, `_${smallSize}.jpg`)}`)}
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
                </div>
            )}
        </div>
    );
}
