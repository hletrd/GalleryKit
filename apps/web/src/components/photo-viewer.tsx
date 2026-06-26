'use client';

import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties, type ReactEventHandler } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardDescription, CardFooter } from "@/components/ui/card";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArrowLeft, Share2, Info, MapPin, Calendar, Clock, Download, ChevronDown, PanelRightOpen, PanelRightClose } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { useTranslation } from "@/components/i18n-provider";
import { Badge } from "@/components/ui/badge";
import { PhotoNavigation } from '@/components/photo-navigation';
import { cn } from "@/lib/utils";
import { copyToClipboard } from "@/lib/clipboard";
import { createPhotoShareLink } from '@/app/actions';
import { ImageZoom } from '@/components/image-zoom';
import { Lightbox, LightboxTrigger } from '@/components/lightbox';
import InfoBottomSheet from '@/components/info-bottom-sheet';
import { Histogram } from '@/components/histogram';
import ColorDetailsSection from '@/components/color-details-section';
import WideGamutHint from '@/components/wide-gamut-hint';
import SimilarPhotos from '@/components/similar-photos';
import { ImageDetail, TagInfo, hasExifData, hasAnyCameraExifData, nu, formatShutterSpeed } from '@/lib/image-types';
import { formatStoredExifDate, formatStoredExifTime } from '@/lib/exif-datetime';
import { imageUrl, sizedImageSrcSet, sizedImageUrl } from '@/lib/image-url';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import { getConcisePhotoAltText, getPhotoDisplayTitle, getPhotoDocumentTitle, humanizeTagLabel } from '@/lib/photo-title';
import { isSafeBlurDataUrl } from '@/lib/blur-data-url';
import { isWideGamutPrimary } from '@/lib/color-primaries';
import { buildDownloadFilename } from '@/lib/download-filename';
import { isP3Pipeline } from '@/lib/color-pipeline-decisions';
import { useDisplayCapability } from '@/lib/use-display-capability';
import { getAvifSupportPromise } from '@/lib/avif-support';

/** Check if a keyboard event target is an editable element (input, textarea, contentEditable, or role=textbox). */
export function isEditableTarget(e: KeyboardEvent): boolean {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLElement && target.isContentEditable) return true;
    if (target instanceof HTMLElement && target.getAttribute('role') === 'textbox') return true;
    return false;
}

import { useRouter } from 'next/navigation';
import siteConfig from '@/site-config.json';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize, getPhotoViewerImageSizes } from '@/lib/gallery-config-shared';

interface PhotoViewerProps {
    images: ImageDetail[];
    initialImageId: number;
    tags: TagInfo[];
    prevId?: number | null;
    nextId?: number | null;
    canShare?: boolean;
    isAdmin?: boolean;
    isSharedView?: boolean;
    syncPhotoQueryBasePath?: string;
    imageSizes?: number[];
    siteTitle?: string;
    shareBaseUrl?: string;
    untitledFallbackTitle?: string;
    showDocumentHeading?: boolean;
    slideshowIntervalSeconds?: number;
    /** P3-26: force color gamut/HDR chips visible even on sRGB displays. */
    forceShowColorChips?: boolean;
    /** R8-M2: propagate force_srgb_derivatives to ColorDetailsSection so admins see the effective delivery gamut per format. */
    forceSrgbDerivatives?: boolean;
    /** AGG-C10-07: resolved semantic-search mode; gates the production-only SimilarPhotos panel. */
    semanticSearchMode?: string;
}

export default function PhotoViewer({ images, initialImageId, prevId, nextId, canShare = false, isAdmin = false, isSharedView = false, syncPhotoQueryBasePath, imageSizes = DEFAULT_IMAGE_SIZES, siteTitle = siteConfig.title, shareBaseUrl = siteConfig.url, untitledFallbackTitle, showDocumentHeading = true, slideshowIntervalSeconds = 5, forceShowColorChips = false, forceSrgbDerivatives = false, semanticSearchMode = 'disabled' }: PhotoViewerProps) {
    const { t, locale } = useTranslation();
    const router = useRouter();
    const prefersReducedMotion = useReducedMotion();
    const [currentImageId, setCurrentImageId] = useState(initialImageId);
    const [showLightbox, setShowLightbox] = useState(() => {
        try {
            const auto = sessionStorage.getItem('gallery_auto_lightbox') === 'true';
            if (auto) sessionStorage.removeItem('gallery_auto_lightbox');
            return auto;
        } catch { return false; }
    });
    const [isSharingPhoto, setIsSharingPhoto] = useState(false);
    // R10-M11: tracks whether the current photo's actual image has finished
    // loading. The blur placeholder stays visible until onLoad fires,
    // then fades out for a smooth crossfade.
    const [imageLoaded, setImageLoaded] = useState(false);

    const showLightboxRef = useRef(showLightbox);
    useEffect(() => { showLightboxRef.current = showLightbox; }, [showLightbox]);
    const [showBottomSheet, setShowBottomSheet] = useState(false);
    const colorDetailsToggleRef = useRef<(() => void) | null>(null);
    const histogramCycleRef = useRef<(() => void) | null>(null);

    // Persist info sidebar pin state across photo navigation
    const [isPinned, setIsPinned] = useState(() => {
        try {
            return sessionStorage.getItem('gallery_info_pinned') === 'true';
        } catch { return false; }
    });
    useEffect(() => {
        try {
            sessionStorage.setItem('gallery_info_pinned', String(isPinned));
        } catch { /* noop */ }
    }, [isPinned]);

    const currentIndex = images.findIndex((img) => img.id === currentImageId);
    const image = images[currentIndex];

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- currentImageId is user-navigable state that must re-anchor when the route id changes
        setCurrentImageId(initialImageId);
    }, [initialImageId]);

    // R10-M11: reset imageLoaded when the photo changes so the blur
    // placeholder is visible while the new image decodes. onLoad on the
    // <img> / <Image> will set it to true, triggering the blur fade-out.
    // A 3-second fallback ensures cached images (where onLoad may fire
    // before the listener is attached) still dismiss the blur.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional per-photo loading reset so the new image shows its blur placeholder
        setImageLoaded(false);
        const fallbackTimer = setTimeout(() => setImageLoaded(true), 3000);
        return () => clearTimeout(fallbackTimer);
    }, [image?.id]);


    const normalizedDisplayTitle = useMemo(() => (
        image
            ? getPhotoDisplayTitle(
                image,
                untitledFallbackTitle ?? t('imageManager.untitled'),
            )
            : null
    ), [image, t, untitledFallbackTitle]);

    /**
     * Cycle 1 RPF loop AGG1-L06 / PR1-LOW-02 / DSGN1-LOW-01:
     * memoize the blur backgroundImage style so the inline style
     * object identity is stable across re-renders for a given
     * image. The previous shape rebuilt the literal each render,
     * forcing React to reassign `style.backgroundImage` on every
     * parent re-render and triggering a style-recalc even when the
     * underlying value hadn't changed. The validated value flows
     * through `isSafeBlurDataUrl()` exactly as before.
     */
    const blurStyle = useMemo<CSSProperties | undefined>(() => {
        const value = image?.blur_data_url;
        if (!isSafeBlurDataUrl(value)) return undefined;
        return {
            backgroundImage: `url(${value})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
        };
    }, [image?.blur_data_url]);

    useEffect(() => {
        document.title = getPhotoDocumentTitle(
            normalizedDisplayTitle,
            siteTitle,
            siteTitle,
        );
    }, [normalizedDisplayTitle, siteTitle]);

    const showInfo = isPinned;
    const photoViewerSizes = getPhotoViewerImageSizes(showInfo);
    const downloadFilename = image?.filename_jpeg;
    const downloadExt = downloadFilename ? downloadFilename.split('.').pop() || 'jpg' : 'jpg';
    const downloadHref = image?.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : null;
    const avifDownloadHref = image?.filename_avif ? imageUrl(`/uploads/avif/${image.filename_avif}`) : null;
    // R12-M2: derive the saved-file name from the photo's public `title`
    // (already rendered in og:title / on-page heading) so end-users have a
    // human-readable filename in their Downloads folder rather than an
    // anonymous `photo-{id}.{ext}`. Falls back to `photo-{id}.{ext}` when
    // the title is missing or slugifies to empty (CJK-only titles, etc.).
    const downloadNameJpeg = image
        ? buildDownloadFilename(image.title, image.id, downloadExt)
        : null;
    const downloadNameAvif = image
        ? buildDownloadFilename(image.title, image.id, 'avif')
        : null;
    const isWideGamutSource = isWideGamutPrimary(image?.color_primaries);
    const formattedCaptureDate = formatStoredExifDate(image?.capture_date, locale);
    const formattedCaptureTime = formatStoredExifTime(image?.capture_date, locale);

    const buildPhotoPath = useCallback((id: number) => {
        if (isSharedView && syncPhotoQueryBasePath) {
            return `${syncPhotoQueryBasePath}?photoId=${id}`;
        }
        return localizePath(locale, `/p/${id}`);
    }, [isSharedView, locale, syncPhotoQueryBasePath]);

    const navigate = useCallback((direction: number) => {
        // C7-LOW-03: guard against stale closure when images prop updates but
        // currentImageId has not yet been recalculated — currentIndex would be
        // -1 (not found), making navigation compute incorrect newIndex.
        if (currentIndex === -1) return;
        // C8-MED-03: belt-and-suspenders check that the derived currentIndex
        // actually points to the current image. When images prop changes (e.g.
        // router.push to a new photo page), the useEffect that updates
        // currentImageId runs asynchronously. Between the images update and the
        // effect firing, currentIndex could point to the wrong image. This guard
        // catches that theoretical race.
        if (images[currentIndex]?.id !== currentImageId) return;
        const newIndex = currentIndex + direction;
        if (newIndex >= 0 && newIndex < images.length) {
            setCurrentImageId(images[newIndex].id);
        } else {
            if (direction === -1 && prevId) {
                if (showLightboxRef.current) {
                    try { sessionStorage.setItem('gallery_auto_lightbox', 'true'); } catch { console.debug('sessionStorage write failed') }
                }
                router.push(buildPhotoPath(prevId));
            } else if (direction === 1 && nextId) {
                if (showLightboxRef.current) {
                    try { sessionStorage.setItem('gallery_auto_lightbox', 'true'); } catch { console.debug('sessionStorage write failed') }
                }
                router.push(buildPhotoPath(nextId));
            }
        }
    }, [buildPhotoPath, currentIndex, currentImageId, images, prevId, nextId, router]);

    // Clean up auto-lightbox flag after lazy init consumes it
    useEffect(() => {
        try { sessionStorage.removeItem('gallery_auto_lightbox'); } catch { console.debug('sessionStorage remove failed') }
    }, []);

    // Idle prefetch of prev/next photo pages (1.5 s delay via requestIdleCallback)
    useEffect(() => {
        const ids = [prevId, nextId].filter((id): id is number => id != null);
        if (ids.length === 0) return;

        // AGG-R11C11-L11: gate prefetch on connection type and data-saver mode
        // so users on slow or metered connections don't pay the bandwidth cost.
        interface ConnInfo { saveData?: boolean; effectiveType?: string }
        const conn = (navigator as Navigator & { connection?: ConnInfo }).connection;
        if (conn?.saveData) return;
        if (conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return;

        const cancelFns: (() => void)[] = [];

        const scheduleIdle = (fn: () => void): (() => void) => {
            if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
                const id = window.requestIdleCallback(fn, { timeout: 3000 });
                return () => window.cancelIdleCallback(id);
            }
            const id = setTimeout(fn, 1500);
            return () => clearTimeout(id);
        };

        for (const id of ids) {
            const cancel = scheduleIdle(() => {
                router.prefetch(buildPhotoPath(id));
            });
            cancelFns.push(cancel);
        }

        return () => {
            for (const cancel of cancelFns) cancel();
        };
    }, [prevId, nextId, buildPhotoPath, router]);

    // Preload prev/next image files so they appear instantly on navigation.
    //
    // R4C8 PERF-R4C8-03: emit exactly ONE responsive preload per neighbor.
    // The previous shape (R13-H1) emitted one preload PER format on the
    // belief that browsers which can decode AVIF "skip the WebP/JPEG tags
    // because their <picture> will pick AVIF" — that mechanism does not
    // exist: the `type` attribute on a preload link only gates MIME
    // SUPPORT, and preload links carry no knowledge of the picture's
    // source selection. Chromium fetched the AVIF AND WebP preloads for
    // every neighbor (verified live), doubling neighbor bandwidth. The
    // format is now chosen ONCE via the AVIF decode probe (the same
    // Promise-singleton the histogram uses): AVIF when supported, else
    // WebP (universally decodable by the browsers this app targets),
    // else JPEG — matching what the in-DOM <picture> will actually
    // select on navigation. `imagesrcset` / `imagesizes` keep the width
    // choice responsive (they are the HTML spec attribute names, NOT
    // camelCase DOM properties, hence setAttribute).
    useEffect(() => {
        const imgs = [image?.prevImage, image?.nextImage].filter(Boolean) as Array<NonNullable<typeof image.prevImage>>;
        if (imgs.length === 0) return;

        const links: HTMLLinkElement[] = [];
        let cancelled = false;

        const appendResponsivePreload = (
            type: 'image/avif' | 'image/webp' | 'image/jpeg',
            srcset: string,
            sizes: string,
        ) => {
            const link = document.createElement('link');
            link.rel = 'preload';
            link.as = 'image';
            link.type = type;
            link.setAttribute('imagesrcset', srcset);
            link.setAttribute('imagesizes', sizes);
            document.head.appendChild(link);
            links.push(link);
        };

        getAvifSupportPromise().then((avifSupported) => {
            if (cancelled) return;
            for (const img of imgs) {
                const baseAvif = img.filename_avif?.replace(/\.avif$/i, '');
                const baseWebp = img.filename_webp?.replace(/\.webp$/i, '');
                const baseJpeg = img.filename_jpeg?.replace(/\.jpg$/i, '');

                // Single-format selection — mirrors the <picture> outcome.
                if (avifSupported && baseAvif) {
                    const srcset = imageSizes.map(w => `${imageUrl(`/uploads/avif/${baseAvif}_${w}.avif`)} ${w}w`).join(', ');
                    appendResponsivePreload('image/avif', srcset, photoViewerSizes);
                } else if (baseWebp) {
                    const srcset = imageSizes.map(w => `${imageUrl(`/uploads/webp/${baseWebp}_${w}.webp`)} ${w}w`).join(', ');
                    appendResponsivePreload('image/webp', srcset, photoViewerSizes);
                } else if (baseJpeg) {
                    const srcset = imageSizes.map(w => `${imageUrl(`/uploads/jpeg/${baseJpeg}_${w}.jpg`)} ${w}w`).join(', ');
                    appendResponsivePreload('image/jpeg', srcset, photoViewerSizes);
                }
            }
        });

        return () => {
            cancelled = true;
            for (const link of links) {
                if (link.parentNode) link.parentNode.removeChild(link);
            }
        };
    }, [image, imageSizes, photoViewerSizes]);

    useEffect(() => {
        if (!syncPhotoQueryBasePath || !image) return;
        router.replace(`${syncPhotoQueryBasePath}?photoId=${image.id}`, { scroll: false });
    }, [image, router, syncPhotoQueryBasePath]);

    // P3-26: set document root attribute so CSS can force-show color chips
    useEffect(() => {
        document.documentElement.setAttribute('data-force-show-color-chips', forceShowColorChips ? 'true' : 'false');
        return () => {
            document.documentElement.removeAttribute('data-force-show-color-chips');
        };
    }, [forceShowColorChips]);

    // R8-M3: set data-display-gamut on <html> so CSS can show the P3 badge on
    // Firefox (which lacks `(color-gamut: p3)` MQ support but resolves P3 via
    // the canvas-P3 probe in useDisplayCapability).
    const { colorGamut: displayGamut } = useDisplayCapability();
    useEffect(() => {
        document.documentElement.setAttribute('data-display-gamut', displayGamut);
        // C4-A5: Clean up the attribute on unmount so it doesn't leak to other
        // pages after navigating away from the photo viewer.
        return () => {
            document.documentElement.removeAttribute('data-display-gamut');
        };
    }, [displayGamut]);

    // Sync info state across breakpoints: mobile bottom sheet ↔ desktop sidebar
    useEffect(() => {
        const LG = 1024;
        const mql = window.matchMedia(`(min-width: ${LG}px)`);
        const handler = (e: MediaQueryListEvent) => {
            if (e.matches) {
                // Crossing into desktop: if bottom sheet is open, transfer to sidebar
                if (showBottomSheet) {
                    setShowBottomSheet(false);
                    setIsPinned(true);
                }
            } else {
                // Crossing into mobile: close sidebar (user can reopen via button)
                if (isPinned) {
                    setIsPinned(false);
                }
            }
        };
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, [showBottomSheet, isPinned]);

    // Handle keyboard navigation (skip when lightbox is active — it handles its own keys)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat) return;
            if (showLightbox) return;
            if (isEditableTarget(e)) return;
            if (e.key === "ArrowLeft") {
                navigate(-1);
            } else if (e.key === "ArrowRight") {
                navigate(1);
            } else if (e.key === 'f' || e.key === 'F') {
                setShowLightbox(prev => !prev);
            } else if (e.key === 'i' || e.key === 'I') {
                const isLg = window.matchMedia('(min-width: 1024px)').matches;
                if (isLg) {
                    setIsPinned(prev => !prev);
                } else {
                    setShowBottomSheet(prev => !prev);
                }
            } else if (e.key === 'c' || e.key === 'C') {
                if (colorDetailsToggleRef.current) {
                    colorDetailsToggleRef.current();
                }
            } else if (e.key === 'h' || e.key === 'H') {
                if (histogramCycleRef.current) {
                    histogramCycleRef.current();
                }
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [navigate, showLightbox]);

    // R22-M1: one-shot guard ref so a true 404 on even the base filename
    // does not loop the onError handler. Reset when the photo changes so
    // the next image gets a fresh attempt. Mirrors the R21-M1 fix on the
    // lightbox so both viewer surfaces are consistent.
    // R4C8 COR-R4C8-05: the <picture>-branch fallback is STATE-driven —
    // the re-render drops the <source> rows and points the <img> at the
    // base JPEG. A bare `img.src` swap cannot work while a matching
    // <source> remains: mutating src re-runs the image-selection
    // algorithm, which re-picks the (404ing) source — verified live.
    const jpegFallbackTriedRef = useRef(false);
    const [sizedSourcesFailed, setSizedSourcesFailed] = useState(false);
    useEffect(() => {
        jpegFallbackTriedRef.current = false;
        // Intentional per-photo reset: the fallback decision belongs to ONE
        // image; navigating to the next photo must re-arm the
        // sized-derivative attempt (same pattern as the guard ref above).
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional per-photo fallback reset
        setSizedSourcesFailed(false);
    }, [image?.id]);

    const srcSetData = useMemo(() => {
        if (!image) return null;
        const getAltText = (img: ImageDetail) => getConcisePhotoAltText(img, t('common.photo'));
        const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
        const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');
        const jpegFallbackTargetSize = imageSizes.length >= 3 ? imageSizes[imageSizes.length - 2] : findNearestImageSize(imageSizes, 1536);
        const jpegSrc = sizedImageUrl('/uploads/jpeg', image.filename_jpeg, jpegFallbackTargetSize, imageSizes);
        const jpegSrcSet = sizedImageSrcSet('/uploads/jpeg', image.filename_jpeg, imageSizes);
        // R22-M1: base-filename JPEG URL used as the onError fallback when
        // the sized derivative 404s (legacy photos that pre-date the
        // sized-derivative encoder, or rows caught mid-backfill after an
        // IMAGE_PIPELINE_VERSION bump). The encoder atomic-rename contract
        // guarantees the base filename is always present on disk.
        const jpegBaseSrc = image.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : undefined;
        const handleJpegError: ReactEventHandler<HTMLImageElement> = (e) => {
            if (jpegFallbackTriedRef.current) return;
            jpegFallbackTriedRef.current = true;
            if (jpegBaseSrc) {
                const img = e.currentTarget;
                if (img.src !== jpegBaseSrc) {
                    img.src = jpegBaseSrc;
                }
            }
        };

        if (!baseWebp || !baseAvif) {
            return (
                <Image
                    src={jpegSrc}
                    sizes={photoViewerSizes}
                    alt={getAltText(image)}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain max-h-[calc(100vh-8rem)] z-0 relative photo-viewer-image"
                    priority
                    unoptimized
                    // R22-M1: next/image forwards onError to the underlying <img>.
                    // The in-place src swap IS effective on this branch because
                    // there are no <source> siblings to win re-selection.
                    onError={handleJpegError}
                    // R10-M11: dismiss the blur placeholder once the actual
                    // image has decoded, triggering the crossfade.
                    onLoad={() => setImageLoaded(true)}
                />
            );
        }

        // R4C8 COR-R4C8-05: once a sized derivative has 404ed, render the
        // plain <img> on the base JPEG with NO <source> rows — the only
        // shape in which the src attribute participates in selection. The
        // encoder atomic-rename contract guarantees the base file exists.
        if (sizedSourcesFailed && jpegBaseSrc) {
            return (
                /* eslint-disable-next-line @next/next/no-img-element -- intentional plain img: this is the error-fallback render and must not re-introduce <source> siblings or loader indirection */
                <img
                    src={jpegBaseSrc}
                    alt={getAltText(image)}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain max-h-[calc(100vh-8rem)] z-0 relative photo-viewer-image"
                    decoding="async"
                    loading="eager"
                    fetchPriority="high"
                    onLoad={() => setImageLoaded(true)}
                />
            );
        }

        return (
            <picture className="w-full h-full flex items-center justify-center">
                <source
                    type="image/avif"
                    srcSet={imageSizes.map(w => `${imageUrl(`/uploads/avif/${baseAvif}_${w}.avif`)} ${w}w`).join(', ')}
                    sizes={photoViewerSizes}
                />
                <source
                    type="image/webp"
                    srcSet={imageSizes.map(w => `${imageUrl(`/uploads/webp/${baseWebp}_${w}.webp`)} ${w}w`).join(', ')}
                    sizes={photoViewerSizes}
                />
                <img
                    src={jpegSrc}
                    srcSet={jpegSrcSet}
                    sizes={photoViewerSizes}
                    alt={getAltText(image)}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain max-h-[calc(100vh-8rem)] z-0 relative photo-viewer-image"
                    decoding="async"
                    loading="eager"
                    fetchPriority="high"
                    // R22-M1 / R4C8 COR-R4C8-05: legacy photos or mid-backfill
                    // rows may only have the base JPEG on disk. When the
                    // selected resource 404s, flip the state ONCE so the
                    // re-render above drops the <source> rows and serves the
                    // base filename — a bare src swap cannot win while a
                    // matching <source> remains. Mirrors lightbox.tsx.
                    onError={() => {
                        if (jpegFallbackTriedRef.current) return;
                        jpegFallbackTriedRef.current = true;
                        if (jpegBaseSrc) {
                            setSizedSourcesFailed(true);
                        }
                    }}
                    // R10-M11: dismiss the blur placeholder once the actual
                    // image has decoded, triggering the crossfade.
                    onLoad={() => setImageLoaded(true)}
                />
            </picture>
        );
    }, [image, photoViewerSizes, t, imageSizes, setImageLoaded, sizedSourcesFailed]);

    if (!image) return <div className="p-8 text-center">{t('home.noImages')}</div>;

    return (
        <>
        <div className={cn("flex flex-col h-full min-h-[calc(100vh-8rem)] photo-viewer-container", showLightbox && "hidden")} aria-describedby="photo-viewer-shortcuts">
            {/* Accessible H1 for heading-based SR navigation.
                Keeping visually hidden because the viewer surfaces the title
                in the toolbar/info sidebar already; the goal is to ensure
                assistive tech has a single top-level heading per WCAG 1.3.1
                and 2.4.6 (AGG3R-01 / C3R-RPL-01). */}
            {showDocumentHeading && (
                <h1 className="sr-only">{normalizedDisplayTitle ?? t('common.photo')}</h1>
            )}
            {/* F-9: the keyboard-shortcut hint is irrelevant on touch
                devices (no arrow keys, no `F`, no `I`); hide it below the `md`
                breakpoint to stop wasting precious vertical space above
                the photo on phones. AGG-R13-03 / DES-13-01: use `sr-only`
                (not `hidden`) on mobile so this element — the target of the
                container's `aria-describedby="photo-viewer-shortcuts"` — stays
                in the accessibility tree. `hidden md:block` set display:none on
                mobile, which dropped it from the a11y tree and made the
                aria-describedby reference resolve to an empty string. */}
            <p className="mb-2 text-xs text-muted-foreground sr-only md:not-sr-only" id="photo-viewer-shortcuts">
                {t('viewer.shortcutsHint')}
            </p>
            <div className="flex items-center justify-between mb-4 photo-viewer-toolbar">
                {!isSharedView && (
                    // F-20: explicit `h-11` (44 px) on the Back button so the
                    // mobile primary navigation action clears the touch
                    // target floor; the default ghost-Button height was 32 px.
                    <Button asChild variant="ghost" className="pl-0 gap-2 h-11">
                        <Link href={localizePath(locale, `/${image.topic}`)}>
                            <ArrowLeft className="h-4 w-4" />
                            {t('viewer.backTo', { topic: image.topic_label || image.topic })}
                        </Link>
                    </Button>
                )}

                <div className="flex gap-2">
                    <LightboxTrigger onClick={() => setShowLightbox(true)} />

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowBottomSheet(true)}
                        // F-20: bump to 44 px on mobile; the toolbar is
                        // touch-primary on the `lg:hidden` breakpoint.
                        className="gap-2 lg:hidden h-11"
                        aria-keyshortcuts="I"
                        title={`${t('viewer.info')} (I)`}
                    >
                        <Info className="h-4 w-4" />
                        {t('viewer.info')}
                    </Button>

                    {canShare && (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={isSharingPhoto}
                        onClick={async () => {
                            if (isSharingPhoto) return;
                            setIsSharingPhoto(true);
                            try {
                                const result = await createPhotoShareLink(image.id);
                                if (result.success) {
                                    const url = localizeUrl(shareBaseUrl, locale, `/s/${result.key}`);
                                    if (await copyToClipboard(url)) {
                                        toast.success(t('viewer.linkCopied'));
                                    } else {
                                        toast.error(t('viewer.copyFailed'));
                                    }
                                } else {
                                    toast.error(result.error || t('viewer.errorSharing'));
                                }
                            } catch {
                                toast.error(t('viewer.errorSharing'));
                            } finally {
                                setIsSharingPhoto(false);
                            }
                        }}
                        // AGG3-M01: 44 px touch-target floor, mirrors the
                        // adjacent Info button. The toolbar is touch-primary.
                        className="gap-2 h-11"
                    >
                        <Share2 className="h-4 w-4" />
                        {isSharingPhoto ? t('viewer.sharing') : t('viewer.share')}
                    </Button>
                    )}

                    <Button
                        variant={isPinned ? "default" : "outline"}
                        onClick={() => {
                            if (isPinned) {
                                setIsPinned(false);
                            } else {
                                setIsPinned(true);
                            }
                        }}
                        className="gap-2 transition-all hidden lg:flex h-11"
                        aria-keyshortcuts="I"
                        title={`${isPinned ? t('viewer.infoPinned') : t('viewer.info')} (I)`}
                    >
                        {isPinned ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
                        {isPinned ? t('viewer.infoPinned') : t('viewer.info')}
                    </Button>
                </div>
            </div>

            <div className={cn(
                "grid gap-8 flex-1 transition-all duration-500 ease-in-out photo-viewer-grid",
                showInfo ? "grid-cols-1 lg:grid-cols-[1fr_350px]" : "grid-cols-1"
            )}>
                {/* F-10: collapse `min-h-[500px]` on mobile to `40vh` so a
                    landscape photo on a 390 px phone is visible above the
                    fold instead of forcing the user to scroll past a tall
                    empty dark box. Desktop keeps the 500 px floor so the
                    image doesn't collapse to a tiny strip on widescreens.
                    F-23: the inner image fades in via the existing
                    `AnimatePresence`. When the image record carries a
                    `blur_data_url` (16 px blurred preview computed during
                    upload, see CLAUDE.md "Image Processing Pipeline"), use
                    it as a background-image so users see an instant
                    color-accurate preview while the AVIF/WebP/JPEG decodes.
                    The `skeleton-shimmer` class still provides a fallback
                    loading cue when no blur data is available.
                    AGG2-M01 / SR2-MED-01: the value is run through
                    `isSafeBlurDataUrl()` to enforce the
                    `data:image/{jpeg,png,webp};base64,…` contract before
                    it ever reaches a CSS `url()` invocation.
                    AGG2-M08 / DSGN2-MED-02: the blur lives on the inner
                    `motion.div` so it fades in with the image during
                    navigation transitions instead of swapping
                    instantaneously underneath the still-fading-out
                    previous photo. */}
                <div className="relative flex items-center justify-center bg-black/5 dark:bg-black rounded-xl border dark:border-transparent p-2 overflow-hidden min-h-[40vh] md:min-h-[500px] group">
                    <PhotoNavigation
                        prevId={prevId ?? (images[currentIndex - 1]?.id || null)}
                        nextId={nextId ?? (images[currentIndex + 1]?.id || null)}
                        disabled={showLightbox}
                        buildPhotoPath={buildPhotoPath}
                        onSelectId={isSharedView ? setCurrentImageId : undefined}
                    />

                    {/* R10-M11: blur crossfade during photo navigation.
                        The blur background lives OUTSIDE AnimatePresence so it
                        persists across image changes, acting as a placeholder
                        while the new photo decodes. It fades out when onLoad
                        fires (or a 3s fallback), creating a smooth dissolve
                        from blurred preview to sharp image. */}
                    {blurStyle && (
                        <motion.div
                            className="absolute inset-0 z-0"
                            style={blurStyle}
                            initial={false}
                            animate={{ opacity: imageLoaded ? 0 : 1 }}
                            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                        />
                    )}
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={image.id}
                            initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={prefersReducedMotion ? undefined : { opacity: 0, x: -20 }}
                            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                            className="relative w-full h-full flex items-center justify-center z-10"
                        >
                            <div className="w-full h-full flex items-center justify-center">
                                <ImageZoom className="w-full h-full flex items-center justify-center">
                                    {srcSetData}
                                </ImageZoom>
                            </div>
                        </motion.div>
                    </AnimatePresence>
                    {images.length > 1 && (
                        // C1RPF-PHOTO-LOW-05: bump bg-black/50 → bg-black/70 so the
                        // white text clears WCAG AA against bright photo content.
                        <div role="status" aria-live="polite" aria-label={t('aria.photoPosition', { current: currentIndex + 1, total: images.length })} className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1 rounded-full z-10">
                            {currentIndex + 1} / {images.length}
                        </div>
                    )}
                </div>

                {/* Info Sidebar — hidden on mobile; only shown on lg+ via desktop pin/toggle */}
                <div className={cn(
                    // DES-R5C3-05 (plan-315 item 30): animate only opacity+transform,
                    // NOT width. `transition-all` against this `overflow-hidden`
                    // container was animating `lg:w-0` (layout-thrashing width
                    // tween); fade+slide instead — width snaps, the I toggle still
                    // reflows the grid correctly at the lg breakpoint.
                    "space-y-6 transition-[opacity,transform] duration-500 ease-in-out overflow-hidden transform hidden lg:block",
                     showInfo ? "lg:opacity-100 lg:translate-x-0" : "lg:opacity-0 lg:translate-x-10 lg:w-0 lg:p-0"
                )}>
                    {showInfo && (
                        <Card className="h-full border-none shadow-none bg-transparent lg:border lg:bg-card lg:shadow-sm overflow-y-auto">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <Badge variant="outline">{image.topic}</Badge>
                                    {formattedCaptureDate && <span className="text-xs text-muted-foreground" suppressHydrationWarning>{formattedCaptureDate}</span>}
                                </div>

                                {image.tags && image.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-4 mb-2">
                                        {image.tags.map((tag: TagInfo) => (
                                            // AGG2L-LOW-01 / plan-303-A: route the
                                            // chip text through `humanizeTagLabel`
                                            // so the desktop info-sidebar tag chip
                                            // renders the same humanized form
                                            // (`#Music Festival`) as the masonry
                                            // card and tag-filter pill. Without
                                            // this, the desktop sidebar shows
                                            // `#Music_Festival` while the rest of
                                            // the page shows `#Music Festival`,
                                            // re-introducing the AGG1L-LOW-01
                                            // drift the cycle-1 plan tried to
                                            // close.
                                            <Badge key={tag.slug} variant="secondary" className="text-xs">
                                                #{humanizeTagLabel(tag.name)}
                                            </Badge>
                                        ))}
                                    </div>
                                )}

                                {/* Semantic <h2> for the image title in the info
                                    sidebar. `CardTitle` in shadcn v3 renders
                                    `<div>` so we use an explicit heading here
                                    so heading navigation works when the
                                    sidebar is visible (C3R-RPL-01 / AGG3R-01). */}
                                <h2 className="mt-2 text-2xl leading-none font-semibold break-words">
                                    {normalizedDisplayTitle}
                                </h2>
                                <CardDescription>{image.description || t('viewer.noDescription')}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ColorDetailsSection image={image} isAdmin={isAdmin} t={t} toggleRef={colorDetailsToggleRef} forceSrgbDerivatives={forceSrgbDerivatives} />
                                <WideGamutHint colorPrimaries={image.color_primaries} t={t} persistDismissal={isSharedView} />
                                <SimilarPhotos key={image.id} imageId={image.id} imageSizes={imageSizes} semanticSearchMode={semanticSearchMode} />
                                <h3 className="font-semibold mb-3 flex items-center gap-2 mt-4"><Info className="h-4 w-4" /> {t('viewer.exifData')}</h3>
                                <div className="grid grid-cols-2 gap-y-4 gap-x-2 text-sm">
                                    {hasExifData(image.camera_model) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.camera')}</p>
                                            <p className="font-medium truncate" title={nu(image.camera_model)}>{image.camera_model}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.lens_model) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.lens')}</p>
                                            <p className="font-medium truncate" title={nu(image.lens_model)}>{image.lens_model}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.focal_length) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.focalLength')}</p>
                                            <p className="font-medium">{image.focal_length}mm</p>
                                        </div>
                                    )}
                                    {hasExifData(image.f_number) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.aperture')}</p>
                                            <p className="font-medium">f/{Number(image.f_number).toFixed(1)}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.exposure_time) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.shutterSpeed')}</p>
                                            <p className="font-medium">{formatShutterSpeed(image.exposure_time)}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.iso) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.iso')}</p>
                                            <p className="font-medium">{image.iso}</p>
                                        </div>
                                    )}
                                    {/* P3-32 / C4-A1: ICC profile name and gamut chip live exclusively
                                        in the Color Details accordion above. The accordion auto-opens
                                        for non-trivial color (P3-25), so duplicating the row in the EXIF
                                        grid below is visual redundancy. */}
                                    {(image.width > 0 && image.height > 0) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.dimensions')}</p>
                                            <p className="font-medium">
                                                {image.width} × {image.height}
                                                <span className="text-muted-foreground text-xs ml-1">
                                                    ({(image.width * image.height / 1000000).toFixed(1)} MP)
                                                </span>
                                            </p>
                                        </div>
                                    )}
                                    {hasExifData(image.original_format) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.format')}</p>
                                            <p className="font-medium">
                                                {image.original_format}
                                                {image.original_file_size && (
                                                    <span className="text-muted-foreground text-xs ml-1">
                                                        ({(image.original_file_size / (1024 * 1024)).toFixed(1)} MB)
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    )}
                                    {hasExifData(image.white_balance) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.whiteBalance')}</p>
                                            <p className="font-medium">{image.white_balance}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.metering_mode) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.meteringMode')}</p>
                                            <p className="font-medium">{image.metering_mode}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.exposure_compensation) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.exposureComp')}</p>
                                            <p className="font-medium">{image.exposure_compensation}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.exposure_program) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.exposureProgram')}</p>
                                            <p className="font-medium">{image.exposure_program}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.flash) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.flash')}</p>
                                            <p className="font-medium">{image.flash}</p>
                                        </div>
                                    )}
                                    {hasExifData(image.bit_depth) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.sourceBitDepth')}</p>
                                            <p className="font-medium">{image.bit_depth}-bit</p>
                                        </div>
                                    )}
                                    {/* GPS coordinates: guarded by `isAdmin` (not `canShare`) for
                                        semantic clarity — this is about data access, not sharing.
                                        Currently unreachable from public photo pages because
                                        `selectFields` in data.ts excludes latitude/longitude for
                                        privacy. It would only render if an admin-only data accessor
                                        explicitly includes these fields. See SEC-38-01, C3R-01. */}
                                    {(isAdmin && image.latitude != null && image.longitude != null) && (
                                        <div className="col-span-2">
                                             <p className="text-muted-foreground text-xs">{t('viewer.location')}</p>
                                             <a
                                                href={`https://www.google.com/maps/search/?api=1&query=${image.latitude},${image.longitude}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="font-medium text-primary hover:underline flex items-center gap-1"
                                             >
                                                <MapPin className="h-3 w-3" />
                                                {image.latitude.toFixed(4)}, {image.longitude.toFixed(4)}
                                             </a>
                                        </div>
                                    )}
                                </div>
                                {!hasAnyCameraExifData(image) && (
                                    <p className="text-sm text-muted-foreground italic mt-2">{t('viewer.noMetadata')}</p>
                                )}
                                {image.filename_jpeg && (
                                    <div className="mt-4 border-t pt-4">
                                        <Histogram
                                            imageUrl={imageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(imageSizes, 640)}.jpg`)}`)}
                                            avifUrl={image.filename_avif
                                                ? imageUrl(`/uploads/avif/${image.filename_avif.replace(/\.avif$/i, `_${findNearestImageSize(imageSizes, 640)}.avif`)}`)
                                                : undefined}
                                            fallbackImageUrl={imageUrl(`/uploads/jpeg/${image.filename_jpeg}`)}
                                            colorPrimaries={image.color_primaries}
                                            className="w-full"
                                            cycleModeRef={histogramCycleRef}
                                        />
                                    </div>
                                )}
                                <div className="grid grid-cols-2 gap-4 text-sm mt-4">

                                    <div className="col-span-2">
                                        <p className="text-muted-foreground">{t('viewer.capturedAt')}</p>
                                        <p className="font-medium flex items-center gap-1" suppressHydrationWarning>
                                            <Calendar className="w-3 h-3" />
                                            {formattedCaptureDate || t('common.unknown')}
                                        </p>
                                        {formattedCaptureTime && (
                                            <p className="font-medium flex items-center gap-1 text-xs text-muted-foreground mt-1" suppressHydrationWarning>
                                                <Clock className="w-3 h-3" />
                                                {formattedCaptureTime}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                            {downloadHref && (
                                <CardFooter>
                                    {isWideGamutSource && avifDownloadHref ? (
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button className="w-full gap-2 min-h-11">
                                                    <Download className="h-4 w-4" />
                                                    {isP3Pipeline(image.color_pipeline_decision)
                                                        ? t('viewer.downloadP3Jpeg')
                                                        : t('viewer.downloadJpeg')}
                                                    <ChevronDown className="h-4 w-4 ml-auto" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="min-w-[12rem]">
                                                <DropdownMenuItem asChild className="h-auto min-h-11 py-2">
                                                    <a
                                                        href={downloadHref}
                                                        download={downloadNameJpeg ?? `photo-${image.id}.${downloadExt}`}
                                                        className="flex flex-col"
                                                    >
                                                        <span>{t('viewer.downloadSrgbJpeg')}</span>
                                                        <span className="text-xs text-muted-foreground">{t('viewer.downloadSrgbJpegDesc')}</span>
                                                    </a>
                                                </DropdownMenuItem>
                                                <DropdownMenuItem asChild className="h-auto min-h-11 py-2">
                                                    <a
                                                        href={avifDownloadHref}
                                                        download={downloadNameAvif ?? `photo-${image.id}.avif`}
                                                        className="flex flex-col"
                                                    >
                                                        <span>{t('viewer.downloadP3Avif')}</span>
                                                        <span className="text-xs text-muted-foreground">{t('viewer.downloadP3AvifDesc')}</span>
                                                    </a>
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    ) : (
                                        <Button asChild className="w-full gap-2 min-h-11">
                                            <a
                                                href={downloadHref}
                                                download={downloadNameJpeg ?? `photo-${image.id}.${downloadExt}`}
                                            >
                                                <Download className="h-4 w-4" /> {t('viewer.downloadJpeg')}
                                            </a>
                                        </Button>
                                    )}
                                </CardFooter>
                            )}
                        </Card>
                    )}
                </div>
            </div>
        </div>

        {showLightbox && (
            <Lightbox
                image={image}
                prevId={prevId ?? (images[currentIndex - 1]?.id || null)}
                nextId={nextId ?? (images[currentIndex + 1]?.id || null)}
                onClose={() => setShowLightbox(false)}
                onNavigate={navigate}
                onSlideshowAdvance={() => {
                    if (images.length <= 1) return;
                    const nextIndex = (currentIndex + 1) % images.length;
                    setCurrentImageId(images[nextIndex].id);
                }}
                imageSizes={imageSizes}
                slideshowIntervalSeconds={slideshowIntervalSeconds}
                currentIndex={currentIndex}
                totalCount={images.length}
                isAdmin={isAdmin}
                forceSrgbDerivatives={forceSrgbDerivatives}
            />
        )}

        <InfoBottomSheet
            image={image}
            isOpen={showBottomSheet}
            onClose={() => setShowBottomSheet(false)}
            isAdmin={isAdmin}
            untitledFallbackTitle={untitledFallbackTitle}
            imageSizes={imageSizes}
            forceSrgbDerivatives={forceSrgbDerivatives}
            histogramCycleRef={histogramCycleRef}
            isSharedView={isSharedView}
        />
    </>
    );
}
