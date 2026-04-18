'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import FocusTrap from 'focus-trap-react';
import { X, ChevronLeft, ChevronRight, Maximize, Minimize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImageDetail } from '@/lib/image-types';
import { useTranslation } from '@/components/i18n-provider';
import { imageUrl } from '@/lib/image-url';

interface LightboxProps {
    image: ImageDetail;
    prevId: number | null;
    nextId: number | null;
    onClose: () => void;
    onNavigate: (direction: number) => void;
}

export function LightboxTrigger({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation();
    return (
        <Button variant="ghost" size="icon" onClick={onClick} className="h-8 w-8" aria-label={t('aria.openFullscreen')}>
            <Maximize className="h-4 w-4" />
        </Button>
    );
}

export function Lightbox({ image, prevId, nextId, onClose, onNavigate }: LightboxProps) {
    const { t } = useTranslation();
    const [controlsVisible, setControlsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [shouldReduceMotion, setShouldReduceMotion] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
    const closeButtonRef = useRef<HTMLButtonElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handler = (e: MediaQueryListEvent) => setShouldReduceMotion(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // Swipe navigation for mobile
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, time: Date.now() };
    }, []);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        if (!touchStartRef.current) return;
        const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
        const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
        const dt = Date.now() - touchStartRef.current.time;
        touchStartRef.current = null;
        // Only trigger on horizontal swipe (dx > dy) with enough distance or velocity
        if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 50 || Math.abs(dx) / dt > 0.3)) {
            if (dx > 0 && prevId !== null) onNavigate(-1);
            else if (dx < 0 && nextId !== null) onNavigate(1);
        }
    }, [prevId, nextId, onNavigate]);

    const showControls = useCallback(() => {
        setControlsVisible(true);
        if (hideTimer.current) {
            clearTimeout(hideTimer.current);
        }
        hideTimer.current = setTimeout(() => {
            setControlsVisible(false);
        }, 3000);
    }, []);

    // On mount, controls are already visible (initial state), so just arm the
    // auto-hide timer. Calling setControlsVisible here would trip the
    // react-hooks/set-state-in-effect rule for no practical gain.
    useEffect(() => {
        hideTimer.current = setTimeout(() => {
            setControlsVisible(false);
        }, 3000);
        return () => {
            if (hideTimer.current) {
                clearTimeout(hideTimer.current);
            }
        };
    }, []);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Only stop propagation for keys we handle
            if (['f', 'F', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) {
                e.stopPropagation();
            }
            if (e.key === 'f' || e.key === 'F') {
                if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
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
    }, [prevId, nextId, onNavigate, onClose, toggleFullscreen]);

    const handleBackdropClick = useCallback(() => {
        onClose();
    }, [onClose]);

    const handleMouseMove = useCallback(() => {
        showControls();
    }, [showControls]);

    const { avifSrcSet, webpSrcSet, jpegSrc } = useMemo(() => {
        const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');
        const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');

        const avifSrcSet = baseAvif
            ? [640, 1536, 2048, 4096]
                  .map((w) => `${imageUrl(`/uploads/avif/${baseAvif}_${w}.avif`)} ${w}w`)
                  .join(', ')
            : undefined;

        const webpSrcSet = baseWebp
            ? [640, 1536, 2048, 4096]
                  .map((w) => `${imageUrl(`/uploads/webp/${baseWebp}_${w}.webp`)} ${w}w`)
                  .join(', ')
            : undefined;

        const jpegSrc = image.filename_jpeg ? imageUrl(`/uploads/jpeg/${image.filename_jpeg}`) : undefined;

        return { avifSrcSet, webpSrcSet, jpegSrc };
    }, [image.filename_avif, image.filename_webp, image.filename_jpeg]);

    const transitionStyle = shouldReduceMotion
        ? {}
        : { transition: 'opacity 0.2s ease-in-out' };

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
            previouslyFocusedRef.current?.focus();
        };
    }, []);

    return (
        <FocusTrap focusTrapOptions={{ allowOutsideClick: true }}>
        <div
            role="dialog"
            aria-modal="true"
            aria-label={t('aria.lightbox')}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black"
            onClick={handleBackdropClick}
            onMouseMove={handleMouseMove}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
        >
            {/* Image */}
            <picture className="w-full h-full flex items-center justify-center">
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
                    alt={image.title ?? image.filename_jpeg ?? ''}
                    width={image.width}
                    height={image.height}
                    className="w-full h-full object-contain"
                    draggable={false}
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
                    className="pointer-events-auto absolute top-4 right-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (document.fullscreenElement) {
                            document.exitFullscreen().then(() => onClose()).catch(() => onClose());
                        } else {
                            onClose();
                        }
                    }}
                    aria-label={t('aria.close')}
                >
                    <X className="h-5 w-5" />
                </button>

                {/* Fullscreen toggle — top right, second from right */}
                <button
                    className="pointer-events-auto absolute top-4 right-16 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleFullscreen();
                    }}
                    aria-label={isFullscreen ? t('viewer.fullscreen') : t('aria.openFullscreen')}
                >
                    {isFullscreen ? (
                        <Minimize className="h-5 w-5" />
                    ) : (
                        <Maximize className="h-5 w-5" />
                    )}
                </button>

                {/* Prev button — left edge */}
                {prevId !== null && (
                    <button
                        className="pointer-events-auto absolute left-0 top-0 h-full w-16 flex items-center justify-center text-white hover:bg-black/20"
                        onClick={(e) => {
                            e.stopPropagation();
                            onNavigate(-1);
                        }}
                        aria-label={t('aria.previousImage')}
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                            <ChevronLeft className="h-6 w-6" />
                        </span>
                    </button>
                )}

                {/* Next button — right edge */}
                {nextId !== null && (
                    <button
                        className="pointer-events-auto absolute right-0 top-0 h-full w-16 flex items-center justify-center text-white hover:bg-black/20"
                        onClick={(e) => {
                            e.stopPropagation();
                            onNavigate(1);
                        }}
                        aria-label={t('aria.nextImage')}
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                            <ChevronRight className="h-6 w-6" />
                        </span>
                    </button>
                )}
            </div>
        </div>
        </FocusTrap>
    );
}
