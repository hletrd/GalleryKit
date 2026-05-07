'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { TagFilter } from '@/components/tag-filter';
import { useTranslation } from "@/components/i18n-provider";
import { OptimisticImage } from './optimistic-image';
import { LoadMore } from '@/components/load-more';
import { cn } from '@/lib/utils';
import { imageUrl } from '@/lib/image-url';
import { HDR_FEATURE_ENABLED } from '@/lib/feature-flags';
import { localizePath } from '@/lib/locale-path';
import type { ImageListCursorInput } from '@/lib/data';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize } from '@/lib/gallery-config-shared';
import { getConcisePhotoAltText, getPhotoDisplayTitleFromTagNames, humanizeTagLabel } from '@/lib/photo-title';

const SCROLL_STORAGE_PREFIX = 'gallery_scroll:';

function useColumnCount() {
    const [count, setCount] = useState(2);

    useEffect(() => {
        let rafId: number | null = null;
        // AGG1L-LOW-02 / plan-301-B: thresholds mirror the Tailwind
        // breakpoints used in the masonry container's class string
        // (`columns-1 sm:columns-2 md:columns-3 xl:columns-4 2xl:columns-5`),
        // so the above-the-fold image priority logic stays in sync with
        // the actual column count rendered by the browser. Without this
        // mirror, a 5-column 2xl viewport would only flag the first 4
        // images as `loading="eager"` / `fetchPriority="high"` and the
        // 5th slot would lazy-load (LCP regression).
        const update = () => {
            const w = window.innerWidth;
            if (w < 640) setCount(1);
            else if (w < 768) setCount(2);
            else if (w < 1280) setCount(3);
            else if (w < 1536) setCount(4);
            else setCount(5);
        };
        const handleResize = () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                update();
                rafId = null;
            });
        };
        update();
        window.addEventListener('resize', handleResize);
        return () => {
            window.removeEventListener('resize', handleResize);
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, []);

    return count;
}

interface GalleryImage {
    id: number;
    capture_date: string | null;
    created_at: string | Date;
    filename_avif: string;
    filename_webp: string;
    filename_jpeg: string;
    width: number;
    height: number;
    title: string | null;
    description: string | null;
    tag_names?: string | null;
    topic?: string;
    user_filename?: string | null;
    is_hdr?: boolean | null;
}

interface GalleryTag {
    id: number;
    name: string;
    slug: string;
    count: number;
}

interface GalleryTopic {
    slug: string;
    label: string;
}


function getClientImageListCursor(image: Pick<ImageListCursorInput, 'capture_date' | 'created_at' | 'id'> | null | undefined): ImageListCursorInput | null {
    if (!image) return null;
    return {
        id: image.id,
        capture_date: image.capture_date ?? null,
        created_at: image.created_at,
    };
}

interface HomeClientProps {
    images: GalleryImage[];
    tags: GalleryTag[];
    topics?: GalleryTopic[];
    currentTags?: string[];
    topicSlug?: string;
    smartCollectionSlug?: string;
    heading?: string;
    hasMore?: boolean;
    totalCount?: number;
    imageSizes?: number[];
}

export function HomeClient({ images, tags, topics, currentTags, topicSlug, smartCollectionSlug, heading, hasMore = false, totalCount, imageSizes = DEFAULT_IMAGE_SIZES }: HomeClientProps) {
    const { t, locale } = useTranslation();
    const pathname = usePathname();
    const [allImages, setAllImages] = useState(images);
    const queryVersionRef = useRef(0);
    const handleLoadMore = useCallback((newImages: GalleryImage[]) => {
        setAllImages(prev => [...prev, ...newImages]);
    }, []);

    const scrollKey = useMemo(() => `${SCROLL_STORAGE_PREFIX}${pathname}`, [pathname]);

    const saveScrollPosition = useCallback(() => {
        try {
            sessionStorage.setItem(scrollKey, String(window.scrollY));
        } catch {
            // sessionStorage may be unavailable in privacy modes
        }
    }, [scrollKey]);

    // Restore scroll position on mount when returning to a list view that
    // was previously visited. We wait a tick for the masonry layout to
    // settle before scrolling so the saved Y maps to the correct content.
    useEffect(() => {
        let saved: number | null = null;
        try {
            const raw = sessionStorage.getItem(scrollKey);
            if (raw !== null) saved = Number(raw);
            sessionStorage.removeItem(scrollKey);
        } catch {
            // ignore
        }
        if (saved == null || Number.isNaN(saved) || saved <= 0) return;

        let cancelled = false;
        const restore = () => {
            if (cancelled) return;
            window.scrollTo({ top: saved!, behavior: 'auto' });
        };
        const r1 = requestAnimationFrame(restore);
        const r2 = requestAnimationFrame(() => requestAnimationFrame(restore));
        const t1 = setTimeout(restore, 100);
        return () => {
            cancelled = true;
            cancelAnimationFrame(r1);
            cancelAnimationFrame(r2);
            clearTimeout(t1);
        };
    }, [scrollKey]);

    // Reset allImages when the images prop changes (e.g. topic/filter change)
    // Increment version so stale in-flight load-more responses are discarded
    useEffect(() => {
        queryVersionRef.current++;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional prop-driven state sync: resetting gallery state when the images prop changes (topic/filter change) is a valid React pattern (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes)
        setAllImages(images);
    }, [images]);

    const [showBackToTop, setShowBackToTop] = useState(false);
    useEffect(() => {
        const handleScroll = () => {
            const shouldShow = window.scrollY > 600;
            setShowBackToTop(prev => prev === shouldShow ? prev : shouldShow);
        };
        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const columnCount = useColumnCount();
    const orderedImages = allImages;
    const itemCount = orderedImages.length;

    // Limit column count to actual item count so empty columns don't leave
    // unused whitespace on the right side of the masonry grid.
    const colBase = Math.min(itemCount, 1);
    const colSm = Math.min(itemCount, 2);
    const colMd = Math.min(itemCount, 3);
    const colXl = Math.min(itemCount, 4);
    const col2xl = Math.min(itemCount, 5);
    const topicsMap = useMemo(() => {
        const map: Record<string, string> = {};
        for (const t of topics || []) map[t.slug] = t.label;
        return map;
    }, [topics]);
    const displayTags = useMemo(() => {
        // F-5 / AGG1L-LOW-01: humanize via the shared `humanizeTagLabel`
        // helper so the active-filter chip and the masonry card title
        // both derive their underscore-stripped form from the same
        // single-source-of-truth utility.
        return (currentTags || []).map((tag) => {
            const match = tags.find((t) => t.slug === tag.trim().toLowerCase());
            return humanizeTagLabel(match?.name ?? tag);
        });
    }, [currentTags, tags]);
    const initialLoadMoreCursor = useMemo(() => getClientImageListCursor(images.at(-1)), [images]);

    return (
        <div className="space-y-8 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">
                        {heading || t('home.latestUploads')}
                        {currentTags && currentTags.length > 0 && (
                            <span className="text-muted-foreground font-normal ml-2">
                                {displayTags.map(tag => `#${tag}`).join(' ')}
                            </span>
                        )}
                    </h1>
                    <p className="text-muted-foreground">
                        {t('home.metaTitle', { count: totalCount ?? allImages.length })}
                    </p>
                </div>
                <Suspense fallback={null}>
                    <TagFilter tags={tags} />
                </Suspense>
            </div>

            {/* Visually-hidden heading so screen-reader users get an
                intermediate H2 between the page H1 and per-card H3 titles.
                Prevents the heading-level skip flagged by WCAG 1.3.1 / 2.4.6
                (AGG3R-04 / C3R-RPL-04). */}
            <h2 className="sr-only">{t('home.photosHeading')}</h2>
            {/* F-15: at 2560px the `xl:columns-4` cap leaves ~500px gutters
                on each side, so add a 5th column at the `2xl` breakpoint
                (1536px+) to make better use of widescreen real estate.
                When fewer items than the breakpoint's max columns exist,
                clamp to the item count so the grid fills its width. */}
            <div className={`columns-${colBase} sm:columns-${colSm} md:columns-${colMd} xl:columns-${colXl} 2xl:columns-${col2xl} gap-4 w-full`}>
                {orderedImages.map((image, index) => {
                    // F-5 / F-18 / AGG1L-LOW-01: underscore normalization is
                    // now baked into `getPhotoDisplayTitleFromTagNames` and
                    // `getConcisePhotoAltText` via the shared
                    // `humanizeTagLabel` helper, so the card title and the
                    // alt text agree without any inline post-processing.
                    const displayTitle = getPhotoDisplayTitleFromTagNames(image, image.user_filename || t('common.untitled'));
                    const altText = getConcisePhotoAltText(image, t('common.photo'));

                    const isAboveFold = index < Math.min(columnCount, itemCount);

                    return (
                        <div
                            key={image.id}
                            className={cn(
                                "masonry-card break-inside-avoid relative group overflow-hidden rounded-xl bg-muted/20 [mask-image:radial-gradient(white,black)] focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 mb-4 w-full"
                            )}
                            style={{
                                aspectRatio: `${image.width} / ${image.height}`,
                                backgroundColor: 'hsl(var(--muted))',
                                containIntrinsicSize: `auto ${Math.round(300 * image.height / image.width)}px`,
                            }}
                        >
                            <Link
                                href={localizePath(locale, `/p/${image.id}`)}
                                aria-label={t('aria.viewPhoto', { title: displayTitle })}
                                onClick={saveScrollPosition}
                            >
                                <div className="relative w-full">
                                    <picture>
                                        {(() => {
                                            const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
                                            const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');

                                            if (baseWebp && baseAvif) {
                                                // Use the two smallest configured sizes for masonry grid thumbnails
                                                const smallSize = imageSizes.length >= 2 ? imageSizes[0] : findNearestImageSize(imageSizes, 640);
                                                const mediumSize = imageSizes.length >= 2 ? imageSizes[1] : findNearestImageSize(imageSizes, 1536);
                                                const hdrAvifSrcSet = HDR_FEATURE_ENABLED && image.is_hdr
                                                    ? `${imageUrl(`/uploads/avif/${baseAvif}_hdr_${smallSize}.avif`)} ${smallSize}w, ${imageUrl(`/uploads/avif/${baseAvif}_hdr_${mediumSize}.avif`)} ${mediumSize}w`
                                                    : undefined;
                                                const masonrySizes = "(min-width: 1536px) 20vw, (max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw";
                                                return (
                                                    <>
                                                        {hdrAvifSrcSet && (
                                                            <source
                                                                type="image/avif"
                                                                srcSet={hdrAvifSrcSet}
                                                                sizes={masonrySizes}
                                                                media="(dynamic-range: high)"
                                                            />
                                                        )}
                                                        <source
                                                            type="image/avif"
                                                            srcSet={`${imageUrl(`/uploads/avif/${baseAvif}_${smallSize}.avif`)} ${smallSize}w, ${imageUrl(`/uploads/avif/${baseAvif}_${mediumSize}.avif`)} ${mediumSize}w`}
                                                            sizes={masonrySizes}
                                                        />
                                                        <source
                                                            type="image/webp"
                                                            srcSet={`${imageUrl(`/uploads/webp/${baseWebp}_${smallSize}.webp`)} ${smallSize}w, ${imageUrl(`/uploads/webp/${baseWebp}_${mediumSize}.webp`)} ${mediumSize}w`}
                                                            sizes={masonrySizes}
                                                        />
                                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                                        <img
                                                            src={imageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${smallSize}.jpg`)}`)}
                                                            alt={altText}
                                                            width={image.width}
                                                            height={image.height}
                                                            className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                            loading={isAboveFold ? "eager" : "lazy"}
                                                            decoding="async"
                                                            fetchPriority={isAboveFold ? "high" : "auto"}
                                                        />
                                                    </>
                                                );
                                            }

                                            return (
                                                <OptimisticImage
                                                    src={imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)}
                                                    alt={altText}
                                                    width={image.width}
                                                    height={image.height}
                                                    className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                    sizes="(min-width: 1536px) 20vw, (max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                    blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                                                    placeholder="blur"
                                                />
                                            );
                                        })()}
                                    </picture>
                                    <div className="absolute inset-x-0 top-0 sm:hidden bg-gradient-to-b from-black/65 to-transparent p-3">
                                        <h3 className="text-white text-sm font-medium truncate">{displayTitle}</h3>
                                        <p className="text-white/80 text-xs truncate">
                                            {(image.topic && topicsMap[image.topic]) || image.topic}
                                        </p>
                                    </div>
                                    <div className="absolute inset-x-0 bottom-0 hidden bg-gradient-to-t from-black/60 to-transparent p-4 sm:block sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity duration-300">
                                        <h3 className="text-white font-medium truncate">
                                            {displayTitle}
                                        </h3>
                                        <p className="text-white/80 text-xs truncate">{(image.topic && topicsMap[image.topic]) || image.topic}</p>
                                    </div>
                                </div>
                            </Link>
                        </div>
                    );
                })}
            </div>

            {hasMore && (
                <LoadMore
                    topicSlug={topicSlug}
                    smartCollectionSlug={smartCollectionSlug}
                    tagSlugs={currentTags}
                    initialOffset={images.length}
                    initialCursor={initialLoadMoreCursor}
                    hasMore={hasMore}
                    onLoadMore={handleLoadMore}
                />
            )}

            {allImages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-64 border border-dashed rounded-xl text-muted-foreground gap-3 p-6">
                    <svg className="h-12 w-12 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
                    </svg>
                    <p className="font-medium">{t('home.noImages')}</p>
                    {currentTags && currentTags.length > 0 && (
                        <div className="flex flex-col items-center gap-2">
                            <p className="text-sm">{t('home.noResultsHint')}</p>
                            <Link href={localizePath(locale, topicSlug ? `/${topicSlug}` : '/')} className="text-sm underline hover:text-primary">
                                {t('home.clearFilter')}
                            </Link>
                        </div>
                    )}
                </div>
            )}
            <button
                onClick={() => {
                        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
                    }}
                className={cn(
                    "fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] right-6 z-40 p-3 min-h-11 min-w-11 bg-primary text-primary-foreground rounded-full shadow-lg transition-opacity hover:bg-primary/90",
                    showBackToTop ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                )}
                aria-label={t('home.backToTop')}
                aria-hidden={showBackToTop ? undefined : true}
                tabIndex={showBackToTop ? 0 : -1}
            >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                </svg>
            </button>
        </div>
    );
}
