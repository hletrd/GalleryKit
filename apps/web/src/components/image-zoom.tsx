'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface ImageZoomProps {
    children: React.ReactNode;
    className?: string;
}

export function ImageZoom({ children, className }: ImageZoomProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isZoomed, setIsZoomed] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const lastTapRef = useRef(0);
    const isDraggingRef = useRef(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const positionRef = useRef({ x: 0, y: 0 });

    const zoomLevel = 2.5;

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isZoomed || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        // Map mouse position to translate range
        const x = ((e.clientX - rect.left) / rect.width - 0.5) * -100;
        const y = ((e.clientY - rect.top) / rect.height - 0.5) * -100;
        setPosition({ x, y });
        positionRef.current = { x, y };
    }, [isZoomed]);

    const handleClick = useCallback((e: React.MouseEvent) => {
        // Prevent zoom toggle if user was dragging
        e.preventDefault();
        setIsZoomed(prev => {
            if (prev) {
                setPosition({ x: 0, y: 0 });
                positionRef.current = { x: 0, y: 0 };
            }
            return !prev;
        });
    }, []);

    // Double-tap for mobile
    const handleTouchEnd = useCallback((e: React.TouchEvent) => {
        const now = Date.now();
        if (now - lastTapRef.current < 300) {
            e.preventDefault();
            setIsZoomed(prev => {
                if (prev) {
                    setPosition({ x: 0, y: 0 });
                    positionRef.current = { x: 0, y: 0 };
                }
                return !prev;
            });
        }
        lastTapRef.current = now;
        if (isZoomed) {
            e.stopPropagation();
        }
        isDraggingRef.current = false;
    }, [isZoomed]);

    // Touch drag when zoomed
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
        if (!isZoomed || !isDraggingRef.current || e.touches.length !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        const x = e.touches[0].clientX - dragStartRef.current.x;
        const y = e.touches[0].clientY - dragStartRef.current.y;
        // Clamp position
        const clampedX = Math.max(-100, Math.min(100, x));
        const clampedY = Math.max(-100, Math.min(100, y));
        setPosition({ x: clampedX, y: clampedY });
        positionRef.current = { x: clampedX, y: clampedY };
    }, [isZoomed]);

    // Reset zoom on escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isZoomed) {
                setIsZoomed(false);
                setPosition({ x: 0, y: 0 });
                positionRef.current = { x: 0, y: 0 };
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isZoomed]);

    return (
        <div
            ref={containerRef}
            className={cn(
                'overflow-hidden',
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
            aria-label={isZoomed ? 'Click to zoom out' : 'Click to zoom in'}
        >
            <div
                className="w-full h-full transition-transform duration-300 ease-out"
                style={{
                    transform: isZoomed
                        ? `scale(${zoomLevel}) translate(${position.x / zoomLevel}%, ${position.y / zoomLevel}%)`
                        : 'scale(1) translate(0%, 0%)',
                }}
            >
                {children}
            </div>
        </div>
    );
}
