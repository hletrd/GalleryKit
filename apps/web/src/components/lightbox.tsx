'use client';

import { useEffect, useRef, useState, useCallback, useMemo, type CSSProperties } from 'react';
import FocusTrap from '@/components/lazy-focus-trap';
import { X, ChevronLeft, ChevronRight, Maximize, Minimize, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImageDetail } from '@/lib/image-types';
import { useTranslation } from '@/components/i18n-provider';
import { toast } from 'sonner';
import { imageUrl } from '@/lib/image-url';
import { isEditableTarget } from '@/components/photo-viewer';
import { DEFAULT_IMAGE_SIZES, findNearestImageSize, SLIDESHOW_INTERVAL_DEFAULT } from '@/lib/gallery-config-shared';
import { getConcisePhotoAltText } from '@/lib/photo-title';
import { HDR_FEATURE_ENABLED } from '@/lib/feature-flags';

interface LightboxProps {
    image: ImageDetail;
    prevId: number | null;
    nextId: number | null;
    onClose: () => void;
    onNavigate: (direction: number) => void;
    onSlideshowAdvance?: () => void;
    imageSizes?: number[];
    slideshowIntervalSeconds?: number;
    currentIndex?: number;
    totalCount?: number;
}

export function shouldAutoHideLightboxControls(hasHover: boolean, hasFinePointer: boolean) {
    return hasHover && hasFinePointer;
}

function getLightboxAutoHidePreference() {
    if (typeof window === 'undefined') {
        return true;
    }

    return shouldAutoHideLightboxControls(
        window.matchMedia('(hover: hover)').matches,
        window.matchMedia('(pointer: fine)').matches
    );
}

export function LightboxTrigger({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <Button variant="ghost" size="icon" onClick={onClick} className="h-11 w-11" aria-label={t('aria.openFullscreen')} aria-keyshortcuts="F" title={`${t('aria.openFullscreen')} (F)`}>
            <Maximize className="h-4 w-4" />
        </Button>
    );
}

/**
 * Deterministically pick a Ken Burns direction variant based on image id.
 * Returns 0 or 1 to alternate direction per image.
 */
export function getKenBurnsVariant(imageId: number): 0 | 1 {
    return (imageId % 2) as 0 | 1;
}

/**
 * Build the CSS transform string for Ken Burns animation start/end.
 * Exported for unit testing.
 */
export function kenBurnsTransform(variant: 0 | 1, phase: 'start' | 'end'): string {
    // variant 0: zoom in from bottom-left, pan toward top-right
    // variant 1: zoom in from top-right, pan toward bottom-left
    if (variant === 0) {
        return phase === 'start'
            ? 'scale(1) translate(0%, 0%)'
            : 'scale(1.08) translate(-2%, -2%)';
    }
    return phase === 'start'
        ? 'scale(1) translate(0%, 0%)'
        : 'scale(1.08) translate(2%, 2%)';
}

export function Lightbox({ image, prevId, nextId, onClose, onNavigate, onSlideshowAdvance, imageSizes = DEFAULT_IMAGE_SIZES, slideshowIntervalSeconds = SLIDESHOW_INTERVAL_DEFAULT, currentIndex, totalCount }: LightboxProps) {
    const { t } = useTranslation();
    const [controlsVisible, setControlsVisible] = useState(true);
    const controlsVisibleRef = useRef(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [shouldAutoHideControls, setShouldAutoHideControls] = useState(getLightboxAutoHidePreference);
    const [isSlideshowActive, setIsSlideshowActive] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastControlRevealRef = useRef(0);
    const [shouldReduceMotion, setShouldReduceMotion] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);
    const slideshowTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // Stable ref so the interval callback always sees the latest advance function
    const onSlideshowAdvanceRef = useRef(onSlideshowAdvance);
    useEffect(() => { onSlideshowAdvanceRef.current = onSlideshowAdvance; }, [onSlideshowAdvance]);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handler = (e: MediaQueryListEvent) => setShouldReduceMotion(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    useEffect(() => {
        const hoverMq = window.matchMedia('(hover: hover)');
        const pointerMq = window.matchMedia('(pointer: fine)');
        const syncPreference = () => {
            const nextShouldAutoHide = shouldAutoHideLightboxControls(hoverMq.matches, pointerMq.matches);
            setShouldAutoHideControls(nextShouldAutoHide);
            if (!nextShouldAutoHide) {
                setControlsVisible(true);
                if (hideTimer.current) {
                    clearTimeout(hideTimer.current);
                    hideTimer.current = null;
                }
            }
        };

        syncPreference();
        hoverMq.addEventListener('change', syncPreference);
        pointerMq.addEventListener('change', syncPreference);

        return () => {
            hoverMq.removeEventListener('change', syncPreference);
            pointerMq.removeEventListener('change', syncPreference);
        };
    }, []);

    // Keep ref in sync with state for use in stable callbacks
    useEffect(() => { controlsVisibleRef.current = controlsVisible; }, [controlsVisible]);

    const showControls = useCallback((forceReset = false) => {
        const now = Date.now();
        // Use ref to avoid stale-closure dependency on controlsVisible.
        // This prevents the callback from being recreated on every auto-hide
        // toggle, which would cause keyboard/wheel handler effects to
        // re-register their event listeners (~100 times in a 5-min slideshow).
        if (!forceReset && controlsVisibleRef.current && now - lastControlRevealRef.current < 500) {
            return;
        }
        lastControlRevealRef.current = now;
        controlsVisibleRef.current = true;
        setControlsVisible(true);
        if (!shouldAutoHideControls) {
            if (hideTimer.current) {
                clearTimeout(hideTimer.current);
                hideTimer.current = null;
            }
            return;
        }
        if (hideTimer.current) {
            clearTimeout(hideTimer.current);
        }
        hideTimer.current = setTimeout(() => {
            if (dialogRef.current?.contains(document.activeElement)) {
                controlsVisibleRef.current = true;
                setControlsVisible(true);
                return;
            }
            controlsVisibleRef.current = false;
            setControlsVisible(false);
        }, 3000);
    }, [shouldAutoHideControls]);

    // Slideshow timer: start/stop based on isSlideshowActive
    useEffect(() => {
        if (!isSlideshowActive) {
            if (slideshowTimerRef.current) {
                clearInterval(slideshowTimerRef.current);
                slideshowTimerRef.current = null;
            }
            return;
        }
        slideshowTimerRef.current = setInterval(() => {
            onSlideshowAdvanceRef.current?.();
        }, slideshowIntervalSeconds * 1000);
        return () => {
            if (slideshowTimerRef.current) {
                clearInterval(slideshowTimerRef.current);
                slideshowTimerRef.current = null;
            }
        };
    }, [isSlideshowActive, slideshowIntervalSeconds]);

    // Stop slideshow when lightbox unmounts
    useEffect(() => {
        return () => {
            if (slideshowTimerRef.current) {
                clearInterval(slideshowTimerRef.current);
                slideshowTimerRef.current = null;
            }
        };
    }, []);

    // Swipe navigation for mobile
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        showControls(true);
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    }, [showControls]);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        // Guard against cancelled touches where changedTouches is empty
        // (e.g., iOS system gesture interruption).
        if (!e.changedTouches[0]) return;
        const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
        const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
        const dt = Date.now() - touchStartRef.current.time;
        touchStartRef.current = null;
        // Stop slideshow on touch input
        setIsSlideshowActive(false);
        // Only trigger on horizontal swipe (dx > dy) with enough distance or velocity
        if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 50 || Math.abs(dx) / dt > 0.3)) {
            if (dx > 0 && prevId !== null) onNavigate(-1);
            else if (dx < 0 && nextId !== null) onNavigate(1);
        }
    }, [prevId, nextId, onNavigate]);

    // On mount, controls are already visible (initial state), so just arm the
    // auto-hide timer. Calling setControlsVisible here would trip the
    // react-hooks/set-state-in-effect rule for no practical gain.
    useEffect(() => {
        if (!shouldAutoHideControls) {
            if (hideTimer.current) {
                clearTimeout(hideTimer.current);
                hideTimer.current = null;
            }
            return;
        }

        hideTimer.current = setTimeout(() => {
            if (dialogRef.current?.contains(document.activeElement)) {
                controlsVisibleRef.current = true;
                setControlsVisible(true);
                return;
            }
            controlsVisibleRef.current = false;
            setControlsVisible(false);
        }, 3000);
        return () => {
            if (hideTimer.current) {
                clearTimeout(hideTimer.current);
            }
        };
    }, [shouldAutoHideControls]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Reset auto-hide timer on scroll/wheel events
    useEffect(() => {
        const handleWheel = () => {
            showControls(true);
        };
        window.addEventListener('wheel', handleWheel, { passive: true });
        return () => {
            window.removeEventListener('wheel', handleWheel);
        };
    }, [showControls]);

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {
                toast.error(t('viewer.fullscreenUnavailable'));
            });
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }, [t]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Space key toggles slideshow — don't reset controls or stop slideshow
            if (e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                if (isEditableTarget(e)) return;
                setIsSlideshowActive(prev => !prev);
                showControls(true);
                return;
            }
            // Any other key interaction resets the auto-hide timer and stops slideshow
            showControls(true);
            setIsSlideshowActive(false);
            // Only stop propagation for keys we handle
            if (['f', 'F', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) {
                e.stopPropagation();
            }
            if (e.key === 'f' || e.key === 'F') {
                if (isEditableTarget(e)) return;
                toggleFullscreen();
            } else if (e.key === 'ArrowLeft' && prevId !== null) {
                onNavigate(-1);
            } else if (e.key === 'ArrowRight' && nextId !== null) {
                onNavigate(1);
            } else if (e.key === 'Escape') {
                if (!document.fullscreenElement) {
                    onClose();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [prevId, nextId, onNavigate, onClose, toggleFullscreen, showControls]);

    const handleBackdropClick = useCallback(() => {
        setIsSlideshowActive(false);
        onClose();
    }, [onClose]);

    const handleMouseMove = useCallback(() => {
        showControls();
    }, [showControls]);

    const controlVisibilityProps = controlsVisible
        ? {}
        : { tabIndex: -1, 'aria-hidden': true as const };

    const { avifSrcSet, webpSrcSet, jpegSrc, hdrAvifSrcSet } = useMemo(() => {
        const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');
        const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');

        const avifSrcSet = baseAvif
            ? imageSizes
                  .map((w) => `${imageUrl(`/uploads/avif/${baseAvif}_${w}.avif`)} ${w}w`)
                  .join(', ')
            : undefined;

        const hdrAvifSrcSet = baseAvif && image.is_hdr
            ? imageSizes
                  .map((w) => `${imageUrl(`/uploads/avif/${baseAvif}_hdr_${w}.avif`)} ${w}w`)
                  .join(', ')
            : undefined;

        const webpSrcSet = baseWebp
            ? imageSizes
                  .map((w) => `${imageUrl(`/uploads/webp/${baseWebp}_${w}.webp`)} ${w}w`)
                  .join(', ')
            : undefined;

        // Use a medium-sized JPEG fallback instead of the base filename (largest size)
        // to avoid loading full-resolution images for browsers without WebP/AVIF support.
        const jpegSize = imageSizes.length >= 3 ? imageSizes[imageSizes.length - 2] : findNearestImageSize(imageSizes, 1536);
        const jpegSrc = image.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg.replace(/\.jpg$/i, `_${jpegSize}.jpg`)}`) : undefined;

        return { avifSrcSet, webpSrcSet, jpegSrc, hdrAvifSrcSet };
    }, [image.filename_avif, image.filename_webp, image.filename_jpeg, image.is_hdr, imageSizes]);

    const transitionStyle = shouldReduceMotion
        ? {}
        : { transition: 'opacity 0.2s ease-in-out' };

    // Ken Burns animation parameters
    const kenBurnsVariant = getKenBurnsVariant(image.id);
    const kenBurnsStart = kenBurnsTransform(kenBurnsVariant, 'start');
    const kenBurnsEnd = kenBurnsTransform(kenBurnsVariant, 'end');
    const kenBurnsDuration = `${slideshowIntervalSeconds + 2}s`;

    // Lock body scroll and manage focus when lightbox is open
    useEffect(() => {
        const prev = document.body.style.overflow;
        previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        document.body.style.overflow = 'hidden';
        closeButtonRef.current?.focus();
        return () => {
            document.body.style.overflow = prev;
            if (previouslyFocusedRef.current && document.body.contains(previouslyFocusedRef.current)) {
                previouslyFocusedRef.current.focus();
            }
        };
    }, []);

    return (
        <FocusTrap focusTrapOptions={{ allowOutsideClick: true, fallbackFocus: () => closeButtonRef.current || document.body }}>
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={t('aria.lightbox')}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black overflow-hidden"
            onClick={handleBackdropClick}
            onMouseMove={handleMouseMove}
            onFocusCapture={() => showControls(true)}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Accessible live region for slideshow state changes */}
            <div aria-live="polite" aria-atomic="true" className="sr-only">
                {isSlideshowActive ? t('viewer.slideshowOn') : ''}
            </div>

            {/* Image with Ken Burns effect when slideshow is active */}
            <picture
                className="w-full h-full flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
                style={
                    isSlideshowActive && !shouldReduceMotion
                        ? {
                            animation: `none`,
                            transformOrigin: 'center center',
                        }
                        : undefined
                }
            >
                {HDR_FEATURE_ENABLED && image.is_hdr && hdrAvifSrcSet && (
                    <source
                        type="image/avif"
                        srcSet={hdrAvifSrcSet}
                        sizes="100vw"
                        media="(dynamic-range: high)"
                    />
                )}
                {avifSrcSet && (
                    <source
                        type="image/avif"
                        srcSet={avifSrcSet}
                        sizes="100vw"
                    />
                )}
                {webpSrcSet && (
                    <source
                        type="image/webp"
                        srcSet={webpSrcSet}
                        sizes="100vw"
                    />
                )}
                <img
                    src={jpegSrc}
                    alt={getConcisePhotoAltText(image, t('common.photo'))}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain"
                    draggable={false}
                    aria-label={
                        currentIndex != null && totalCount != null
                            ? `${currentIndex + 1} / ${totalCount}`
                            : undefined
                    }
                    style={
                        isSlideshowActive && !shouldReduceMotion
                            ? {
                                animation: `lightbox-ken-burns-${kenBurnsVariant} ${kenBurnsDuration} ease-in-out forwards`,
                                transformOrigin: 'center center',
                                '--kb-start': kenBurnsStart,
                                '--kb-end': kenBurnsEnd,
                            } as CSSProperties
                            : undefined
                    }
                />
            </picture>

            {/* Controls overlay */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    opacity: controlsVisible ? 1 : 0,
                    ...transitionStyle,
                }}
            >
                {/* Close button — top right */}
                <button
                    ref={closeButtonRef}
                    {...controlVisibilityProps}
                    className="pointer-events-auto absolute top-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsSlideshowActive(false);
                        if (document.fullscreenElement) {
                            document.exitFullscreen().then(() => onClose()).catch(() => onClose());
                        } else {
                            onClose();
                        }
                    }}
                    aria-label={t('aria.close')}
                    aria-keyshortcuts="Escape"
                    title={`${t('aria.close')} (Esc)`}
                >
                    <X className="h-5 w-5" />
                </button>

                {/* Fullscreen toggle — top right, second from right */}
                <button
                    {...controlVisibilityProps}
                    className="pointer-events-auto absolute top-4 right-16 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsSlideshowActive(false);
                        toggleFullscreen();
                    }}
                    aria-label={isFullscreen ? t('aria.exitFullscreen') : t('aria.openFullscreen')}
                    aria-keyshortcuts="F"
                    title={`${isFullscreen ? t('aria.exitFullscreen') : t('aria.openFullscreen')} (F)`}
                >
                    {isFullscreen ? (
                        <Minimize className="h-5 w-5" />
                    ) : (
                        <Maximize className="h-5 w-5" />
                    )}
                </button>

                {/* Play/Pause slideshow — top right, third from right.
                    C9RPF-MED-03: hide when only one image is available
                    because a slideshow cycling through a single photo
                    does nothing meaningful and confuses the user. */}
                {totalCount != null && totalCount > 1 && (
                <button
                    {...controlVisibilityProps}
                    className="pointer-events-auto absolute top-4 right-[7.5rem] z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400"
                    onClick={(e) => {
                        e.stopPropagation();
                        setIsSlideshowActive(prev => !prev);
                        showControls(true);
                    }}
                    aria-label={isSlideshowActive ? t('aria.pauseSlideshow') : t('aria.playSlideshow')}
                    aria-keyshortcuts="Space"
                    aria-pressed={isSlideshowActive}
                    title={`${isSlideshowActive ? t('aria.pauseSlideshow') : t('aria.playSlideshow')} (Space)`}
                >
                    {isSlideshowActive ? (
                        <Pause className="h-5 w-5" />
                    ) : (
                        <Play className="h-5 w-5" />
                    )}
                </button>
                )}

                {/* Prev button — left edge */}
                {prevId !== null && (
                    <button
                        {...controlVisibilityProps}
                        className="pointer-events-auto absolute left-0 top-0 h-full w-16 flex items-center justify-center text-white hover:bg-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsSlideshowActive(false);
                            onNavigate(-1);
                        }}
                        aria-label={t('aria.previousImage')}
                        aria-keyshortcuts="ArrowLeft"
                        title={`${t('aria.previousImage')} (←)`}
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                            <ChevronLeft className="h-6 w-6" />
                        </span>
                    </button>
                )}

                {/* Next button — right edge */}
                {nextId !== null && (
                    <button
                        {...controlVisibilityProps}
                        className="pointer-events-auto absolute right-0 top-0 h-full w-16 flex items-center justify-center text-white hover:bg-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsSlideshowActive(false);
                            onNavigate(1);
                        }}
                        aria-label={t('aria.nextImage')}
                        aria-keyshortcuts="ArrowRight"
                        title={`${t('aria.nextImage')} (→)`}
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                            <ChevronRight className="h-6 w-6" />
                        </span>
                    </button>
                )}

                {/* Position counter — bottom center */}
                {currentIndex != null && totalCount != null && totalCount > 1 && (
                    <div
                        {...controlVisibilityProps}
                        className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-xs px-3 py-1 rounded-full z-10"
                        role="status"
                        aria-live="polite"
                    >
                        {currentIndex + 1} / {totalCount}
                    </div>
                )}
            </div>
        </div>
        </FocusTrap>
    );
}
