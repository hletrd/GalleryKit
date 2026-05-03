'use client';

import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardDescription, CardFooter } from "@/components/ui/card";
import { ArrowLeft, Share2, Info, MapPin, Calendar, Clock, Download, PanelRightOpen, PanelRightClose, Heart, ShoppingCart } from "lucide-react";
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
import { ImageDetail, TagInfo, hasExifData, nu, formatShutterSpeed } from '@/lib/image-types';
import { formatStoredExifDate, formatStoredExifTime } from '@/lib/exif-datetime';
import { imageUrl, sizedImageSrcSet, sizedImageUrl } from '@/lib/image-url';
import { localizePath, localizeUrl } from '@/lib/locale-path';
import { getConcisePhotoAltText, getPhotoDisplayTitle, getPhotoDocumentTitle, humanizeTagLabel } from '@/lib/photo-title';
import { isSafeBlurDataUrl } from '@/lib/blur-data-url';

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
    reactionsEnabled?: boolean;
    /** US-P54: per-tier prices in cents (0 = not for sale). Used to show Buy/Download button. */
    licensePrices?: Record<string, number>;
    /**
     * Cycle 1 RPF / plan-100 / C1RPF-PHOTO-HIGH-02: Stripe Checkout
     * post-redirect status. Surfaced as a toast on first mount so the
     * visitor sees a confirmation after paying instead of landing on a
     * silent page that looks identical to pre-checkout.
     */
    checkoutStatus?: 'success' | 'cancel' | null;
}

export default function PhotoViewer({ images, initialImageId, prevId, nextId, canShare = false, isAdmin = false, isSharedView = false, syncPhotoQueryBasePath, imageSizes = DEFAULT_IMAGE_SIZES, siteTitle = siteConfig.title, shareBaseUrl = siteConfig.url, untitledFallbackTitle, showDocumentHeading = true, slideshowIntervalSeconds = 5, reactionsEnabled = true, licensePrices, checkoutStatus = null }: PhotoViewerProps) {
    const { t, locale } = useTranslation();
    const router = useRouter();
    const prefersReducedMotion = useReducedMotion();
    const [currentImageId, setCurrentImageId] = useState(initialImageId);
    const [isPinned, setIsPinned] = useState(false);
    const [showLightbox, setShowLightbox] = useState(false);
    const [isSharingPhoto, setIsSharingPhoto] = useState(false);
    const [reactionCount, setReactionCount] = useState<number>(0);
    const [liked, setLiked] = useState<boolean>(false);
    const [isReacting, setIsReacting] = useState(false);
    const [isCheckingOut, setIsCheckingOut] = useState(false);
    useEffect(() => {
        try {
            if (sessionStorage.getItem('gallery_auto_lightbox') === 'true') {
                setShowLightbox(true);
            }
        } catch { console.debug('sessionStorage read failed') }
    }, []);

    /**
     * Cycle 1 RPF / plan-100 / C1RPF-PHOTO-HIGH-02:
     * Surface Stripe Checkout post-redirect status to the visitor as a
     * toast on first mount. Without this the visitor lands back on the
     * exact same photo page they clicked Buy from with zero UI signal,
     * which looks like the click did nothing and frequently triggers a
     * chargeback. The current product surfaces the download token via
     * the admin /sales view for manual distribution (see CLAUDE.md and
     * the webhook docstring), so the success copy explicitly says
     * "your download link is being prepared" — no over-promise.
     *
     * Run-once via a ref guard for React 18 strict-mode double-mount.
     * After firing we strip the `?checkout=…` query param so a soft
     * refresh doesn't re-toast.
     */
    const checkoutToastFiredRef = useRef(false);
    useEffect(() => {
        if (!checkoutStatus || checkoutToastFiredRef.current) return;
        checkoutToastFiredRef.current = true;
        if (checkoutStatus === 'success') {
            toast.success(t('stripe.checkoutSuccess'));
        } else if (checkoutStatus === 'cancel') {
            toast.info(t('stripe.checkoutCancelled'));
        }
        try {
            const u = new URL(window.location.href);
            u.searchParams.delete('checkout');
            window.history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
        } catch { /* noop */ }
    }, [checkoutStatus, t]);

    const showLightboxRef = useRef(showLightbox);
    useEffect(() => { showLightboxRef.current = showLightbox; }, [showLightbox]);
    const [showBottomSheet, setShowBottomSheet] = useState(false);

    const currentIndex = images.findIndex((img) => img.id === currentImageId);
    const image = images[currentIndex];

    useEffect(() => {
        setCurrentImageId(initialImageId);
    }, [initialImageId]);

    // US-P31: fetch reaction state whenever the displayed image changes
    useEffect(() => {
        if (!reactionsEnabled) return;
        let cancelled = false;
        fetch(`/api/reactions/${currentImageId}`, { method: 'GET' })
            .then(r => r.ok ? r.json() : null)
            .then((data: { reactionCount: number; liked: boolean } | null) => {
                if (!cancelled && data) {
                    setReactionCount(data.reactionCount);
                    setLiked(data.liked);
                }
            })
            .catch(() => {/* ignore fetch errors for read-only state */});
        return () => { cancelled = true; };
    }, [currentImageId, reactionsEnabled]);

    const handleToggleReaction = useCallback(async () => {
        if (isReacting || !reactionsEnabled) return;
        setIsReacting(true);
        // Optimistic update
        const prevLiked = liked;
        const prevCount = reactionCount;
        setLiked(!liked);
        setReactionCount(liked ? Math.max(0, reactionCount - 1) : reactionCount + 1);
        try {
            const res = await fetch(`/api/reactions/${currentImageId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (res.status === 429) {
                setLiked(prevLiked);
                setReactionCount(prevCount);
                toast.error(t('reaction.rateLimited'));
            } else if (!res.ok) {
                setLiked(prevLiked);
                setReactionCount(prevCount);
                toast.error(t('reaction.error'));
            } else {
                const data: { reactionCount: number; liked: boolean } = await res.json();
                setReactionCount(data.reactionCount);
                setLiked(data.liked);
            }
        } catch {
            setLiked(prevLiked);
            setReactionCount(prevCount);
            toast.error(t('reaction.error'));
        } finally {
            setIsReacting(false);
        }
    }, [isReacting, reactionsEnabled, liked, reactionCount, currentImageId, t]);

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

    useEffect(() => {
        if (!syncPhotoQueryBasePath || !image) return;
        router.replace(`${syncPhotoQueryBasePath}?photoId=${image.id}`, { scroll: false });
    }, [image, router, syncPhotoQueryBasePath]);

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
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [navigate, showLightbox]);

    const srcSetData = useMemo(() => {
        if (!image) return null;
        const getAltText = (img: ImageDetail) => getConcisePhotoAltText(img, t('common.photo'));
        const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');
        const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');
        const jpegFallbackTargetSize = imageSizes.length >= 3 ? imageSizes[imageSizes.length - 2] : findNearestImageSize(imageSizes, 1536);
        const jpegSrc = sizedImageUrl('/uploads/jpeg', image.filename_jpeg, jpegFallbackTargetSize, imageSizes);
        const jpegSrcSet = sizedImageSrcSet('/uploads/jpeg', image.filename_jpeg, imageSizes);

        if (!baseWebp || !baseAvif) {
            return (
                <Image
                    src={jpegSrc}
                    sizes={photoViewerSizes}
                    alt={getAltText(image)}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain max-h-[80vh] z-0 relative photo-viewer-image"
                    priority
                    unoptimized
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
                    className="w-full h-full object-contain max-h-[80vh] z-0 relative photo-viewer-image"
                    decoding="async"
                    loading="eager"
                />
            </picture>
        );
    }, [image, photoViewerSizes, t, imageSizes]);

    if (!image) return <div className="p-8 text-center">{t('home.noImages')}</div>;

    return (
        <div className="flex flex-col h-full min-h-[calc(100vh-8rem)] photo-viewer-container">
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
                the photo on phones. */}
            <p className="mb-2 text-xs text-muted-foreground hidden md:block" id="photo-viewer-shortcuts">
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
                    {reactionsEnabled && (
                        <Button
                            variant={liked ? "default" : "outline"}
                            size="sm"
                            onClick={handleToggleReaction}
                            disabled={isReacting}
                            className="gap-2 h-11"
                            aria-label={liked ? t('reaction.unlikePhoto') : t('reaction.likePhoto')}
                            aria-pressed={liked}
                            title={liked ? t('reaction.unlikePhoto') : t('reaction.likePhoto')}
                        >
                            <Heart className={liked ? "h-4 w-4 fill-current" : "h-4 w-4"} />
                            {reactionCount > 0 ? reactionCount : (liked ? t('reaction.liked') : t('reaction.like'))}
                        </Button>
                    )}
                    {/* US-P54: Buy/Download button when tier != none and price > 0 */}
                    {image.license_tier && image.license_tier !== 'none' && licensePrices && (licensePrices[image.license_tier] ?? 0) > 0 && (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={isCheckingOut}
                            className="gap-2 h-11"
                            onClick={async () => {
                                if (isCheckingOut) return;
                                setIsCheckingOut(true);
                                try {
                                    const res = await fetch(`/api/checkout/${image.id}`, { method: 'POST' });
                                    if (!res.ok) {
                                        toast.error(t('stripe.checkoutError'));
                                        return;
                                    }
                                    const data: { url?: string; error?: string } = await res.json();
                                    if (data.url) {
                                        window.location.href = data.url;
                                    } else {
                                        toast.error(data.error ?? t('stripe.checkoutError'));
                                    }
                                } catch {
                                    toast.error(t('stripe.checkoutError'));
                                } finally {
                                    setIsCheckingOut(false);
                                }
                            }}
                        >
                            <ShoppingCart className="h-4 w-4" />
                            {isCheckingOut
                                ? t('stripe.checkingOut')
                                : (() => {
                                    // C1RPF-PHOTO-LOW-01: localize the price label via Intl.NumberFormat
                                    // so a Korean visitor sees a locale-formatted USD price (e.g. "US$12.00")
                                    // instead of a hardcoded "$12.00". The actual Stripe currency stays USD.
                                    const cents = licensePrices[image.license_tier] ?? 0;
                                    let formatted: string;
                                    try {
                                        formatted = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(cents / 100);
                                    } catch {
                                        formatted = `$${(cents / 100).toFixed(2)}`;
                                    }
                                    return `${t('stripe.buy')} (${formatted})`;
                                })()}
                        </Button>
                    )}

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
                <div className="relative flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl border p-2 overflow-hidden min-h-[40vh] md:min-h-[500px] group skeleton-shimmer">
                    <PhotoNavigation
                        prevId={prevId ?? (images[currentIndex - 1]?.id || null)}
                        nextId={nextId ?? (images[currentIndex + 1]?.id || null)}
                        disabled={showLightbox}
                        buildPhotoPath={buildPhotoPath}
                        onSelectId={isSharedView ? setCurrentImageId : undefined}
                    />

                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={image.id}
                            initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={prefersReducedMotion ? undefined : { opacity: 0, x: -20 }}
                            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
                            className="w-full h-full flex items-center justify-center relative"
                            style={blurStyle}
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
                    "space-y-6 transition-all duration-500 ease-in-out overflow-hidden transform hidden lg:block",
                     showInfo ? "lg:opacity-100 lg:translate-x-0" : "lg:opacity-0 lg:translate-x-10 lg:w-0 lg:p-0"
                )}>
                    {showInfo && (
                        <Card className="h-full border-none shadow-none bg-transparent lg:border lg:bg-card lg:shadow-sm">
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
                                <h3 className="font-semibold mb-3 flex items-center gap-2"><Info className="h-4 w-4" /> {t('viewer.exifData')}</h3>
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
                                            <p className="font-medium">f/{image.f_number}</p>
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
                                    {hasExifData(image.color_space) && (
                                        <div>
                                            <p className="text-muted-foreground text-xs">{t('viewer.colorSpace')}</p>
                                            <p className="font-medium">
                                                {image.color_space}
                                                {image.color_space && image.color_space.toLowerCase().includes('p3') && (
                                                    <span className="ml-1.5 inline-block px-1.5 py-0.5 text-[10px] font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300 rounded gamut-p3-badge">
                                                        P3
                                                    </span>
                                                )}
                                            </p>
                                        </div>
                                    )}
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
                                            <p className="text-muted-foreground text-xs">{t('viewer.bitDepth')}</p>
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
                                {image.filename_jpeg && (
                                    <div className="mt-4 border-t pt-4">
                                        <Histogram
                                            imageUrl={imageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${findNearestImageSize(imageSizes, 640)}.jpg`)}`)}
                                            className="w-full"
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
                            <CardFooter>
                                {/* C1RPF-PHOTO-LOW-02: hide the gratis "Download JPEG"
                                    button when the photo is paid (license_tier !==
                                    'none'). Otherwise the photographer's "Buy
                                    ($X)" CTA sits next to a free Download that
                                    serves the same JPEG derivative every visitor
                                    can grab — directly undermining the licensing
                                    intent. The post-purchase download path
                                    (/api/download/[imageId]?token=…) still
                                    delivers the original on legitimate purchase. */}
                                {downloadHref && (!image.license_tier || image.license_tier === 'none') && (
                                    <Button asChild className="w-full gap-2">
                                        <a
                                            href={downloadHref}
                                            download={`photo-${image.id}.${downloadExt}`}
                                        >
                                            <Download className="h-4 w-4" /> {t('viewer.downloadJpeg')}
                                        </a>
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    )}
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
                    reactionsEnabled={reactionsEnabled}
                    reactionCount={reactionCount}
                    liked={liked}
                    onToggleReaction={handleToggleReaction}
                    isReacting={isReacting}
                />
            )}

            <InfoBottomSheet
                image={image}
                isOpen={showBottomSheet}
                onClose={() => setShowBottomSheet(false)}
                isAdmin={isAdmin}
                untitledFallbackTitle={untitledFallbackTitle}
            />
        </div>
    );
}
