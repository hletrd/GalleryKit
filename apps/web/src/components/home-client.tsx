'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { TagFilter } from '@/components/tag-filter';
import { useTranslation } from "@/components/i18n-provider";
import { OptimisticImage } from './optimistic-image';
import { LoadMore } from '@/components/load-more';
import { cn } from '@/lib/utils';

function reorderForColumns(items: any[], columnCount: number): any[] {
    if (columnCount <= 1 || items.length === 0) return items;

    // Initialize columns with heights
    const columns: { items: any[]; height: number }[] =
        Array.from({ length: columnCount }, () => ({ items: [], height: 0 }));

    // Distribute items to shortest column (greedy algorithm)
    for (const item of items) {
        // Use aspect ratio to estimate relative height (normalized to width=1)
        const aspectRatio = (item.width && item.height && item.width > 0)
            ? item.height / item.width
            : 1;

        // Find the shortest column
        let shortest = 0;
        for (let i = 1; i < columns.length; i++) {
            if (columns[i].height < columns[shortest].height) {
                shortest = i;
            }
        }

        columns[shortest].items.push(item);
        columns[shortest].height += aspectRatio;
    }

    // Interleave: CSS columns fills top-to-bottom, so to get left-to-right
    // visual order, we need to arrange items so that CSS columns produces
    // the correct visual order.
    // CSS columns with N columns takes items [0..k-1] in col 1, [k..2k-1] in col 2, etc.
    // We want col[0][0], col[1][0], col[2][0], col[0][1], col[1][1], ...
    // So we need to output in column-first order that CSS will then re-distribute.

    // The trick: determine how many items go in each CSS column
    const totalItems = items.length;
    const basePerCol = Math.floor(totalItems / columnCount);
    const extras = totalItems % columnCount;

    // CSS columns distributes: first (extras) columns get (basePerCol+1) items,
    // remaining columns get basePerCol items
    const cssColSizes: number[] = [];
    for (let i = 0; i < columnCount; i++) {
        cssColSizes.push(i < extras ? basePerCol + 1 : basePerCol);
    }

    // Build result array in the order CSS columns expects
    const result: any[] = [];
    for (let col = 0; col < columnCount; col++) {
        const count = cssColSizes[col];
        for (let row = 0; row < count; row++) {
            if (row < columns[col].items.length) {
                result.push(columns[col].items[row]);
            }
        }
    }

    // If any items were missed due to uneven distribution, append them
    if (result.length < items.length) {
        const resultIds = new Set(result.map(r => r.id));
        for (const item of items) {
            if (!resultIds.has(item.id)) {
                result.push(item);
            }
        }
    }

    return result;
}

function useColumnCount() {
    const [count, setCount] = useState(4);

    useEffect(() => {
        let rafId: number | null = null;
        const update = () => {
            const w = window.innerWidth;
            if (w < 640) setCount(1);
            else if (w < 768) setCount(2);
            else if (w < 1280) setCount(3);
            else setCount(4);
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

interface HomeClientProps {
    images: any[];
    tags: any[];
    currentTags?: string[];
    topicSlug?: string;
    hasMore?: boolean;
    totalCount?: number;
}

export function HomeClient({ images, tags, currentTags, topicSlug, hasMore = false, totalCount }: HomeClientProps) {
    const { t } = useTranslation();
    const [allImages, setAllImages] = useState(images);
    const handleLoadMore = useCallback((newImages: any[]) => {
        setAllImages(prev => [...prev, ...newImages]);
    }, []);

    // Reset allImages when the images prop changes (e.g. topic/filter change)
    useEffect(() => { setAllImages(images); }, [images]);

    const columnCount = useColumnCount();
    const orderedImages = useMemo(() => reorderForColumns(allImages, columnCount), [allImages, columnCount]);
    const displayTags = (currentTags || []).map((tag) => {
        const match = tags.find((t: any) => t.slug === tag.trim().toLowerCase());
        return match?.name ?? tag;
    });

    return (
        <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col space-y-2">
                    <h1 className="text-3xl font-bold tracking-tight">
                        {t('home.latestUploads')}
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
                <TagFilter tags={tags} />
            </div>

            <div className="columns-1 sm:columns-2 md:columns-3 xl:columns-4 gap-4 space-y-4">
                {orderedImages.map((image) => {
                    const altText = (image.description && image.description.trim())
                        ? image.description
                        : (image.title && image.title.trim() && !image.title.match(/\.[a-z0-9]{3,4}$/i))
                            ? image.title
                            : image.tag_names
                                ? image.tag_names.split(',').map((t: string) => t.trim()).join(', ')
                                : 'Photo';
                    const displayTitle = (() => {
                        if (image.title && image.title.trim().length > 0) {
                             return image.title;
                        }
                        if (image.tag_names) {
                            return image.tag_names.split(',').map((tag: string) => `#${tag.trim()}`).join(' ');
                        }
                        return image.user_filename || 'Untitled';
                    })();

                    return (
                        <div
                            key={image.id}
                            className={cn(
                                "break-inside-avoid relative group overflow-hidden rounded-xl bg-muted/20 [mask-image:radial-gradient(white,black)]",
                                image.blur_data_url && "skeleton-shimmer"
                            )}
                            style={image.blur_data_url ? {
                                backgroundImage: `url(${image.blur_data_url})`,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                            } : {
                                aspectRatio: `${image.width} / ${image.height}`,
                                backgroundColor: 'hsl(var(--muted))',
                            }}
                        >
                            <Link href={`/p/${image.id}`}>
                                <div className="relative w-full">
                                    <picture>
                                        {(() => {
                                            const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
                                            const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');

                                            if (baseWebp && baseAvif) {
                                                return (
                                                    <>
                                                        <source
                                                            type="image/avif"
                                                            srcSet={`/uploads/avif/${baseAvif}_640.avif 640w, /uploads/avif/${baseAvif}_1536.avif 1536w`}
                                                            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                        />
                                                        <source
                                                            type="image/webp"
                                                            srcSet={`/uploads/webp/${baseWebp}_640.webp 640w, /uploads/webp/${baseWebp}_1536.webp 1536w`}
                                                            sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                        />
                                                        <img
                                                            src={`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, '_640.jpg')}`}
                                                            alt={altText}
                                                            width={image.width}
                                                            height={image.height}
                                                            className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                            loading="lazy"
                                                            decoding="async"
                                                        />
                                                    </>
                                                );
                                            }

                                            return (
                                                <OptimisticImage
                                                    src={`/uploads/jpeg/${image.filename_jpeg}`}
                                                    alt={altText}
                                                    width={image.width}
                                                    height={image.height}
                                                    className="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105"
                                                    sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                                    blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
                                                    placeholder="blur"
                                                />
                                            );
                                        })()}
                                    </picture>
                                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                                        <h3 className="text-white font-medium truncate">
                                            {displayTitle}
                                        </h3>
                                        <p className="text-white/80 text-xs truncate">{image.topic}</p>
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
                    tagSlugs={currentTags}
                    initialOffset={images.length}
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
                            <p className="text-sm">{t('home.noResultsHint') || 'Try removing some filters'}</p>
                            <Link href={topicSlug ? `/${topicSlug}` : '/'} className="text-sm underline hover:text-primary">
                                {t('home.clearFilter')}
                            </Link>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
