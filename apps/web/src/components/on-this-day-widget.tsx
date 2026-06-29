import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';
import { getOnThisDayImages } from '@/lib/data-timeline';
import { imageUrl } from '@/lib/image-url';
import { localizePath } from '@/lib/locale-path';
import { getConcisePhotoAltText, getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { OptimisticImage } from '@/components/optimistic-image';
import { getLocalMonthDay } from '@/lib/on-this-day-date';

/**
 * Server component — rendered as part of the home page SSR pass.
 * Shows up to 6 photos whose capture_date matches today's MM-DD
 * across all years. Photos with NULL capture_date are excluded.
 */
export async function OnThisDayWidget() {
    const { month, day } = getLocalMonthDay();

    const [t, locale, photos] = await Promise.all([
        getTranslations('onThisDay'),
        getLocale(),
        getOnThisDayImages(month, day),
    ]);

    if (photos.length === 0) return null;

    // R20-M2 / R4C9 PERF-R4C9-03: the SOURCE stays the base JPEG filename
    // (the encoder atomic-rename contract guarantees it exists even for
    // legacy / mid-backfill rows that lack `_${size}.jpg` variants), but it
    // is now delivered through next/image — the optimizer serves a ~48-96 px
    // variant instead of the full multi-MB derivative the previous raw
    // <img> shipped for a 48 px box. Same pattern as the masonry grid's
    // OptimisticImage fallback path in home-client.tsx; the client island
    // also provides the loading / retry / error states.

    return (
        <aside aria-label={t('widgetLabel')} className="border-t pt-8">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold">{t('title')}</h2>
                <Link
                    href={localizePath(locale, '/timeline')}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors min-h-[44px] flex items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                    {t('viewTimeline')}
                </Link>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6" role="list">
                {photos.map((photo) => {
                    const displayTitle = getPhotoDisplayTitleFromTagNames(photo, t('untitledPhoto'));
                    const altText = getConcisePhotoAltText(photo, t('photo'));
                    const year = photo.capture_date
                        ? new Date(photo.capture_date).getFullYear()
                        : null;
                    return (
                        <li key={photo.id}>
                            <Link
                                href={localizePath(locale, `/p/${photo.id}`)}
                                className="flex items-center gap-3 group min-h-[44px] rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                aria-label={t('viewPhotoAria', { title: displayTitle })}
                            >
                                {/* Thumbnail */}
                                <div
                                    className="flex-shrink-0 rounded-md overflow-hidden bg-muted"
                                    style={{ width: 48, height: 48 }}
                                >
                                    <OptimisticImage
                                        src={imageUrl(`/uploads/jpeg/${photo.filename_jpeg}`)}
                                        alt={altText}
                                        width={48}
                                        height={48}
                                        sizes="48px"
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        loading="lazy"
                                        decoding="async"
                                    />
                                </div>
                                {/* Title + year */}
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                                        {displayTitle}
                                    </p>
                                    {year !== null && (
                                        <p className="text-xs text-muted-foreground">
                                            {t('yearLabel', { year })}
                                        </p>
                                    )}
                                </div>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </aside>
    );
}
