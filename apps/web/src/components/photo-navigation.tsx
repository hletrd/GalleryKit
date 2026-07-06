'use client';

import { useCallback, useEffect, useLayoutEffect, useState, useRef, type RefObject } from 'react';
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
    const [shouldReduceMotion, setShouldReduceMotion] = useState(
        () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
    const touchStartX = useRef(0);
    const touchStartY = useRef(0);
    const isSwiping = useRef(false);
    // C2-18 (run-10 c2): swipe-feedback visuals are driven imperatively via
    // these refs so a per-frame touchmove writes opacity/transform/width
    // straight to the nodes instead of re-rendering the whole component on
    // every move. The offset lives in a ref; React state only holds the
    // reduced-motion preference.
    const prevIndicatorRef = useRef<HTMLDivElement>(null);
    const nextIndicatorRef = useRef<HTMLDivElement>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const progressBarInnerRef = useRef<HTMLDivElement>(null);

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

    const vibrateForSwipe = useCallback(() => {
        if (shouldReduceMotion || typeof navigator.vibrate !== 'function') return;
        navigator.vibrate(10);
    }, [shouldReduceMotion]);

    // C2-18 (run-10 c2): apply swipe-feedback visuals imperatively — a verbatim
    // reproduction of the previous swipeOffset-derived inline styles, written
    // to refs instead of through React state so touchmove never re-renders.
    // `animate` maps to the previous isSnapping transition (settle animations
    // on touchend/cancel; immediate follow during an active drag).
    const applySwipeVisuals = useCallback((offset: number, animate: boolean) => {
        const transition = animate && !shouldReduceMotion
            ? 'transform 0.25s cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 0.25s ease'
            : '';
        const magnitude = Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1);
        const prevEl = prevIndicatorRef.current;
        if (prevEl) {
            prevEl.style.transition = transition;
            prevEl.style.opacity = String(offset > 0 ? Math.min(offset / SWIPE_THRESHOLD, 1) : 0);
            prevEl.style.transform = `translateY(-50%) translateX(${Math.min(offset * 0.4, 24)}px)`;
        }
        const nextEl = nextIndicatorRef.current;
        if (nextEl) {
            nextEl.style.transition = transition;
            nextEl.style.opacity = String(offset < 0 ? Math.min(-offset / SWIPE_THRESHOLD, 1) : 0);
            nextEl.style.transform = `translateY(-50%) translateX(${Math.max(offset * 0.4, -24)}px)`;
        }
        const barEl = progressBarRef.current;
        if (barEl) {
            barEl.style.transition = transition;
            barEl.style.opacity = String(magnitude * 0.7);
        }
        const barInnerEl = progressBarInnerRef.current;
        if (barInnerEl) {
            barInnerEl.style.transition = transition;
            barInnerEl.style.width = `${magnitude * 48}px`;
            barInnerEl.style.transform = `translateX(${offset > 0 ? '-25%' : '25%'})`;
        }
    }, [shouldReduceMotion]);

    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        const handler = (event: MediaQueryListEvent) => setShouldReduceMotion(event.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // DBG3-01 / C3-13 (run-10 c3): re-assert the resting visuals whenever the
    // displayed photo changes. The indicator JSX carries STATIC style
    // literals, so React's props diff sees no change across re-renders and
    // never clears the imperatively-written drag styles — on an IN-PLACE
    // photo switch (shared-group view wires onSelectId=setCurrentImageId, no
    // navigation/remount) the swiped-from edge glow would otherwise persist
    // over the newly displayed photo until the next gesture. Keyed on
    // prevId/nextId (they change with the displayed photo) so ANY switch
    // path — swipe, buttons, keyboard — resets the visuals. Mirrors the
    // info-bottom-sheet.tsx useLayoutEffect idiom from the same refactor
    // cycle (fc21007a).
    useLayoutEffect(() => {
        applySwipeVisuals(0, false);
        isSwiping.current = false;
    }, [prevId, nextId, applySwipeVisuals]);

    useEffect(() => {
        // Skip touch handling when lightbox is open — it handles its own navigation
        if (disabled) return;
        const swipeTarget = swipeTargetRef.current;
        if (!swipeTarget) return;

        const handleTouchStart = (e: TouchEvent) => {
            touchStartX.current = e.changedTouches[0].clientX;
            touchStartY.current = e.changedTouches[0].clientY;
            isSwiping.current = false;
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

            const resetSwipe = () => {
                applySwipeVisuals(0, true);
                isSwiping.current = false;
            };

            // Cancel swipe if movement becomes predominantly vertical
            if (isSwiping.current && Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > VERTICAL_LIMIT) {
                resetSwipe();
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

            applySwipeVisuals(clampedOffset, false);
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (!isSwiping.current) return;

            const deltaX = e.changedTouches[0].clientX - touchStartX.current;
            const deltaY = e.changedTouches[0].clientY - touchStartY.current;

            // Ignore if vertical movement too large
            if (Math.abs(deltaY) > VERTICAL_LIMIT) {
                applySwipeVisuals(0, true);
                isSwiping.current = false;
                return;
            }

            if (deltaX < -SWIPE_THRESHOLD && nextId) {
                // Swipe left -> next photo. DBG3-01 / C3-13 (run-10 c3):
                // reset the visuals in the SUCCESS branches too — on an
                // in-place photo switch (shared-group onSelectId path) the
                // component does not remount, and the static JSX style
                // literals mean React never clears the drag styles.
                applySwipeVisuals(0, true);
                vibrateForSwipe();
                goToPhoto(nextId);
            } else if (deltaX > SWIPE_THRESHOLD && prevId) {
                // Swipe right -> prev photo (same reset rationale as above).
                applySwipeVisuals(0, true);
                vibrateForSwipe();
                goToPhoto(prevId);
            } else {
                // Snap back
                applySwipeVisuals(0, true);
            }

            isSwiping.current = false;
        };

        const handleTouchCancel = () => {
            applySwipeVisuals(0, true);
            isSwiping.current = false;
        };

        swipeTarget.addEventListener('touchstart', handleTouchStart, { passive: true });
        swipeTarget.addEventListener('touchmove', handleTouchMove, { passive: false });
        swipeTarget.addEventListener('touchend', handleTouchEnd, { passive: true });
        swipeTarget.addEventListener('touchcancel', handleTouchCancel, { passive: true });

        return () => {
            swipeTarget.removeEventListener('touchstart', handleTouchStart);
            swipeTarget.removeEventListener('touchmove', handleTouchMove);
            swipeTarget.removeEventListener('touchend', handleTouchEnd);
            swipeTarget.removeEventListener('touchcancel', handleTouchCancel);
        };
    }, [goToPhoto, prevId, nextId, disabled, swipeTargetRef, vibrateForSwipe, applySwipeVisuals]);

    return (
        <>
            {/* Swipe feedback: left edge indicator (shows on rightward swipe toward prev).
                C2-18 (run-10 c2): opacity/transform written imperatively via
                applySwipeVisuals during a drag; the initial inline style holds
                the resting (invisible) state. */}
            {prevId && (
                <div
                    ref={prevIndicatorRef}
                    data-testid="swipe-prev-indicator"
                    className="absolute left-4 top-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center justify-center"
                    style={{ opacity: 0, transform: 'translateY(-50%) translateX(0px)' }}
                >
                    <div className="h-14 w-14 rounded-full bg-black/60 flex items-center justify-center shadow-lg">
                        <ChevronLeft className="h-7 w-7 text-white" />
                    </div>
                </div>
            )}

            {/* Swipe feedback: right edge indicator (shows on leftward swipe toward next) */}
            {nextId && (
                <div
                    ref={nextIndicatorRef}
                    data-testid="swipe-next-indicator"
                    className="absolute right-4 top-1/2 -translate-y-1/2 z-20 pointer-events-none flex items-center justify-center"
                    style={{ opacity: 0, transform: 'translateY(-50%) translateX(0px)' }}
                >
                    <div className="h-14 w-14 rounded-full bg-black/60 flex items-center justify-center shadow-lg">
                        <ChevronRight className="h-7 w-7 text-white" />
                    </div>
                </div>
            )}

            {/* Swipe progress bar — subtle horizontal indicator at bottom.
                C2-18 (run-10 c2): always mounted (was gated on swipeOffset !== 0)
                so applySwipeVisuals can drive it imperatively; it stays invisible
                (opacity 0 / width 0) and pointer-events-none at rest. */}
            <div
                ref={progressBarRef}
                className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none"
                style={{ opacity: 0 }}
            >
                <div
                    ref={progressBarInnerRef}
                    className="h-1 rounded-full bg-white/70"
                    style={{ width: '0px', transform: 'translateX(-25%)' }}
                />
            </div>

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
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 z-20 ${shouldReduceMotion ? '' : 'transition-opacity'}`}>
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
                <div className={`absolute right-4 top-1/2 -translate-y-1/2 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 z-20 ${shouldReduceMotion ? '' : 'transition-opacity'}`}>
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
