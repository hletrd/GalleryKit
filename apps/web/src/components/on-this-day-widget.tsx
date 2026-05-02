import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';
import { getOnThisDayImages } from '@/lib/data-timeline';
import { imageUrl } from '@/lib/image-url';
import { localizePath } from '@/lib/locale-path';
import { getConcisePhotoAltText, getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';
import { getGalleryConfig } from '@/lib/gallery-config';

/**
 * Server component — rendered as part of the home page SSR pass.
 * Shows up to 6 photos whose capture_date matches today's MM-DD
 * across all years. Photos with NULL capture_date are excluded.
 */
export async function OnThisDayWidget() {
    const now = new Date();
    const month = now.getMonth() + 1; // 1–12
    const day = now.getDate();        // 1–31

    const [t, locale, photos, config] = await Promise.all([
        getTranslations('onThisDay'),
        getLocale(),
        getOnThisDayImages(month, day),
        getGalleryConfig(),
    ]);

    if (photos.length === 0) return null;

    const smallSize = findNearestImageSize(config.imageSizes ?? DEFAULT_IMAGE_SIZES, 640);

    return (
        <aside aria-label={t('widgetLabel')}>
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-semibold">{t('title')}</h2>
                <Link
                    href={localizePath(locale, '/timeline')}
                    className="text-xs text-muted-foreground hover:text-primary transition-colors min-h-[44px] flex items-center"
                >
                    {t('viewTimeline')}
                </Link>
            </div>
            <ul className="space-y-2" role="list">
                {photos.map((photo) => {
                    const displayTitle = getPhotoDisplayTitleFromTagNames(photo, t('untitledPhoto'));
                    const altText = getConcisePhotoAltText(photo, t('photo'));
                    const year = photo.capture_date
                        ? new Date(photo.capture_date).getFullYear()
                        : null;
                    const baseJpeg = photo.filename_jpeg.replace(/\.jpg$/i, '');

                    return (
                        <li key={photo.id}>
                            <Link
                                href={localizePath(locale, `/p/${photo.id}`)}
                                className="flex items-center gap-3 group min-h-[44px]"
                                aria-label={t('viewPhotoAria', { title: displayTitle })}
                            >
                                {/* Thumbnail */}
                                <div
                                    className="flex-shrink-0 rounded-md overflow-hidden bg-muted"
                                    style={{ width: 48, height: 48 }}
                                >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={imageUrl(`/uploads/jpeg/${baseJpeg}_${smallSize}.jpg`)}
                                        alt={altText}
                                        width={48}
                                        height={48}
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
