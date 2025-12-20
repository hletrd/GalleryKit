'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PhotoNavigationProps {
    prevId: number | null;
    nextId: number | null;
}

export function PhotoNavigation({ prevId, nextId }: PhotoNavigationProps) {
    const router = useRouter();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && prevId) {
                router.push(`/p/${prevId}`);
            } else if (e.key === 'ArrowRight' && nextId) {
                router.push(`/p/${nextId}`);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [prevId, nextId, router]);

    // Basic Touch Swipe support
    useEffect(() => {
        let touchStartX = 0;
        let touchEndX = 0;

        const handleTouchStart = (e: TouchEvent) => {
            touchStartX = e.changedTouches[0].screenX;
        };

        const handleTouchEnd = (e: TouchEvent) => {
            touchEndX = e.changedTouches[0].screenX;
            handleSwipe();
        };

        const handleSwipe = () => {
            const threshold = 50;
            if (touchEndX < touchStartX - threshold && nextId) {
                // Swipe Left -> Next Image
                router.push(`/p/${nextId}`);
            }
            if (touchEndX > touchStartX + threshold && prevId) {
                // Swipe Right -> Prev Image
                router.push(`/p/${prevId}`);
            }
        };

        window.addEventListener('touchstart', handleTouchStart);
        window.addEventListener('touchend', handleTouchEnd);

        return () => {
            window.removeEventListener('touchstart', handleTouchStart);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, [prevId, nextId, router]);

    return (
        <>
            {/* Overlay Navigation Buttons */}
            {prevId && (
                <div className="absolute left-4 top-1/2 -translate-y-1/2 opacity-70 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity z-10">
                     <Button
                        variant="secondary"
                        size="icon"
                        className="h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70 border-none"
                        onClick={() => router.push(`/p/${prevId}`)}
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
                        onClick={() => router.push(`/p/${nextId}`)}
                    >
                        <ChevronRight className="h-6 w-6" />
                    </Button>
                </div>
            )}
        </>
    );
}
