'use client';

import { memo } from 'react';
import Link from 'next/link';
import { GridPicture } from '@/components/grid-picture';
import { OptimisticImage } from './optimistic-image';
import { useTranslation } from '@/components/i18n-provider';
import { cn } from '@/lib/utils';
import { imageUrl, sizedImageUrl } from '@/lib/image-url';
import { localizePath } from '@/lib/locale-path';
import { findNearestImageSize } from '@/lib/gallery-config-shared';
import { getConcisePhotoAltText, getPhotoDisplayTitleFromTagNames } from '@/lib/photo-title';
import { isWideGamutPrimary } from '@/lib/color-primaries';
import type { GalleryImage } from './home-client';

// C2-19 (run-10 c2): extracted from home-client.tsx's inline orderedImages.map
// so per-card work (title/alt derivation, isWideGamutPrimary, srcset strings)
// only re-runs for cards whose OWN props changed, instead of for every loaded
// card on every allImages append (infinite scroll), viewport-bucket change, or
// unrelated parent state flip (e.g. showBackToTop).
const MASONRY_SIZES = "(min-width: 1536px) 20vw, (max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw";

interface MasonryCardProps {
    image: GalleryImage;
    // DES-R5C3-04-derived estimate of the rendered card width; changes when
    // the viewport/column-count bucket changes (must force a re-render).
    estimatedCardWidth: number;
    // Only the first DOM card is a universal visual leader in balanced CSS
    // columns, so it alone owns explicit eager/high scheduling.
    isPriority: boolean;
    // Pre-resolved (image.topic && topicsMap[image.topic]) || image.topic so
    // the card doesn't need the whole topicsMap object as a prop.
    topicLabel?: string;
    imageSizes: number[];
    // C2-19: stable useCallback from the parent (keyed only on scrollKey) so
    // its identity never breaks memoization across unrelated re-renders.
    onLinkClick: () => void;
}

function MasonryCardImpl({ image, estimatedCardWidth, isPriority, topicLabel, imageSizes, onLinkClick }: MasonryCardProps) {
    const { t, locale } = useTranslation();

    // F-5 / F-18 / AGG1L-LOW-01: underscore normalization is now baked into
    // getPhotoDisplayTitleFromTagNames and getConcisePhotoAltText via the
    // shared humanizeTagLabel helper, so the card title and the alt text
    // agree without any inline post-processing.
    const displayTitle = getPhotoDisplayTitleFromTagNames(image, image.user_filename || t('common.untitled'));
    const altText = getConcisePhotoAltText(image, t('common.photo'));
    const accessibleTitle = `${displayTitle} #${image.id}`;

    // AGG-R8-08 (run-8 c2): guard the width/height denominators. image.width/
    // height are NOT NULL from validated Sharp metadata so a 0 is
    // near-impossible, but an unguarded `/ image.width` emits "auto
    // Infinitypx" (and "0 / 0" aspect-ratio) — invalid CSS that browsers
    // silently drop, losing the CLS reservation for that card. Fall back to
    // a 1:1 square reservation when either dimension is non-positive.
    const hasValidDims = image.width > 0 && image.height > 0;
    const cardAspectRatio = hasValidDims ? `${image.width} / ${image.height}` : '1 / 1';
    const cardIntrinsicHeight = hasValidDims
        ? Math.round(estimatedCardWidth * image.height / image.width)
        : Math.round(estimatedCardWidth);
    const isWideGamut = isWideGamutPrimary(image.color_primaries);
    const photoAriaLabel = isWideGamut
        ? `${t('aria.viewPhoto', { title: accessibleTitle })} (${t('viewer.gamutBadgeP3')})`
        : t('aria.viewPhoto', { title: accessibleTitle });

    return (
        <div
            className={cn(
                "masonry-card break-inside-avoid relative group overflow-hidden rounded-xl bg-muted/20 [mask-image:radial-gradient(white,black)] focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 mb-4 w-full"
            )}
            style={{
                aspectRatio: cardAspectRatio,
                backgroundColor: 'hsl(var(--muted))',
                containIntrinsicSize: `auto ${cardIntrinsicHeight}px`,
            }}
        >
            <Link
                href={localizePath(locale, `/p/${image.id}`)}
                prefetch={false}
                aria-label={photoAriaLabel}
                onClick={onLinkClick}
            >
                <div className="relative w-full">
                        {(() => {
                            const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
                            const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');

                            if (baseWebp && baseAvif) {
                                // Use the two smallest configured sizes for masonry grid thumbnails
                                const smallSize = imageSizes.length >= 2 ? imageSizes[0] : findNearestImageSize(imageSizes, 640);
                                const mediumSize = imageSizes.length >= 2 ? imageSizes[1] : findNearestImageSize(imageSizes, 1536);
                                return (
                                    <GridPicture
                                        sources={[
                                            {
                                                type: 'image/avif',
                                                srcSet: `${imageUrl(`/uploads/avif/${baseAvif}_${smallSize}.avif`)} ${smallSize}w, ${imageUrl(`/uploads/avif/${baseAvif}_${mediumSize}.avif`)} ${mediumSize}w`,
                                                sizes: MASONRY_SIZES,
                                            },
                                            {
                                                type: 'image/webp',
                                                srcSet: `${imageUrl(`/uploads/webp/${baseWebp}_${smallSize}.webp`)} ${smallSize}w, ${imageUrl(`/uploads/webp/${baseWebp}_${mediumSize}.webp`)} ${mediumSize}w`,
                                                sizes: MASONRY_SIZES,
                                            },
                                            {
                                                type: 'image/jpeg',
                                                srcSet: `${sizedImageUrl('/uploads/jpeg', image.filename_jpeg, smallSize, imageSizes)} ${smallSize}w, ${sizedImageUrl('/uploads/jpeg', image.filename_jpeg, mediumSize, imageSizes)} ${mediumSize}w`,
                                                sizes: MASONRY_SIZES,
                                            },
                                        ]}
                                        src={sizedImageUrl('/uploads/jpeg', image.filename_jpeg, smallSize, imageSizes)}
                                        fallbackSrc={imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)}
                                        alt={altText}
                                        width={image.width}
                                        height={image.height}
                                        className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                        loading={isPriority ? "eager" : "lazy"}
                                        decoding="async"
                                        fetchPriority={isPriority ? "high" : "auto"}
                                    />
                                );
                            }

                            return (
                                <OptimisticImage
                                    src={imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)}
                                    alt={altText}
                                    width={image.width}
                                    height={image.height}
                                    className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                    sizes={MASONRY_SIZES}
                                    blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                                    placeholder="blur"
                                    // R16-L3: parity with the primary <img> path above so
                                    // legacy photos (no sized derivative) don't block the main
                                    // thread during masonry scroll. next/image forwards the
                                    // attribute through to the underlying <img>.
                                    decoding="async"
                                    loading={isPriority ? "eager" : "lazy"}
                                    fetchPriority={isPriority ? "high" : "auto"}
                                />
                            );
                        })()}
                    {/* R10-H5: subtle gamut badge for wide-gamut photos, gated by display capability */}
                    {isWideGamut && (
                        <div className="absolute top-2 right-2 z-10">
                            <span
                                className="gamut-p3-badge inline-flex items-center justify-center min-h-11 min-w-11 px-2 py-1 text-[10px] font-bold bg-purple-200/90 text-purple-900 dark:bg-purple-900/60 dark:text-purple-200 rounded-full backdrop-blur-sm"
                                aria-label={t('viewer.gamutBadgeP3')}
                                title={t('viewer.gamutBadgeP3')}
                            >
                                <span aria-hidden="true">P3</span>
                            </span>
                        </div>
                    )}
                    <div className="absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/75 to-transparent p-3">
                        <h3 className="text-white text-sm font-medium truncate">{displayTitle}</h3>
                        <p className="text-white/80 text-xs truncate">
                            {topicLabel}
                        </p>
                    </div>
                    <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/70 to-transparent p-4 sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-300">
                        <h3 className="text-white font-medium truncate">
                            {displayTitle}
                        </h3>
                        <p className="text-white/80 text-xs truncate">{topicLabel}</p>
                    </div>
                </div>
            </Link>
        </div>
    );
}

// C2-19 (run-10 c2): React.memo with the default shallow-props comparator —
// image keeps referential identity across allImages appends (home-client's
// setAllImages(prev => [...prev, ...newImages]) spreads, never clones,
// existing entries), estimatedCardWidth/isPriority/topicLabel/imageSizes are
// primitives or parent-stable references, and onLinkClick is a useCallback
// keyed only on scrollKey. So an append, a viewport-bucket change that
// doesn't affect this card, or an unrelated state flip (showBackToTop) all
// bail out here instead of re-running title/alt/srcset derivation.
export const MasonryCard = memo(MasonryCardImpl);
