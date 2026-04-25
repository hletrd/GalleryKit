'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/components/i18n-provider';

interface ImageZoomProps {
    children: React.ReactNode;
    className?: string;
}

export function ImageZoom({ children, className }: ImageZoomProps) {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [isZoomed, setIsZoomed] = useState(false);
    const lastTapRef = useRef(0);
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const positionRef = useRef({ x: 0, y: 0 });

    const zoomLevel = 2.5;

    // Apply transform directly to DOM to avoid re-renders on every mousemove
    const applyTransform = useCallback((zoomed: boolean, x: number, y: number) => {
        if (!innerRef.current) return;
        innerRef.current.style.transform = zoomed
            ? `scale(${zoomLevel}) translate(${x / zoomLevel}%, ${y / zoomLevel}%)`
            : 'scale(1) translate(0%, 0%)';
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isZoomed || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width - 0.5) * -100;
        const y = ((e.clientY - rect.top) / rect.height - 0.5) * -100;
        positionRef.current = { x, y };
        applyTransform(true, x, y);
    }, [isZoomed, applyTransform]);

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Don't intercept clicks on interactive elements inside the zoom container
        const target = e.target as HTMLElement;
        if (target.closest('a, button, [role="button"], input, textarea, select')) return;
        e.preventDefault();
        setIsZoomed(prev => {
            const next = !prev;
            if (!next) {
                positionRef.current = { x: 0, y: 0 };
                applyTransform(false, 0, 0);
            }
            return next;
        });
    }, [applyTransform]);

    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
            e.preventDefault();
            setIsZoomed(prev => {
                const next = !prev;
                if (!next) {
                    positionRef.current = { x: 0, y: 0 };
                    applyTransform(false, 0, 0);
                }
                return next;
            });
        }
        lastTapRef.current = now;
        if (isZoomed) {
            e.stopPropagation();
        }
        isDraggingRef.current = false;
    }, [isZoomed, applyTransform]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        if (!isZoomed || e.touches.length !== 1) return;
        e.stopPropagation();
        isDraggingRef.current = true;
        dragStartRef.current = {
            x: e.touches[0].clientX - positionRef.current.x,
            y: e.touches[0].clientY - positionRef.current.y,
        };
    }, [isZoomed]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!isZoomed || !isDraggingRef.current || e.touches.length !== 1 || !containerRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = containerRef.current.getBoundingClientRect();
        const x = Math.max(-100, Math.min(100, ((e.touches[0].clientX - rect.left) / rect.width - 0.5) * -100));
        const y = Math.max(-100, Math.min(100, ((e.touches[0].clientY - rect.top) / rect.height - 0.5) * -100));
        positionRef.current = { x, y };
        applyTransform(true, x, y);
    }, [isZoomed, applyTransform]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isZoomed) {
                setIsZoomed(false);
                positionRef.current = { x: 0, y: 0 };
                applyTransform(false, 0, 0);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isZoomed, applyTransform]);

    useEffect(() => {
        if (!isZoomed) {
            positionRef.current = { x: 0, y: 0 };
            applyTransform(false, 0, 0);
        }
    }, [isZoomed, applyTransform]);

    return (
        <div
            ref={containerRef}
            className={cn(
                'overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isZoomed ? 'cursor-zoom-out' : 'cursor-zoom-in',
                className
            )}
            onClick={handleClick}
            onMouseMove={handleMouseMove}
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
                className={cn("w-full h-full", isZoomed ? "" : "transition-transform duration-300 ease-out")}
                style={{
                    transform: 'scale(1) translate(0%, 0%)',
                    ...(isZoomed ? { transition: 'none' } : {}),
                }}
            >
                {children}
            </div>
        </div>
    );
}
