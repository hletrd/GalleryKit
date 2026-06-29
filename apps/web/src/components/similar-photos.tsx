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
    // AGG-C9-04 (run-6 cycle-9): the /api/search/similar/[id] route returns
    // lens_model + capture_date (added by the AGG-C8-09/10 lens/date parity fix).
    // The component does not render them today, but the interface must match the
    // wire shape so the client type does not silently drift from the API contract.
    lens_model: string | null;
    capture_date: string | null;
}

interface SimilarPhotosProps {
    imageId: number;
    imageSizes?: number[];
    /** Resolved semantic-search mode. The similar-photos API is production-only. */
    semanticSearchMode?: string;
}

/**
 * "Similar photos" disclosure panel for the photo viewer sidebar.
 *
 * Mirrors the collapsed-by-default disclosure pattern from ColorDetailsSection
 * and LightboxColorPip: the panel is collapsed on mount and the API is fetched
 * only on first expand.
 *
 * AGG-C10-07 (run-6 cycle-1): the `/api/search/similar/[id]` endpoint serves ONLY
 * in production mode (503 otherwise), so in every UI-reachable config (disabled /
 * stub) the toggle would always 503, vanish, and shift the layout below it. The
 * whole control is therefore gated on `semanticSearchMode === 'production'`. Once
 * production is active, transient setup/rate-limit/fetch failures stay visible as
 * localized inline feedback instead of silently removing the panel.
 *
 * Touch targets: the toggle button uses `min-h-11` (44 px), each thumbnail
 * link wraps a 96 px image but the Link itself spans `min-h-11` — both meet
 * WCAG 2.5.5 / Apple HIG 44 px floor enforced by the touch-target audit test.
 */
export default function SimilarPhotos({ imageId, imageSizes = DEFAULT_IMAGE_SIZES, semanticSearchMode = 'disabled' }: SimilarPhotosProps) {
    const t = useTranslations('search');
    const tCommon = useTranslations('common');
    const { locale } = useTranslation();

    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    // null = not yet fetched; [] = fetched, empty; [...] = fetched with results; 'error' = fetched with failure feedback
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
                    // 503 (setup/backfill), 404 (no embedding), 429, etc.
                    setResults('error');
                    return;
                }
                const json = await res.json() as { results?: SimilarResult[] };
                setResults(json.results ?? []);
            } catch {
                // Network error — keep panel visible with localized feedback.
                setResults('error');
            } finally {
                setLoading(false);
            }
        }
    }

    // AGG-C10-07: the similar-photos API is production-only. Render nothing in any
    // other mode (disabled/stub) so the control is never a dead 503-ing toggle that
    // shifts the layout. Hooks above always run, so this conditional return is safe.
    if (semanticSearchMode !== 'production') return null;

    const thumbnailSize = imageSizes.includes(128) ? 128 : (imageSizes[0] ?? 640);

    return (
        <div className="mt-4">
            {/* Toggle button — min-h-11 (44 px) touch target per WCAG 2.5.5 */}
            <button
                type="button"
                onClick={handleToggle}
                className="flex w-full items-center justify-between min-h-11 px-0 text-sm font-semibold hover:text-foreground/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
                aria-expanded={open}
                aria-controls="similar-photos-results"
            >
                <span>{t('similarPhotos')}</span>
                <ChevronDown
                    className={cn('h-4 w-4 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
                />
            </button>

            {/* AGG-C8-11 (run-6 cycle-8): id pairs with the button's aria-controls so AT
                users can navigate from the disclosure toggle to the revealed region. */}
            {open && (
                <div id="similar-photos-results" className="mt-2">
                    {loading ? (
                        // AGG-C10-07: announce loading to assistive tech (WCAG 4.1.3) and
                        // give reduced-motion users a labelled state, mirroring search.tsx.
                        <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
                            <span className="text-sm text-muted-foreground animate-pulse motion-reduce:animate-none">{tCommon('loading')}</span>
                        </div>
                    ) : results === 'error' ? (
                        <p className="text-sm text-muted-foreground py-2" role="status">{t('similarError')}</p>
                    ) : Array.isArray(results) && results.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">{t('similarEmpty')}</p>
                    ) : Array.isArray(results) && results.length > 0 ? (
                        <div className="grid grid-cols-3 gap-2">
                            {results.map((item) => {
                                const sizedSrc = sizedImageUrl('/uploads/jpeg', item.filename_jpeg, thumbnailSize, imageSizes);
                                const baseSrc = imageUrl(`/uploads/jpeg/${item.filename_jpeg}`);
                                // DES-R9C4-01: guarantee a non-empty accessible name on the
                                // thumbnail <Link> even when both title and description are
                                // null (the common case). Falls back to the localized "Photo"
                                // string, matching the sibling search.tsx:83 pattern, so the
                                // link never has an empty accname (WCAG 4.1.2 / 2.4.4 Level A).
                                const label = item.title ?? item.description ?? tCommon('photo');
                                return (
                                    <SimilarThumb
                                        key={item.imageId}
                                        imageId={item.imageId}
                                        label={label}
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
    /** Guaranteed-non-empty accessible label (title ?? description ?? localized "Photo"). */
    label: string;
    sizedSrc: string;
    baseSrc: string;
    locale: string;
}

/**
 * Per-thumbnail component so fallback state (`sizedSrc` → `baseSrc`) lives
 * per-item, matching the pattern in SearchResultItem / lightbox photo list.
 * The Link wraps the image in a block that is min-h-11 to meet the 44 px
 * touch-target floor.
 *
 * DES-R9C4-01: `label` is always non-empty (parent falls back to the localized
 * "Photo" string), so the <Link> always has an accessible name — used for the
 * image alt, the title attribute, AND an explicit aria-label so AT users and
 * keyboard users get a named link even when the photo has no title/description.
 */
function SimilarThumb({ imageId, label, sizedSrc, baseSrc, locale }: SimilarThumbProps) {
    const [imgSrc, setImgSrc] = useState(sizedSrc);
    const fallbackTriedRef = useRef(false);

    return (
        <Link
            href={localizePath(locale, `/p/${imageId}`)}
            className="block rounded-md overflow-hidden bg-muted aspect-square min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            title={label}
            aria-label={label}
        >
            <Image
                src={imgSrc}
                alt={label}
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
