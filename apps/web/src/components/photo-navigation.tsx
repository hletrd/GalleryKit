'use client';

import { useCallback, useEffect, useState, useRef, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/components/i18n-provider';
import { localizePath } from '@/lib/locale-path';


interface PhotoNavigationProps {
    prevId: number | null;
    nextId: number | null;
    disabled?: boolean;
    buildPhotoPath?: (id: number) => string;
    onSelectId?: (id: number) => void;
    swipeTargetRef: RefObject<HTMLElement | null>;
}

const SWIPE_THRESHOLD = 80;
const VERTICAL_LIMIT = 30;

export function PhotoNavigation({ prevId, nextId, disabled, buildPhotoPath, onSelectId, swipeTargetRef }: PhotoNavigationProps) {
    const { t, locale } = useTranslation();
    const router = useRouter();
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isSnapping, setIsSnapping] = useState(false);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const isSwiping = useRef(false);

    const getPhotoPath = useCallback((id: number) => (
        buildPhotoPath ? buildPhotoPath(id) : localizePath(locale, `/p/${id}`)
    ), [buildPhotoPath, locale]);

    const goToPhoto = useCallback((id: number) => {
        if (onSelectId) {
            onSelectId(id);
            return;
        }
        router.push(getPhotoPath(id));
    }, [getPhotoPath, onSelectId, router]);

    useEffect(() => {
        // Skip touch handling when lightbox is open — it handles its own navigation
        if (disabled) return;
        const swipeTarget = swipeTargetRef.current;
        if (!swipeTarget) return;

        const handleTouchStart = (e: TouchEvent) => {
            touchStartX.current = e.changedTouches[0].clientX;
            touchStartY.current = e.changedTouches[0].clientY;
            isSwiping.current = false;
            setIsSnapping(false);
        };

        const handleTouchMove = (e: TouchEvent) => {
            const touch = e.changedTouches[0];
            const dx = Math.abs(touch.clientX - touchStartX.current);
            const dy = Math.abs(touch.clientY - touchStartY.current);
            if (dx > dy && dx > 10) {
                e.preventDefault();
            }

            const deltaX = touch.clientX - touchStartX.current;
            const deltaY = touch.clientY - touchStartY.current;

            // Cancel swipe if movement becomes predominantly vertical
            if (isSwiping.current && Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > VERTICAL_LIMIT) {
                setIsSnapping(true);
                setSwipeOffset(0);
                isSwiping.current = false;
                return;
            }

            // Only activate for predominantly horizontal movement
            if (Math.abs(deltaY) > Math.abs(deltaX)) {
                return;
            }

            isSwiping.current = true;

            // Clamp offset: only allow swiping in valid directions
            const clampedOffset = (() => {
                if (deltaX > 0 && !prevId) return 0;
                if (deltaX < 0 && !nextId) return 0;
                // Apply rubber-band resistance beyond threshold
                if (Math.abs(deltaX) > SWIPE_THRESHOLD) {
                    const overshoot = Math.abs(deltaX) - SWIPE_THRESHOLD;
                    const damped = SWIPE_THRESHOLD + overshoot * 0.3;
                    return deltaX > 0 ? damped : -damped;
                }
                return deltaX;
            })();

            setSwipeOffset(clampedOffset);
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (!isSwiping.current) return;

            const deltaX = e.changedTouches[0].clientX - touchStartX.current;
            const deltaY = e.changedTouches[0].clientY - touchStartY.current;

            // Ignore if vertical movement too large
            if (Math.abs(deltaY) > VERTICAL_LIMIT) {
                setIsSnapping(true);
                setSwipeOffset(0);
                isSwiping.current = false;
                return;
            }

            if (deltaX < -SWIPE_THRESHOLD && nextId) {
                // Swipe left -> next photo
                if (typeof navigator.vibrate === 'function') {
                    navigator.vibrate(10);
                }
                goToPhoto(nextId);
            } else if (deltaX > SWIPE_THRESHOLD && prevId) {
                // Swipe right -> prev photo
                if (typeof navigator.vibrate === 'function') {
                    navigator.vibrate(10);
                }
                goToPhoto(prevId);
            } else {
                // Snap back
                setIsSnapping(true);
                setSwipeOffset(0);
            }

            isSwiping.current = false;
        };

        swipeTarget.addEventListener('touchstart', handleTouchStart, { passive: true });
        swipeTarget.addEventListener('touchmove', handleTouchMove, { passive: false });
        swipeTarget.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            swipeTarget.removeEventListener('touchstart', handleTouchStart);
            swipeTarget.removeEventListener('touchmove', handleTouchMove);
            swipeTarget.removeEventListener('touchend', handleTouchEnd);
        };
    }, [goToPhoto, prevId, nextId, disabled, swipeTargetRef]);

    // Opacity of swipe indicators proportional to displacement
    const prevIndicatorOpacity = swipeOffset > 0
        ? Math.min(swipeOffset / SWIPE_THRESHOLD, 1)
        : 0;
    const nextIndicatorOpacity = swipeOffset < 0
        ? Math.min(-swipeOffset / SWIPE_THRESHOLD, 1)
        : 0;

    const transitionStyle = isSnapping
        ? { transition: 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.25s ease' }
        : {};

    return (
        <>
            {/* Swipe feedback: left edge indicator (shows on rightward swipe toward prev) */}
            {prevId && (
                <div
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center justify-center"
                    style={{
                        opacity: prevIndicatorOpacity,
                        transform: `translateY(-50%) translateX(${Math.min(swipeOffset * 0.4, 24)}px)`,
                        ...transitionStyle,
                    }}
                >
                    <div className="h-14 w-14 rounded-full bg-black/60 flex items-center justify-center shadow-lg">
                        <ChevronLeft className="h-7 w-7 text-white" />
                    </div>
                </div>
            )}

            {/* Swipe feedback: right edge indicator (shows on leftward swipe toward next) */}
            {nextId && (
                <div
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center justify-center"
                    style={{
                        opacity: nextIndicatorOpacity,
                        transform: `translateY(-50%) translateX(${Math.max(swipeOffset * 0.4, -24)}px)`,
                        ...transitionStyle,
                    }}
                >
                    <div className="h-14 w-14 rounded-full bg-black/60 flex items-center justify-center shadow-lg">
                        <ChevronRight className="h-7 w-7 text-white" />
                    </div>
                </div>
            )}

            {/* Swipe progress bar — subtle horizontal indicator at bottom */}
            {swipeOffset !== 0 && (
                <div
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
                    style={{
                        opacity: Math.min(Math.abs(swipeOffset) / SWIPE_THRESHOLD, 1) * 0.7,
                        ...transitionStyle,
                    }}
                >
                    <div
                        className="h-1 rounded-full bg-white/70"
                        style={{
                            width: `${Math.min(Math.abs(swipeOffset) / SWIPE_THRESHOLD, 1) * 48}px`,
                            transform: `translateX(${swipeOffset > 0 ? '-25%' : '25%'})`,
                            ...transitionStyle,
                        }}
                    />
                </div>
            )}

            {/* Static navigation buttons (hover on desktop, always visible on mobile).
                R4C1 UX-R4C1-14: z-20, NOT z-10. The photo's AnimatePresence
                wrapper in photo-viewer.tsx gained `z-10` in R10-M11 (blur
                crossfade) and is a LATER sibling of this component, so with
                equal z-index the full-bleed image box painted ABOVE these
                buttons and swallowed every mouse click on Prev/Next (keyboard
                and swipe still worked, which is why it went unnoticed; the
                shared-group e2e click test caught it). z-20 matches the swipe
                indicators above and restores pointer access. */}
            {prevId && (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity z-20">
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70 border-none"
                        onClick={() => goToPhoto(prevId)}
                        aria-label={t('aria.previousPhoto')}
                    >
                        <ChevronLeft className="h-6 w-6" />
                    </Button>
                </div>
            )}

            {nextId && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 transition-opacity z-20">
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70 border-none"
                        onClick={() => goToPhoto(nextId)}
                        aria-label={t('aria.nextPhoto')}
                    >
                        <ChevronRight className="h-6 w-6" />
                    </Button>
                </div>
            )}

            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {prevId !== null || nextId !== null ? t('aria.photoNavStatus') : ''}
            </div>
        </>
    );
}
