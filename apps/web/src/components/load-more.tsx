'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadMoreImages } from '@/app/actions';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';

type LoadMoreResult = Awaited<ReturnType<typeof loadMoreImages>>;

interface LoadMoreProps {
    topicSlug?: string;
    tagSlugs?: string[];
    initialOffset: number;
    hasMore: boolean;
    limit?: number;
    onLoadMore: (images: LoadMoreResult['images']) => void;
}

export function LoadMore({ topicSlug, tagSlugs, initialOffset, hasMore: initialHasMore, limit = 30, onLoadMore }: LoadMoreProps) {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialHasMore);
    const [offset, setOffset] = useState(initialOffset);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const loadingRef = useRef(false);
    const queryVersionRef = useRef(0);

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMore) return;
        loadingRef.current = true;
        setLoading(true);
        const version = queryVersionRef.current;
        try {
            const page = await loadMoreImages(topicSlug, tagSlugs, offset, limit);
            if (version !== queryVersionRef.current) return;
            setHasMore(page.hasMore);
            if (page.images.length > 0) {
                onLoadMore(page.images);
                setOffset(prev => prev + page.images.length);
            }
        } catch (error) {
            console.error('Failed to load more images:', error);
            toast.error(t('home.loadMoreFailed'));
        } finally {
            if (version === queryVersionRef.current) {
                loadingRef.current = false;
                setLoading(false);
            }
        }
    }, [hasMore, offset, limit, topicSlug, tagSlugs, onLoadMore, t]);

    // Use a ref for the loadMore callback to avoid re-creating the observer
    // on every state change (loading/offset updates cause callback churn).
    const loadMoreRef = useRef(loadMore);
    loadMoreRef.current = loadMore;
    const queryKey = `${topicSlug ?? ''}::${(tagSlugs ?? []).join(',')}`;

    useEffect(() => {
        queryVersionRef.current++;
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
    }, []);

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
