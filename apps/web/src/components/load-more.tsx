'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadMoreImages } from '@/app/actions';
import type { LoadMoreImagesResult } from '@/app/actions/public';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';

interface LoadMoreProps {
    topicSlug?: string;
    tagSlugs?: string[];
    initialOffset: number;
    hasMore: boolean;
    limit?: number;
    onLoadMore: (images: Extract<LoadMoreImagesResult, { status: 'ok' }>['images']) => void;
}

export function LoadMore({ topicSlug, tagSlugs, initialOffset, hasMore: initialHasMore, limit = 30, onLoadMore }: LoadMoreProps) {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialHasMore);
    const [offset, setOffset] = useState(initialOffset);
    const observerRef = useRef<IntersectionObserver | null>(null);
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
            if (page.status === 'ok') {
                setHasMore(page.hasMore);
                if (page.images.length > 0) {
                    onLoadMore(page.images);
                    setOffset(prev => prev + page.images.length);
                }
                return;
            }

            setHasMore(page.hasMore);
            if (page.status === 'rateLimited') {
                toast.error(t('home.loadMoreRateLimited'));
            } else if (page.status === 'maintenance') {
                toast.error(t('home.loadMoreMaintenance'));
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

    const setSentinelRef = useCallback((node: HTMLDivElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;

        if (!node) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    loadMoreRef.current();
                }
            },
            { rootMargin: '200px' }
        );

        observer.observe(node);
        observerRef.current = observer;
    }, []);

    useEffect(() => () => observerRef.current?.disconnect(), []);

    return (
        <>
            {hasMore && (
                <div ref={setSentinelRef} className="flex justify-center py-8">
                    <Button type="button" variant="outline" onClick={loadMore} disabled={loading}>
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {loading ? t('home.loadingMore') : t('home.loadMore')}
                    </Button>
                </div>
            )}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {loading ? t('home.loadingMore') : ''}
            </div>
        </>
    );
}
