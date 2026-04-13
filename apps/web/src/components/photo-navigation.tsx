'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/components/i18n-provider';

interface PhotoNavigationProps {
    prevId: number | null;
    nextId: number | null;
}

const SWIPE_THRESHOLD = 80;
const VERTICAL_LIMIT = 30;

export function PhotoNavigation({ prevId, nextId }: PhotoNavigationProps) {
    const { t, locale } = useTranslation();
    const router = useRouter();
    const [swipeOffset, setSwipeOffset] = useState(0);
    const [isSnapping, setIsSnapping] = useState(false);
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const isSwiping = useRef(false);

    useEffect(() => {
        const handleTouchStart = (e: TouchEvent) => {
            touchStartX.current = e.changedTouches[0].screenX;
            touchStartY.current = e.changedTouches[0].screenY;
            isSwiping.current = false;
            setIsSnapping(false);
        };

        const handleTouchMove = (e: TouchEvent) => {
            const deltaX = e.changedTouches[0].screenX - touchStartX.current;
            const deltaY = e.changedTouches[0].screenY - touchStartY.current;

            // Only handle horizontal swipes where vertical movement is minimal
            if (Math.abs(deltaY) > VERTICAL_LIMIT && !isSwiping.current) {
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

            const deltaX = e.changedTouches[0].screenX - touchStartX.current;
            const deltaY = e.changedTouches[0].screenY - touchStartY.current;

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
                router.push(`/${locale}/p/${nextId}`);
            } else if (deltaX > SWIPE_THRESHOLD && prevId) {
                // Swipe right -> prev photo
                if (typeof navigator.vibrate === 'function') {
                    navigator.vibrate(10);
                }
                router.push(`/${locale}/p/${prevId}`);
            } else {
                // Snap back
                setIsSnapping(true);
                setSwipeOffset(0);
            }

            isSwiping.current = false;
        };

        window.addEventListener('touchstart', handleTouchStart, { passive: true });
        window.addEventListener('touchmove', handleTouchMove, { passive: true });
        window.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            window.removeEventListener('touchstart', handleTouchStart);
            window.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [locale, prevId, nextId, router]);

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

            {/* Static navigation buttons (hover on desktop, always visible on mobile) */}
            {prevId && (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity z-10">
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70 border-none"
                        onClick={() => router.push(`/${locale}/p/${prevId}`)}
                        aria-label={t('aria.previousPhoto')}
                    >
                        <ChevronLeft className="h-6 w-6" />
                    </Button>
                </div>
            )}

            {nextId && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity z-10">
                    <Button
                        variant="secondary"
                        size="icon"
                        className="h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70 border-none"
                        onClick={() => router.push(`/${locale}/p/${nextId}`)}
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
