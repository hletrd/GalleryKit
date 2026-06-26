'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadMoreImages, loadMoreSmartCollectionImages } from '@/app/actions';
import type { LoadMoreImagesResult } from '@/app/actions/public';
import type { ImageListCursorInput } from '@/lib/data';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useTranslation } from '@/components/i18n-provider';

interface LoadMoreProps {
    topicSlug?: string;
    smartCollectionSlug?: string;
    tagSlugs?: string[];
    initialOffset: number;
    initialCursor?: ImageListCursorInput | null;
    hasMore: boolean;
    limit?: number;
    onLoadMore: (images: Extract<LoadMoreImagesResult, { status: 'ok' }>['images']) => void;
}

export function LoadMore({ topicSlug, smartCollectionSlug, tagSlugs, initialOffset, initialCursor = null, hasMore: initialHasMore, limit = 30, onLoadMore }: LoadMoreProps) {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(initialHasMore);
    const [offset, setOffset] = useState(initialOffset);
    const [cursor, setCursor] = useState<ImageListCursorInput | null>(initialCursor);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const loadingRef = useRef(false);
    const queryVersionRef = useRef(0);
    // AGG-R8-07 (run-8 c2): guard setState after unmount. queryVersionRef only
    // short-circuits a stale QUERY (key change), not an in-flight loadMore that
    // resolves after the component unmounts (e.g. fast route change). Symmetric
    // with the settings-client backfill unmount guard.
    const mountedRef = useRef(true);
    const maintenanceCooldownRef = useRef<number>(0);
    const MAINTENANCE_COOLDOWN_MS = 5000;
    const [statusMessage, setStatusMessage] = useState('');

    const loadMore = useCallback(async () => {
        if (loadingRef.current || !hasMore) return;
        loadingRef.current = true;
        setLoading(true);
        setStatusMessage(t('home.loadingMore'));
        const version = queryVersionRef.current;
        try {
            const page = smartCollectionSlug
                ? await loadMoreSmartCollectionImages(smartCollectionSlug, cursor ?? offset, limit)
                : await loadMoreImages(topicSlug, tagSlugs, cursor ?? offset, limit);
            if (version !== queryVersionRef.current || !mountedRef.current) return;
            if (page.status === 'ok') {
                setHasMore(page.hasMore);
                if (page.images.length > 0) {
                    onLoadMore(page.images);
                    setStatusMessage(t('home.loadedMore', { count: page.images.length }));
                    setOffset(prev => prev + page.images.length);
                    const lastImage = page.images.at(-1);
                    if (lastImage) {
                        setCursor({
                            id: lastImage.id,
                            capture_date: lastImage.capture_date ?? null,
                            created_at: lastImage.created_at,
                        });
                    }
                } else if (!page.hasMore) {
                    setStatusMessage(t('home.noMorePhotos'));
                }
                return;
            }

            setHasMore(page.hasMore);
            if (page.status === 'rateLimited') {
                toast.error(t('home.loadMoreRateLimited'));
            } else if (page.status === 'maintenance') {
                const now = Date.now();
                if (now - maintenanceCooldownRef.current > MAINTENANCE_COOLDOWN_MS) {
                    maintenanceCooldownRef.current = now;
                    toast.error(t('home.loadMoreMaintenance'));
                }
            } else if (page.status === 'error' || page.status === 'invalid') {
                // R15C15 CR-15: 'invalid' (malformed cursor, e.g. a corrupted
                // deep-link) previously fell through with no feedback — surface
                // the same generic failure toast as 'error'.
                toast.error(t('home.loadMoreFailed'));
            }
        } catch (error) {
            console.error('Failed to load more images:', error);
            toast.error(t('home.loadMoreFailed'));
        } finally {
            if (version === queryVersionRef.current && mountedRef.current) {
                loadingRef.current = false;
                setLoading(false);
            }
        }
    }, [hasMore, cursor, offset, limit, topicSlug, smartCollectionSlug, tagSlugs, onLoadMore, t]);

    // Use a ref for the loadMore callback to avoid re-creating the observer
    // on every state change (loading/offset updates cause callback churn).
    const loadMoreRef = useRef(loadMore);
    useEffect(() => {
        loadMoreRef.current = loadMore;
    }, [loadMore]);
    const queryKey = `${topicSlug ?? ''}::${smartCollectionSlug ?? ''}::${(tagSlugs ?? []).join(',')}`;

    useEffect(() => {
        queryVersionRef.current++;
        loadingRef.current = false;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional pagination reset when the query key or initial cursor changes
        setLoading(false);
        setOffset(initialOffset);
        setCursor(initialCursor);
        setHasMore(initialHasMore);
    }, [initialHasMore, initialOffset, initialCursor, queryKey]);

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

    // AGG-R8-07: flip the mounted flag on unmount so an in-flight loadMore that
    // resolves afterwards skips its setState block.
    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
        };
    }, []);

    return (
        <>
            {hasMore && (
                <div ref={setSentinelRef} className="flex justify-center py-8">
                    <Button type="button" variant="outline" onClick={loadMore} disabled={loading} className="min-h-11">
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {loading ? t('home.loadingMore') : t('home.loadMore')}
                    </Button>
                </div>
            )}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
                {statusMessage}
            </div>
        </>
    );
}
