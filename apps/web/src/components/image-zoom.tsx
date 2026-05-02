'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/components/i18n-provider';

interface ImageZoomProps {
    children: React.ReactNode;
    className?: string;
}

const MIN_ZOOM = 1.0;
const MAX_ZOOM = 5.0;
const DOUBLE_TAP_MS = 300;
const DEFAULT_ZOOM = 2.5;
const SNAP_THRESHOLD = 1.1;

/** Euclidean distance between two touch points. */
function touchDistance(t0: React.Touch, t1: React.Touch): number {
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

/** Midpoint between two touch points, in client coordinates. */
function touchMidpoint(t0: React.Touch, t1: React.Touch): { x: number; y: number } {
    return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
}

/**
 * Compute the clamped pan position after a zoom or pan operation.
 * x/y are expressed as percentages of the container size.
 */
function clampPan(x: number, y: number): { x: number; y: number } {
    return {
        x: Math.max(-100, Math.min(100, x)),
        y: Math.max(-100, Math.min(100, y)),
    };
}

export function ImageZoom({ children, className }: ImageZoomProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [isZoomed, setIsZoomed] = useState(false);
    const lastTapRef = useRef(0);
    const positionRef = useRef({ x: 0, y: 0 });

    // Current zoom level (continuous)
    const zoomLevelRef = useRef(MIN_ZOOM);
    // Last intentional pinch zoom level (for double-tap toggle target)
    const lastPinchLevelRef = useRef(DEFAULT_ZOOM);

    // Mouse drag state
    const mouseDownRef = useRef(false);
    const mouseDragStartRef = useRef({ x: 0, y: 0 });
    const mouseHasMovedRef = useRef(false);
    const [isMouseDragging, setIsMouseDragging] = useState(false);

    // Touch drag state (single-finger pan)
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });

    // Pinch state
    const isPinchingRef = useRef(false);
    const pinchStartDistanceRef = useRef(0);
    const pinchStartZoomRef = useRef(MIN_ZOOM);
    const pinchMidpointRef = useRef({ x: 0, y: 0 });
    const pinchStartPositionRef = useRef({ x: 0, y: 0 });

    // Reduced motion check (ref, no state — avoids re-renders)
    const reducedMotionRef = useRef(false);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        reducedMotionRef.current = mq.matches;
        const handler = (e: MediaQueryListEvent) => { reducedMotionRef.current = e.matches; };
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // Apply transform directly to DOM to avoid re-renders on every move
    const applyTransform = useCallback((level: number, x: number, y: number, animate = false) => {
        if (!innerRef.current) return;
        if (animate && !reducedMotionRef.current) {
            innerRef.current.style.transition = 'transform 0.2s ease-out';
        } else {
            innerRef.current.style.transition = 'none';
        }
        if (level <= 1) {
            innerRef.current.style.transform = 'scale(1) translate(0%, 0%)';
        } else {
            innerRef.current.style.transform = `scale(${level}) translate(${x / level}%, ${y / level}%)`;
        }
    }, []);

    const resetZoom = useCallback((animate = true) => {
        zoomLevelRef.current = MIN_ZOOM;
        positionRef.current = { x: 0, y: 0 };
        setIsZoomed(false);
        applyTransform(MIN_ZOOM, 0, 0, animate);
    }, [applyTransform]);

    // --- Mouse wheel zoom ---
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            const currentLevel = zoomLevelRef.current;
            // Only intercept when already zoomed or zooming in
            const wouldZoomIn = e.deltaY < 0;
            if (currentLevel <= MIN_ZOOM && !wouldZoomIn) return;

            e.preventDefault();
            e.stopPropagation();

            const factor = e.deltaY > 0 ? 0.9 : 1.1;
            const newLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, currentLevel * factor));

            if (newLevel <= MIN_ZOOM) {
                resetZoom(false);
                return;
            }

            // Anchor zoom to cursor position within container
            const rect = container.getBoundingClientRect();
            const cursorXPct = ((e.clientX - rect.left) / rect.width - 0.5) * -100;
            const cursorYPct = ((e.clientY - rect.top) / rect.height - 0.5) * -100;

            // Adjust pan so the cursor-anchor point stays fixed
            const scaleRatio = newLevel / currentLevel;
            const { x, y } = positionRef.current;
            const newX = cursorXPct + (x - cursorXPct) * scaleRatio;
            const newY = cursorYPct + (y - cursorYPct) * scaleRatio;
            const clamped = clampPan(newX, newY);

            zoomLevelRef.current = newLevel;
            positionRef.current = clamped;
            setIsZoomed(true);
            applyTransform(newLevel, clamped.x, clamped.y, false);
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, [applyTransform, resetZoom]);

    // --- Mouse drag pan when zoomed ---
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (zoomLevelRef.current <= MIN_ZOOM) return;
        // Only left button
        if (e.button !== 0) return;
        e.preventDefault();
        mouseDownRef.current = true;
        mouseHasMovedRef.current = false;
        setIsMouseDragging(true);
        mouseDragStartRef.current = {
            x: e.clientX - positionRef.current.x,
            y: e.clientY - positionRef.current.y,
        };
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!mouseDownRef.current || zoomLevelRef.current <= MIN_ZOOM) return;
        mouseHasMovedRef.current = true;
        const clamped = clampPan(
            e.clientX - mouseDragStartRef.current.x,
            e.clientY - mouseDragStartRef.current.y,
        );
        positionRef.current = clamped;
        applyTransform(zoomLevelRef.current, clamped.x, clamped.y, false);
    }, [applyTransform]);

    const handleMouseUp = useCallback(() => {
        mouseDownRef.current = false;
        setIsMouseDragging(false);
    }, []);

    // Global mouseup to end drag even if mouse leaves container
    useEffect(() => {
        const up = () => {
            mouseDownRef.current = false;
            setIsMouseDragging(false);
        };
        window.addEventListener('mouseup', up);
        return () => window.removeEventListener('mouseup', up);
    }, []);

    // --- Click to toggle zoom (desktop) ---
    const handleClick = useCallback((e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('a, button, [role="button"], input, textarea, select')) return;
        // If we were drag-panning, don't treat mouseup as a click
        if (mouseHasMovedRef.current) {
            mouseHasMovedRef.current = false;
            return;
        }
        e.preventDefault();
        if (zoomLevelRef.current > MIN_ZOOM) {
            resetZoom(true);
        } else {
            const targetLevel = lastPinchLevelRef.current > MIN_ZOOM ? lastPinchLevelRef.current : DEFAULT_ZOOM;
            zoomLevelRef.current = targetLevel;
            setIsZoomed(true);
            applyTransform(targetLevel, 0, 0, true);
        }
    }, [applyTransform, resetZoom]);

    // --- Touch: double-tap to toggle zoom ---
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const now = Date.now();
        if (now - lastTapRef.current < DOUBLE_TAP_MS && e.changedTouches.length === 1 && !isPinchingRef.current) {
            e.preventDefault();
            if (zoomLevelRef.current > MIN_ZOOM) {
                resetZoom(true);
            } else {
                const targetLevel = lastPinchLevelRef.current > MIN_ZOOM ? lastPinchLevelRef.current : DEFAULT_ZOOM;
                zoomLevelRef.current = targetLevel;
                positionRef.current = { x: 0, y: 0 };
                setIsZoomed(true);
                applyTransform(targetLevel, 0, 0, true);
            }
        }
        lastTapRef.current = now;
        if (zoomLevelRef.current > MIN_ZOOM) {
            e.stopPropagation();
        }
        isDraggingRef.current = false;
        isPinchingRef.current = false;
    }, [applyTransform, resetZoom]);

    // --- Touch: single-finger drag pan when zoomed ---
    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 2) {
            // Begin pinch
            isPinchingRef.current = true;
            isDraggingRef.current = false;
            const t0 = e.touches[0];
            const t1 = e.touches[1];
            pinchStartDistanceRef.current = touchDistance(t0, t1);
            pinchStartZoomRef.current = zoomLevelRef.current;
            pinchStartPositionRef.current = { ...positionRef.current };
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const mid = touchMidpoint(t0, t1);
                pinchMidpointRef.current = {
                    x: ((mid.x - rect.left) / rect.width - 0.5) * -100,
                    y: ((mid.y - rect.top) / rect.height - 0.5) * -100,
                };
            }
            e.stopPropagation();
            return;
        }

        if (zoomLevelRef.current <= MIN_ZOOM || e.touches.length !== 1) return;
        e.stopPropagation();
        isDraggingRef.current = true;
        dragStartRef.current = {
            x: e.touches[0].clientX - positionRef.current.x,
            y: e.touches[0].clientY - positionRef.current.y,
        };
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (e.touches.length === 2 && isPinchingRef.current) {
            e.preventDefault();
            e.stopPropagation();
            const t0 = e.touches[0];
            const t1 = e.touches[1];
            const dist = touchDistance(t0, t1);
            if (pinchStartDistanceRef.current === 0) return;

            const rawLevel = pinchStartZoomRef.current * (dist / pinchStartDistanceRef.current);
            const newLevel = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rawLevel));

            // Anchor to pinch midpoint
            const mid = pinchMidpointRef.current;
            const startPos = pinchStartPositionRef.current;
            const scaleRatio = newLevel / pinchStartZoomRef.current;
            const newX = mid.x + (startPos.x - mid.x) * scaleRatio;
            const newY = mid.y + (startPos.y - mid.y) * scaleRatio;
            const clamped = clampPan(newX, newY);

            zoomLevelRef.current = newLevel;
            positionRef.current = clamped;

            if (newLevel > MIN_ZOOM) {
                setIsZoomed(true);
                lastPinchLevelRef.current = newLevel;
            }
            applyTransform(newLevel, clamped.x, clamped.y, false);
            return;
        }

        if (!isDraggingRef.current || zoomLevelRef.current <= MIN_ZOOM || e.touches.length !== 1 || !containerRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const clamped = clampPan(
            e.touches[0].clientX - dragStartRef.current.x,
            e.touches[0].clientY - dragStartRef.current.y,
        );
        positionRef.current = clamped;
        applyTransform(zoomLevelRef.current, clamped.x, clamped.y, false);
    }, [applyTransform]);

    // Snap to 1.0 on pinch end if below threshold
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const handleNativeTouchEnd = (e: TouchEvent) => {
            // When fingers lift and we were pinching
            if (isPinchingRef.current && e.touches.length < 2) {
                if (zoomLevelRef.current < SNAP_THRESHOLD) {
                    resetZoom(true);
                } else {
                    lastPinchLevelRef.current = zoomLevelRef.current;
                }
                isPinchingRef.current = false;
            }
        };
        container.addEventListener('touchend', handleNativeTouchEnd, { passive: true });
        container.addEventListener('touchcancel', handleNativeTouchEnd, { passive: true });
        return () => {
            container.removeEventListener('touchend', handleNativeTouchEnd);
            container.removeEventListener('touchcancel', handleNativeTouchEnd);
        };
    }, [resetZoom]);

    // Escape key to reset zoom
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && zoomLevelRef.current > MIN_ZOOM) {
                resetZoom(true);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [resetZoom]);

    // Determine cursor style
    const cursorClass = isZoomed
        ? (isMouseDragging ? 'cursor-grabbing' : 'cursor-grab')
        : 'cursor-zoom-in';

    return (
        <div
            ref={containerRef}
            className={cn(
                'overflow-hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:focus-visible:outline-blue-400',
                cursorClass,
                className
            )}
            onClick={handleClick}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            role="button"
            tabIndex={0}
            aria-label={isZoomed ? t('aria.zoomOut') : t('aria.zoomIn')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(e as unknown as React.MouseEvent); } }}
        >
            <div
                ref={innerRef}
                className={cn("w-full h-full", !isZoomed ? "transition-transform duration-300 ease-out" : "")}
                style={{ transform: 'scale(1) translate(0%, 0%)' }}
            >
                {children}
            </div>
        </div>
    );
}
