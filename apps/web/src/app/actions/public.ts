'use server';

import { headers } from 'next/headers';
import { getImagesLite, searchImages } from '@/lib/data';

import { isValidSlug } from '@/lib/validation';
import { getClientIp, searchRateLimit, SEARCH_WINDOW_MS, SEARCH_MAX_REQUESTS, SEARCH_RATE_LIMIT_MAX_KEYS } from '@/lib/rate-limit';

export async function loadMoreImages(topicSlug?: string, tagSlugs?: string[], offset: number = 0, limit: number = 30) {
    // Validate slug format before passing to data layer (defense in depth)
    if (topicSlug && (!isValidSlug(topicSlug))) return [];
    const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    // Cap maximum offset to prevent deep pagination DoS
    if (safeOffset > 10000) return [];
    // Cap tag array to prevent complex query DoS
    const safeTags = (tagSlugs || []).slice(0, 20);
    const images = await getImagesLite(topicSlug, safeTags, safeLimit, safeOffset);
    return images;
}

export async function searchImagesAction(query: string) {
    if (!query || typeof query !== 'string' || query.length > 1000) return [];
    if (query.trim().length < 2) return [];

    // Server-side rate limiting for search (LIKE queries are expensive)
    const requestHeaders = await headers();
    const ip = getClientIp(requestHeaders);
    const now = Date.now();
    const entry = searchRateLimit.get(ip);
    if (entry && entry.resetAt > now && entry.count >= SEARCH_MAX_REQUESTS) {
        return [];
    }
    if (!entry || entry.resetAt <= now) {
        searchRateLimit.set(ip, { count: 1, resetAt: now + SEARCH_WINDOW_MS });
    } else {
        entry.count++;
    }
    // Evict stale entries if map grows too large
    if (searchRateLimit.size > SEARCH_RATE_LIMIT_MAX_KEYS) {
        for (const [key, val] of searchRateLimit) {
            if (val.resetAt <= now) searchRateLimit.delete(key);
            if (searchRateLimit.size <= SEARCH_RATE_LIMIT_MAX_KEYS) break;
        }
    }

    const safeQuery = query.trim().slice(0, 200);
    return searchImages(safeQuery, 20);
}
