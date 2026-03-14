'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadMoreImages } from '@/app/actions';
import { Loader2 } from 'lucide-react';

interface LoadMoreProps {
    topicSlug?: string;
    tagSlugs?: string[];
    initialOffset: number;
    hasMore: boolean;
    limit?: number;
    children: (images: any[]) => React.ReactNode;
}

export function LoadMore({ topicSlug, tagSlugs, initialOffset, hasMore: initialHasMore, limit = 30, children }: LoadMoreProps) {
    const [additionalImages, setAdditionalImages] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialHasMore);
    const [offset, setOffset] = useState(initialOffset);
    const sentinelRef = useRef<HTMLDivElement>(null);

    const loadMore = useCallback(async () => {
        if (loading || !hasMore) return;
        setLoading(true);
        try {
            const newImages = await loadMoreImages(topicSlug, tagSlugs, offset, limit);
            if (newImages.length < limit) {
                setHasMore(false);
            }
            if (newImages.length > 0) {
                setAdditionalImages(prev => [...prev, ...newImages]);
                setOffset(prev => prev + newImages.length);
            }
        } catch (error) {
            console.error('Failed to load more images:', error);
        } finally {
            setLoading(false);
        }
    }, [loading, hasMore, offset, limit, topicSlug, tagSlugs]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasMore && !loading) {
                    loadMore();
                }
            },
            { rootMargin: '200px' }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore, loading, loadMore]);

    return (
        <>
            {children(additionalImages)}
            {hasMore && (
                <div ref={sentinelRef} className="flex justify-center py-8">
                    {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                </div>
            )}
        </>
    );
}
