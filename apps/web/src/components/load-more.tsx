'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadMoreImages } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { useTranslation } from '@/components/i18n-provider';

type LoadMoreResult = Awaited<ReturnType<typeof loadMoreImages>>;

interface LoadMoreProps {
    topicSlug?: string;
    tagSlugs?: string[];
    initialOffset: number;
    hasMore: boolean;
    limit?: number;
    onLoadMore: (images: LoadMoreResult) => void;
}

export function LoadMore({ topicSlug, tagSlugs, initialOffset, hasMore: initialHasMore, limit = 30, onLoadMore }: LoadMoreProps) {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialHasMore);
    const [offset, setOffset] = useState(initialOffset);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMore) return;
        loadingRef.current = true;
        setLoading(true);
        try {
            const newImages = await loadMoreImages(topicSlug, tagSlugs, offset, limit);
            if (newImages.length < limit) {
                setHasMore(false);
            }
            if (newImages.length > 0) {
                onLoadMore(newImages);
                setOffset(prev => prev + newImages.length);
            }
        } catch (error) {
            console.error('Failed to load more images:', error);
        } finally {
            loadingRef.current = false;
            setLoading(false);
        }
    }, [hasMore, offset, limit, topicSlug, tagSlugs, onLoadMore]);

    // Use a ref for the loadMore callback to avoid re-creating the observer
    // on every state change (loading/offset updates cause callback churn).
    const loadMoreRef = useRef(loadMore);
    loadMoreRef.current = loadMore;
    const queryKey = `${topicSlug ?? ''}::${(tagSlugs ?? []).join(',')}`;

    useEffect(() => {
        loadingRef.current = false;
        setLoading(false);
        setOffset(initialOffset);
        setHasMore(initialHasMore);
    }, [initialHasMore, initialOffset, queryKey]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreRef.current();
                }
            },
            { rootMargin: '200px' }
        );

        observer.observe(sentinel);
        return () => observer.disconnect();
    }, [hasMore]);

    return (
        <>
            {hasMore && (
                <div ref={sentinelRef} className="flex justify-center py-8">
                    {loading && <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />}
                </div>
            )}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {loading ? t('home.loadingMore') : ''}
            </div>
        </>
    );
}
