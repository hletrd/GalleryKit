'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Maximize, Minimize } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import { Button } from '@/components/ui/button';

interface LightboxProps {
    image: any;
    prevId: number | null;
    nextId: number | null;
    onClose: () => void;
    onNavigate: (direction: number) => void;
}

export function LightboxTrigger({ onClick }: { onClick: () => void }) {
    return (
        <Button variant="ghost" size="icon" onClick={onClick} className="h-8 w-8">
            <Maximize className="h-4 w-4" />
        </Button>
    );
}

export function Lightbox({ image, prevId, nextId, onClose, onNavigate }: LightboxProps) {
    const [controlsVisible, setControlsVisible] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shouldReduceMotion = useReducedMotion();

    const showControls = useCallback(() => {
        setControlsVisible(true);
        if (hideTimer.current) {
            clearTimeout(hideTimer.current);
        }
        hideTimer.current = setTimeout(() => {
            setControlsVisible(false);
        }, 3000);
    }, []);

    useEffect(() => {
        showControls();
        return () => {
            if (hideTimer.current) {
                clearTimeout(hideTimer.current);
            }
        };
    }, [showControls]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'f' || e.key === 'F') {
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
    }, [prevId, nextId, onNavigate, onClose]);

    const toggleFullscreen = useCallback(() => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
        } else {
            document.exitFullscreen().catch(() => {});
        }
    }, []);

    const handleBackdropClick = useCallback(() => {
        showControls();
    }, [showControls]);

    const handleMouseMove = useCallback(() => {
        showControls();
    }, [showControls]);

    const baseAvif = image.filename_avif?.replace(/\.avif$/i, '');
    const baseWebp = image.filename_webp?.replace(/\.webp$/i, '');

    const avifSrcSet = baseAvif
        ? [640, 1536, 2048, 4096]
              .map((w) => `/uploads/avif/${baseAvif}_${w}.avif ${w}w`)
              .join(', ')
        : undefined;

    const webpSrcSet = baseWebp
        ? [640, 1536, 2048, 4096]
              .map((w) => `/uploads/webp/${baseWebp}_${w}.webp ${w}w`)
              .join(', ')
        : undefined;

    const jpegSrc = image.filename_jpeg ? `/uploads/jpeg/${image.filename_jpeg}` : undefined;

    const transitionStyle = shouldReduceMotion
        ? {}
        : { transition: 'opacity 0.2s ease-in-out' };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black"
            onClick={handleBackdropClick}
            onMouseMove={handleMouseMove}
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
                    className="pointer-events-auto absolute top-4 right-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                    onClick={(e) => {
                        e.stopPropagation();
                        if (document.fullscreenElement) {
                            document.exitFullscreen().then(() => onClose()).catch(() => onClose());
                        } else {
                            onClose();
                        }
                    }}
                    aria-label="Close"
                >
                    <X className="h-5 w-5" />
                </button>

                {/* Fullscreen toggle — top right, second from right */}
                <button
                    className="pointer-events-auto absolute top-4 right-16 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
                    onClick={(e) => {
                        e.stopPropagation();
                        toggleFullscreen();
                    }}
                    aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
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
                        aria-label="Previous image"
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
                        aria-label="Next image"
                    >
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
                            <ChevronRight className="h-6 w-6" />
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
}
