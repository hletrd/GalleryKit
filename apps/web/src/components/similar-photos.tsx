'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useTranslation } from '@/components/i18n-provider';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sizedImageUrl, imageUrl } from '@/lib/image-url';
import { localizePath } from '@/lib/locale-path';
import { DEFAULT_IMAGE_SIZES } from '@/lib/gallery-config-shared';

interface SimilarResult {
    imageId: number;
    score: number;
    title: string | null;
    description: string | null;
    filename_jpeg: string;
    width: number;
    height: number;
    topic: string;
    topic_label: string | null;
    camera_model: string | null;
}

interface SimilarPhotosProps {
    imageId: number;
    imageSizes?: number[];
}

/**
 * "Similar photos" disclosure panel for the photo viewer sidebar.
 *
 * Mirrors the collapsed-by-default disclosure pattern from ColorDetailsSection
 * and LightboxColorPip: the panel is collapsed on mount and the API is fetched
 * only on first expand so non-production deployments (503) and error cases
 * produce no visible broken UI — the component returns null on any non-200
 * response or network error.
 *
 * Touch targets: the toggle button uses `min-h-11` (44 px), each thumbnail
 * link wraps a 48×48 image but the Link itself spans `min-h-11` — both meet
 * WCAG 2.5.5 / Apple HIG 44 px floor enforced by the touch-target audit test.
 */
export default function SimilarPhotos({ imageId, imageSizes = DEFAULT_IMAGE_SIZES }: SimilarPhotosProps) {
    const t = useTranslations('search');
    const { locale } = useTranslation();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    // null = not yet fetched; [] = fetched, empty; [...] = fetched with results; 'error' = hide
    const [results, setResults] = useState<SimilarResult[] | null | 'error'>(null);
    const fetchedRef = useRef(false);

    async function handleToggle() {
        const nextOpen = !open;
        setOpen(nextOpen);

        if (nextOpen && !fetchedRef.current) {
            fetchedRef.current = true;
            setLoading(true);
            try {
                const res = await fetch(`/api/search/similar/${imageId}`);
                if (!res.ok) {
                    // 503 (stub/disabled mode), 404 (no embedding), 429, etc.
                    // Render nothing — non-production and error cases stay silent.
                    setResults('error');
                    setOpen(false);
                    return;
                }
                const json = await res.json() as { results?: SimilarResult[] };
                setResults(json.results ?? []);
            } catch {
                // Network error — hide panel
                setResults('error');
                setOpen(false);
            } finally {
                setLoading(false);
            }
        }
    }

    // If a previous fetch errored, don't render at all
    if (results === 'error') return null;

    const thumbnailSize = imageSizes.includes(128) ? 128 : (imageSizes[0] ?? 640);

    return (
        <div className="mt-4">
            {/* Toggle button — min-h-11 (44 px) touch target per WCAG 2.5.5 */}
            <button
                type="button"
                onClick={handleToggle}
                className="flex w-full items-center justify-between min-h-11 px-0 text-sm font-semibold hover:text-foreground/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                aria-expanded={open}
            >
                <span>{t('similarPhotos')}</span>
                <ChevronDown
                    className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
                />
            </button>

            {open && (
                <div className="mt-2">
                    {loading ? (
                        <div className="flex items-center justify-center py-4">
                            <span className="text-sm text-muted-foreground animate-pulse">{'…'}</span>
                        </div>
                    ) : Array.isArray(results) && results.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">{t('similarEmpty')}</p>
                    ) : Array.isArray(results) && results.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                            {results.map((item) => {
                                const sizedSrc = sizedImageUrl('/uploads/jpeg', item.filename_jpeg, thumbnailSize, imageSizes);
                                const baseSrc = imageUrl(`/uploads/jpeg/${item.filename_jpeg}`);
                                return (
                                    <SimilarThumb
                                        key={item.imageId}
                                        imageId={item.imageId}
                                        title={item.title ?? item.description ?? null}
                                        sizedSrc={sizedSrc}
                                        baseSrc={baseSrc}
                                        locale={locale}
                                    />
                                );
                            })}
                        </div>
                    ) : null}
                </div>
            )}
        </div>
    );
}

interface SimilarThumbProps {
    imageId: number;
    title: string | null;
    sizedSrc: string;
    baseSrc: string;
    locale: string;
}

/**
 * Per-thumbnail component so fallback state (`sizedSrc` → `baseSrc`) lives
 * per-item, matching the pattern in SearchResultItem / lightbox photo list.
 * The Link wraps the image in a block that is min-h-11 to meet the 44 px
 * touch-target floor.
 */
function SimilarThumb({ imageId, title, sizedSrc, baseSrc, locale }: SimilarThumbProps) {
    const [imgSrc, setImgSrc] = useState(sizedSrc);
    const fallbackTriedRef = useRef(false);

    return (
        <Link
            href={localizePath(locale, `/p/${imageId}`)}
            className="block rounded-md overflow-hidden bg-muted aspect-square min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title={title ?? undefined}
        >
            <Image
                src={imgSrc}
                alt={title ?? ''}
                width={96}
                height={96}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={() => {
                    if (fallbackTriedRef.current) return;
                    fallbackTriedRef.current = true;
                    if (imgSrc !== baseSrc) setImgSrc(baseSrc);
                }}
            />
        </Link>
    );
}
